# Hardware bring-up (ESP32-CAM → laptop, no Azure needed)

This connects the real board to the dev server on your laptop over Wi-Fi. The app, alerts, photos,
zones, schedule and commands all work exactly as with the simulator. Switch to Azure later by
filling in the IoT Hub settings; nothing else changes.

## 1. Wire it

See [pin-map.md](pin-map.md) for the full table.

```
KY-038   VCC → 5V    GND → GND    DO → GPIO14
Buzzer   +  → GPIO13 −   → GND
Button   GPIO15 ↔ GND
Power    5 V 2 A supply, short leads, 470–1000 µF capacitor across 5V/GND
```

Leave GPIO 2 and 12 unconnected. Do not plug in a microSD card.

## 2. Start the laptop side

```sh
cd ~/Projects/esp32cam-security
npm run dev -w api        # loads api/.env; prints "push: configured"
npm run dev -w app        # http://localhost:5173
ipconfig getifaddr en0    # this Mac's LAN IP, e.g. 172.17.70.205
```

`api/.env` must contain `PUBLIC_API_BASE=http://<that IP>:7071/api`, otherwise the camera gets
photo-upload URLs pointing at `localhost`, which on the camera means itself.

Laptop and camera must be on the **same Wi-Fi**, and that network must let devices talk to each
other. Campus and hotel networks usually block this ("client isolation"). Use a phone hotspot or a
home router if the camera cannot reach the laptop. If macOS asks whether `node` may accept
incoming connections, click **Allow** (System Settings → Network → Firewall).

In the app: *Family → Devices* → register `cam-01` with an upload key of your choice (≥ 8 characters).

## 3. Configure and flash the firmware

```sh
cd firmware
cp include/secrets.example.h include/secrets.h     # if you have not already
```

Edit `include/secrets.h`:

```c
#define WIFI_SSID            "your-wifi"            // 2.4 GHz only: the ESP32 has no 5 GHz radio
#define WIFI_PASSWORD        "your-password"
#define DEVICE_ID            "cam-01"
#define DEVICE_UPLOAD_KEY    "the key you typed in the app"
#define AZURE_IOT_HUB_HOST   ""                     // empty = no Azure
#define AZURE_DEVICE_KEY     ""
#define USE_LOCAL_DEV_SERVER 1
#define API_BASE_URL         "http://172.17.70.205:7071/api"   // your laptop IP
```

Flash. On a bare board without the MB base board, connect GPIO0 to GND, press reset, flash, then
remove the jumper and reset again.

```sh
~/.local/tools/pio-venv/bin/pio run -t upload
~/.local/tools/pio-venv/bin/pio device monitor -b 115200
```

## 4. What you should see

Serial monitor, within ~10 s of boot:

```
ESP32-CAM home security fw 0.1.0, reset reason POWERON, psram 4194304
cloud link: local dev server (LAN)
stats: DISARMED gray 18.x fps, brightness 1xx, ...
```

App: the Status tab turns from OFFLINE to DISARMED with RSSI and uptime filled in. Then:

| try | expect |
|---|---|
| Snapshot now | a real photo from the camera within a few seconds |
| Settings → draw a zone on that photo → Save | serial `config v2 applied (1 zones)`; Status shows `v2 applied` |
| Arm (exit delay 30 s) | red LED fast blink + ticks, then slow blink |
| walk through the zone | siren + strobe, red ALARM banner in the app with 3 photos |
| Acknowledge | siren stops, still armed |
| press the button | disarm (or arm when disarmed) |
| cover the lens 3 s while armed | `tamper_dark` event |
| clap near the KY-038 | `sound:` line in the serial log; event when armed |
| unplug the router | two short red blinks every 5 s; an alarm still sounds locally and the event arrives once Wi-Fi is back |

## 5. Troubleshooting

| symptom | cause / fix |
|---|---|
| `camera init failed: 0x105` / `0x20001` | ribbon cable not seated, or no PSRAM: reseat the camera, check the board is AI-Thinker |
| `Brownout detector was triggered`, `resetReason BROWNOUT` | supply too weak: better 5 V source, shorter cable, add the capacitor |
| stays OFFLINE, serial says `local telemetry rejected: -1` | camera cannot reach the laptop: same Wi-Fi? client isolation? firewall? correct IP? |
| events arrive but photos are missing | `PUBLIC_API_BASE` still says `localhost`; or the upload key in `secrets.h` does not match the app |
| `upload-url failed: 403 device_not_claimed` | register the device in the app first |
| nothing on KY-038 | turn its potentiometer until the DO LED is just off in a quiet room |
| motion fires constantly | raise the motion threshold slider, or make sure the camera is fixed and not wobbling |
| clock-related errors (`bad ts`) | the board has no internet for NTP; it needs internet access, not just LAN |

Record the fps, burst and upload timings from the `stats:`, `burst:` and `upload:` lines in the
README tables ([test-plan.md](test-plan.md), H1–H4).

## Later: switching to Azure

Set `USE_LOCAL_DEV_SERVER 0`, fill `AZURE_IOT_HUB_HOST`, `AZURE_DEVICE_KEY` and the Functions
`API_BASE_URL` (https://…azurewebsites.net/api) from [setup-azure.md](setup-azure.md), and flash
again.
