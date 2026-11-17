# Firmware (ESP32-CAM, PlatformIO + Arduino)

```
src/
  main.cpp                 thin entry: Controller::setup()/loop()
  config.h                 pins, camera settings, thresholds, timings (all tunables)
  app/Controller.*         vision task (core 1): detectors → state machine → jobs
  camera/CameraService.*   OV2640 modes (gray QQVGA / JPEG SVGA), exposure lock, fps counter
  vision/MotionDetector.*  zone frame differencing, two consecutive frames
  vision/TamperDetector.*  covered (near-black) / moved (mismatch vs reference)
  vision/NightDetector.*   brightness + auto-exposure saturation held 5 min
  sound/SoundSensor.*      KY-038 pulse counting (ISR), rolling baseline
  control/AlarmStateMachine.*  DISARMED/EXIT_COUNTDOWN/ARMED/ALARM (mirror of shared/)
  control/Indicators.*     red LED, flash LED, buzzer patterns (non-blocking)
  control/Button.*         debounced override button
  control/DeviceConfig.*   zones/sliders/schedule from setConfig, persisted in NVS
  schedule/Scheduler.*     weekly windows (mirror of shared/)
  net/NetworkTask.*        core-0 task: Wi-Fi, IoT Hub, uploads, offline queue
  net/AzureIotClient.*     esp-mqtt over TLS, hand-built SAS token, C2D subscription
  net/LocalDevLink.*       bench mode: HTTP to the laptop dev server (USE_LOCAL_DEV_SERVER)
  net/SasToken.*           HMAC-SHA256 + base64 + url-encoding
  net/BlobUploader.*       GET /upload-url → PUT JPEG
  net/HttpLite.*           esp_http_client wrapper using the built-in root-CA bundle
  net/TelegramClient.*     direct fallback (sendMessage / sendPhoto)
  net/Messages.*           JSON builders for heartbeat/state/event/snapshot
  net/Jobs.h               queue payloads between the two tasks
include/secrets.example.h  copy to secrets.h (gitignored)
```

## Build and flash

First time with a real board and no Azure yet: follow [../docs/hardware-bringup.md](../docs/hardware-bringup.md).

```sh
cp include/secrets.example.h include/secrets.h   # fill in Wi-Fi, device id/key, hub, API URL
pio run                                         # compile (≈1.05 MB, fits a min_spiffs OTA slot)
pio run -t upload                               # IO0 → GND during reset on bare boards; MB base board handles it
pio device monitor -b 115200
```

Arduino IDE instead: see docs/pin-map.md (board, PSRAM, partition "Minimal SPIFFS (1.9MB APP with OTA)").

## What the logs tell you (numbers for the README)

| log line | meaning |
|---|---|
| `stats: ARMED gray 18.4 fps, brightness 112, last burst 1480 ms / 118240 B, heap …` | every 10 s: motion-loop fps with exposure locked, scene brightness, last burst cost |
| `exposure locked: aec=412 gain=4` | values frozen at arm time |
| `burst: 3 photos, 118240 bytes, reinit 380 ms, total 1480 ms` | mode switch + flush + 3 shots |
| `upload: cam-01/…-0.jpg 39413 bytes in 910 ms` | one SAS grant + PUT |
| `event motion: 3/3 photos uploaded in 2950 ms` | time from event to publish |
| `scene change (74% of frame): re-referencing` | light switched; not an alarm |
| `sound: 23 pulses vs baseline 2.1 (x11.0)` | window above the learned baseline |
| `c2d: stale disarm ignored (54321 s old)` | queued command older than 10 min |
| `wifi LOST: working offline` / `event queued offline (1 waiting)` | local-only mode; drained when Wi-Fi returns |

## Design notes (viva)

- **Two cores, two owners.** The camera belongs to the vision task; TLS belongs to the network
  task. They exchange `Job`/`Command` structs through FreeRTOS queues, so a slow upload never
  stalls detection and a burst never fights an MQTT keep-alive for heap.
- **Pixels or JPEG, chosen once.** The watch loop captures grayscale QQVGA directly (no JPEG
  decode, ~19 KB per frame). For evidence the sensor is re-initialised to SVGA JPEG, two frames are
  flushed for exposure, three are taken 300 ms apart, and the camera returns to gray and re-takes
  its reference. The re-init cost is logged.
- **Exposure lock.** At the moment of becoming ARMED, auto-exposure runs 1.2 s on the empty room,
  then AEC/AGC/AWB are frozen. Otherwise the sensor's own adjustments look like motion.
- **Light switch ≠ intruder.** If more than 60 % of the whole frame changes between two frames with
  no tamper verdict, motion is paused 2 s and the reference is re-taken.
- **Tamper.** Covered = mean < 12/255 for 3 s (disabled when the room was already dark at arm time).
  Moved = 60 % of mean-normalised pixels disagree with the reference for 5 s; normalisation makes a
  lamp toggle score low while a new view scores high.
- **Night from the camera.** Dark = mean below the threshold while auto-exposure is at ≥ 90 % of
  its range (or locked). Held 5 min before auto-arming, with no exit delay. The LDR idea dies on
  ADC2-vs-Wi-Fi.
- **Sound.** Falling edges on GPIO14 are counted in 1 s windows. Baseline is an exponential
  average that only learns from quiet windows; a spike is `pulses > max(floor, k × baseline)`
  with `k` and `floor` from the sensitivity slider.
- **No PEM certificates.** HTTPS and MQTT/TLS use the Mozilla root bundle compiled into
  arduino-esp32 (`arduino_esp_crt_bundle_attach`), which covers IoT Hub, Blob Storage and Telegram.
- **No Azure SDK.** The IoT Hub MQTT contract is three strings (username, SAS password, topics); the
  token is HMAC-SHA256 over `urlencode(resource)\nexpiry`, renewed an hour before it expires.
- **Stale commands.** Every C2D command carries `ts`; anything older than 10 min is logged and
  dropped.
- **Power.** Flash only after a trigger; `esp_reset_reason()` goes out in every heartbeat so brown-outs
  show up in the app instead of hiding as "random reboots".

## Known limits (hardware to verify)

- At night without ambient light the motion detector sees nothing; the flash is not used while
  watching (it would be visible and would ruin the reference). Sound covers the dark.
- `tamper_moved` cannot tell "camera turned" from "furniture rearranged" by design.
- Burst re-init (~0.3–0.5 s expected) delays the first photo; measure and report it.
- RAM offline queue holds 5 events (~600 KB PSRAM); older photos are dropped first.
