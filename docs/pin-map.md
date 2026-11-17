# Pin map and LED codes (AI-Thinker ESP32-CAM)

Check against your board's silkscreen; clones differ. Source of truth: `firmware/src/config.h` and
`firmware/src/camera/CameraPins.h`.

## Used pins

| GPIO | use | direction | why / caveat |
|---|---|---|---|
| 33 | on-board red LED | output, **active LOW** | status code |
| 4 | on-board white flash LED | output, active HIGH | night flash + alarm strobe. Shares the SD D1 line: we do not use the SD card |
| 13 | buzzer (+) | output (LEDC channel 2 tone) | plain output, safe at boot. Passive buzzer by default (`BUZZER_PASSIVE`) |
| 14 | KY-038 digital out | input, interrupt on falling edge | digital read, so ADC2-vs-Wi-Fi does not matter. Active-low on LM393 modules (`SOUND_ACTIVE_LOW`) |
| 15 | override button → GND | input with pull-up | pulled high at boot, so a button is safe |
| 2, 12 | **left free** | | boot-strapping pins: nothing may pull them at reset |
| 0 | camera XCLK (and IO0 flash jumper) | | hold low only while flashing |
| 1, 3 | UART TX/RX | | programmer / serial monitor |
| 5,18,19,21,34,35,36,39 | camera D0..D7 | | |
| 22,23,25,26,27,32 | camera PCLK, HREF, VSYNC, SIOD, SIOC, PWDN | | |

## Wiring

```
KY-038   VCC → 5V (or 3V3)    GND → GND    DO → GPIO14      (AO unused: ADC2 is dead while Wi-Fi runs)
Buzzer   + → GPIO13            − → GND      (passive buzzer; for an active one set BUZZER_PASSIVE=false)
Button   one leg → GPIO15      other leg → GND
Power    5 V from a buck converter (LM2596 set to 5.0 V with a meter), short thick leads,
         470–1000 µF electrolytic across 5 V/GND next to the board. Never feed 7.4 V directly.
```

Why the capacitor: Wi-Fi TX bursts plus the flash LED cause current spikes; a sagging rail resets
the ESP32 (`resetReason: BROWNOUT` in the heartbeat) and looks like a false alarm.

## microSD trade-off (not used)

A microSD in 1-bit mode needs GPIO 2, 14 and 15, which would take the sound sensor and the button.
We chose the sound sensor and button over an SD offline queue; events are queued in PSRAM instead
(`MAX_QUEUED_EVENTS = 5`, photos of the oldest are dropped first).

## LED and buzzer codes

| state | red LED (GPIO33) | flash LED (GPIO4) | buzzer |
|---|---|---|---|
| DISARMED | off | off | silent |
| EXIT_COUNTDOWN | fast blink (5 Hz) | off | tick every second, 4 ticks/s in the last 5 s |
| ARMED | slow blink (100 ms per second) | off | silent |
| ALARM | solid | 2 Hz strobe | two-tone siren (2.0/2.8 kHz) |
| Wi-Fi lost (overlay) | two short blinks every 5 s | | |
| "I see you" (ping) | 3 blinks | 3 blinks | 3 chirps |
| evidence burst at night | | on for the ~1.2 s burst | |

## Arduino IDE equivalents (if not using PlatformIO)

Board: *AI Thinker ESP32-CAM* (or *ESP32 Wrover Module*), PSRAM: enabled, Partition scheme:
*Minimal SPIFFS (1.9 MB APP with OTA)*, Upload speed 460800, Serial monitor 115200.
Library: ArduinoJson 7.x. Copy `firmware/src/**` into a sketch folder and `include/secrets.h` next
to it.
