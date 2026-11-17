# Device contract

The JSON that crosses the device ↔ cloud boundary. The TypeScript source of truth is
[`shared/src/device-contract.ts`](../shared/src/device-contract.ts); the firmware mirrors it in
[`firmware/src/net/Messages.cpp`](../firmware/src/net/Messages.cpp) and
[`firmware/src/control/DeviceConfig.cpp`](../firmware/src/control/DeviceConfig.cpp).

Rules that apply everywhere:

- Timestamps `ts` are UNIX epoch **seconds** (integers). The ESP32 gets time from NTP; messages
  created before NTP answered are stamped by the network task before sending. The backend rejects
  `ts < 1 600 000 000`.
- The **device identity is taken from the transport**, never from the JSON body: IoT Hub's
  `iothub-connection-device-id` system property in Azure, the URL path in local mode. A device cannot
  write another device's state or reference another device's photos.
- Every device-to-cloud message is well under the IoT Hub 4 KB metering unit; the heartbeat is < 500 bytes.

## Device → cloud (MQTT topic `devices/{deviceId}/messages/events/`)

All messages carry `kind` as the discriminator.

### `heartbeat` — every 60 s

```json
{"kind":"heartbeat","deviceId":"cam-01","state":"ARMED","armSource":"app","rssi":-61,
 "uptime":5421,"resetReason":"POWERON","brightness":118,"freeHeap":161204,"configVersion":3,"ts":1794637131}
```

| field | type | notes |
|---|---|---|
| `state` | `DISARMED \| EXIT_COUNTDOWN \| ARMED \| ALARM` | |
| `armSource` | `app \| schedule \| auto_dark \| button \| telegram \| null` | null when disarmed |
| `rssi` | dBm | Wi-Fi signal |
| `uptime` | seconds since boot | |
| `resetReason` | `POWERON, EXT, SW, PANIC, INT_WDT, TASK_WDT, WDT, DEEPSLEEP, BROWNOUT, SDIO, UNKNOWN` | `esp_reset_reason()`; a `BROWNOUT` after a burst means the 5 V supply sagged |
| `brightness` | 0..255 | mean gray level of the latest QQVGA frame |
| `freeHeap` | bytes | optional |
| `configVersion` | int | the `DeviceConfig.version` the device is running, so the app can show "applied" |

### `state` — immediately on every state-machine transition

```json
{"kind":"state","deviceId":"cam-01","state":"EXIT_COUNTDOWN","armSource":"button","countdownEndsAt":1794637160,"ts":1794637130}
```

`countdownEndsAt` is present only in `EXIT_COUNTDOWN`. Without this message the app would wait up
to 60 s for a heartbeat to learn that the user armed the system.

### `event` — a detection, after its photos are uploaded

```json
{"kind":"event","deviceId":"cam-01","type":"motion","zone":"Door","score":0.21,"photoCount":3,
 "photos":["cam-01/1794637146-0.jpg","cam-01/1794637146-1.jpg","cam-01/1794637146-2.jpg"],"ts":1794637146}
```

| `type` | `score` meaning |
|---|---|
| `motion` | fraction of pixels changed in the hottest zone (two consecutive frames ≥ threshold) |
| `sound` | pulses in the 1 s window ÷ learned baseline |
| `tamper_dark` | 1 − mean/DARK_LEVEL (how black the frame is) |
| `tamper_moved` | fraction of mean-normalised pixels that disagree with the reference frame |

`offline` events exist in the event feed but are created by the cloud's timer, never by the device.
`photoCount` is how many photos were attempted; `photos` lists the ones that uploaded. Blob names
must be `{deviceId}/{ts}-{seq}.jpg` under the sending device's own prefix.

### `snapshot` — result of a `snapshot` command

```json
{"kind":"snapshot","deviceId":"cam-01","blob":"cam-01/1794660193-0.jpg","ts":1794660193}
```

## Cloud → device (IoT Hub C2D, topic `devices/{deviceId}/messages/devicebound/#`)

```json
{"cmd":"arm","ts":1794637200,"source":"app","requestId":"…"}
{"cmd":"disarm","ts":…,"source":"telegram"}
{"cmd":"snapshot","ts":…}
{"cmd":"ack","ts":…}
{"cmd":"ping","ts":…}
{"cmd":"setConfig","ts":…,"config":{ …DeviceConfig… }}
```

IoT Hub keeps C2D messages for up to 48 h when the device is offline. A stale `disarm` arriving a
day later would be dangerous, so every command carries `ts`, the hub message has a 10 min expiry,
and the device **ignores any command older than `COMMAND_MAX_AGE_SEC` (600 s)**.

`ping` is the "I see you" feature: three buzzer chirps and three flash-LED blinks.

## `DeviceConfig` (payload of `setConfig`, stored in Cosmos `config` and in the device's NVS)

```json
{
  "version": 3,
  "zones": [{"id":"z1","name":"Door","enabled":true,"x":0.6,"y":0.1,"w":0.3,"h":0.8}],
  "motionThreshold": 0.08,
  "soundSensitivity": 5,
  "nightThreshold": 40,
  "autoArmWhenDark": false,
  "exitDelaySec": 30,
  "schedule": {"enabled":true,"tzOffsetMin":330,"entries":[{"days":[1,2,3,4,5],"armAt":"22:00","disarmAt":"06:00"}]}
}
```

| field | range | device meaning |
|---|---|---|
| `zones[].x,y,w,h` | 0..1, max 8 zones | normalised on the snapshot; mapped onto the 160×120 motion frame |
| `motionThreshold` | 0.01..0.5 | fraction of a zone's pixels that must change (Δ > 25 gray levels) in two consecutive frames |
| `soundSensitivity` | 1..10 | 10 = spike at 1.5× baseline (floor 3 pulses); 1 = 6× baseline (floor 12 pulses) |
| `nightThreshold` | 0..255 | mean brightness below which the scene is "dark" (with auto-exposure maxed or locked) |
| `autoArmWhenDark` | bool | arm with no exit delay after 5 continuous dark minutes while DISARMED |
| `exitDelaySec` | 0..300 | length of EXIT_COUNTDOWN for app/button arming (schedule and auto-dark use 0) |
| `schedule.tzOffsetMin` | −720..840 | minutes east of UTC; the device has no timezone database |
| `schedule.entries[]` | ≤ 14 | `days` 0 = Sunday; windows may cross midnight (the arm day is the entry's day) |

The server validates and **bumps `version`** on every save; the device echoes the version it
applied in each heartbeat.

## Photo upload flow (HTTPS, not through IoT Hub)

1. `GET {API}/upload-url?deviceId=cam-01&seq=0` with header `x-device-key: <DEVICE_UPLOAD_KEY>`
2. Response: `{"blob":"cam-01/1794637146-0.jpg","url":"https://…?sv=…&sp=cw&se=…","expiresAt":…}`
   — a write-only (create+write) SAS for exactly that blob name, valid 5 minutes. The server
   chooses the name, so a device can only ever write under its own prefix.
3. `PUT <url>` with `Content-Type: image/jpeg` and `x-ms-blob-type: BlockBlob`.
4. After all three photos: publish the `event` with the returned blob names.

The app never sees a storage key either: `GET /photos/url?blob=…` returns a 15-minute read-only SAS,
and only for devices in the caller's household.

## Timing constants (`TIMING` in `shared`)

| constant | value |
|---|---|
| heartbeat interval | 60 s |
| OFFLINE after | 180 s without a heartbeat |
| alert repeat | every 30 s until acknowledged (cap `ALERT_MAX_REPEATS`, default 20) |
| exit delay default | 30 s |
| evidence burst | 3 JPEG (SVGA), 300 ms apart |
| command max age | 600 s |
| upload SAS / read SAS | 5 min / 15 min |
