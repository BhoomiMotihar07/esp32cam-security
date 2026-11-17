# Bill of materials

Prices are indicative Indian retail (₹), late 2025; fill in what you actually paid.

| # | part | qty | purpose | approx. ₹ |
|---|---|---|---|---|
| 1 | AI-Thinker ESP32-CAM (OV2640, 4 MB PSRAM) | 1 | camera, Wi-Fi, flash LED, red LED | 450–600 |
| 2 | ESP32-CAM-MB base board **or** FTDI/CP2102 USB-serial adapter | 1 | programming and serial logs | 150–250 |
| 3 | KY-038 (or KY-037) sound sensor module | 1 | digital sound pulses on GPIO14 | 60–90 |
| 4 | Passive piezo buzzer (5 V) | 1 | ticks, chirps, siren on GPIO13 | 20–40 |
| 5 | Tactile push button | 1 | local arm/disarm override on GPIO15 | 5 |
| 6 | 5 V 2 A supply **or** 2×18650 + holder + LM2596 buck | 1 | clean 5 V; the camera + Wi-Fi + flash peak well above 500 mA | 150–400 |
| 7 | Electrolytic capacitor 470–1000 µF / 10 V | 1 | brown-out protection across 5 V/GND | 10 |
| 8 | Dupont jumpers, small breadboard or perfboard | — | wiring | 100 |
| 9 | Enclosure / mount (3D print, junction box) with a lens hole | 1 | fixed camera pose (tamper detection depends on it) | 100–200 |
| | **Core total** | | | **~1,100–1,700** |

Optional / stretch:

| part | purpose |
|---|---|
| KY-002 vibration switch (GPIO 2 or 12, with care) | knock detection |
| INMP441 I2S MEMS microphone (3 GPIOs) | true sound levels, glass-break vs speech |
| microSD card (1-bit mode uses GPIO 2, 14, 15: conflicts with the sound sensor and button) | offline photo queue |
| 2200 µF capacitor, shorter USB cable | if `BROWNOUT` keeps appearing in heartbeats |

Cloud services (all free tier): Azure for Students (IoT Hub F1, Functions Consumption, Cosmos DB
free tier or serverless, Storage LRS, Static Web Apps Free), Telegram Bot API.
