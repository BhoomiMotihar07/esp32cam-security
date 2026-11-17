// Hardware map and tuning constants. Everything measured for the README lives here.
#pragma once
#include <Arduino.h>

// ---- pins (AI-Thinker ESP32-CAM; camera pins live in camera/CameraPins.h) ----
constexpr int PIN_RED_LED   = 33;  // on-board red LED, active LOW
constexpr int PIN_FLASH_LED = 4;   // on-board white flash LED, active HIGH (also SD D1: SD not used)
constexpr int PIN_BUZZER    = 13;  // kit buzzer (+) ; passive buzzer driven by LEDC tone
constexpr int PIN_SOUND_DO  = 14;  // KY-038 digital out
constexpr int PIN_BUTTON    = 15;  // override button to GND (internal pull-up; pulled high at boot)
// GPIO 2 and 12 stay free: boot-strapping pins.

constexpr bool BUZZER_PASSIVE   = true;  // false for an active buzzer (plain on/off)
constexpr bool SOUND_ACTIVE_LOW = true;  // LM393 modules pull DO low above threshold

// ---- LEDC channels (channel 0 / timer 0 belong to the camera XCLK) ----
constexpr int LEDC_CH_BUZZER = 2;

// ---- camera ----
constexpr int CAM_XCLK_HZ        = 10000000; // 10 MHz: fewer frame errors on long jumper leads than 20 MHz
constexpr int CAM_JPEG_QUALITY   = 12;       // 0 (best) .. 63; SVGA at 12 is ~35-50 KB
constexpr int MOTION_FRAME_W     = 160;      // QQVGA grayscale for the motion loop
constexpr int MOTION_FRAME_H     = 120;
constexpr int AE_SETTLE_MS       = 1200;     // let auto-exposure converge before locking it
constexpr int BURST_FLUSH_FRAMES = 2;        // frames discarded after re-init before the evidence burst

// ---- detection ----
constexpr uint8_t PIXEL_DELTA        = 25;   // gray-level change that counts as a changed pixel
constexpr uint8_t TAMPER_DELTA       = 40;   // vs mean-normalised reference frame
constexpr float   TAMPER_MOVED_FRAC  = 0.60f;
constexpr uint32_t TAMPER_MOVED_MS   = 5000;
constexpr uint8_t DARK_LEVEL         = 12;   // mean below this = covered
constexpr uint32_t TAMPER_DARK_MS    = 3000;
constexpr uint32_t MOTION_COOLDOWN_MS = 15000;
constexpr uint32_t SOUND_COOLDOWN_MS  = 15000;
constexpr uint32_t TAMPER_COOLDOWN_MS = 60000;
constexpr uint32_t NIGHT_HOLD_MS      = 5UL * 60UL * 1000UL; // dark this long before auto-arm
constexpr uint32_t SCENE_CHANGE_SKIP_MS = 2000; // after a light switch, skip motion and re-reference

// ---- timing (mirrors shared/src/device-contract.ts TIMING) ----
constexpr uint32_t HEARTBEAT_MS       = 60000;
constexpr uint32_t ALERT_REPEAT_MS    = 30000;
constexpr int      BURST_PHOTOS       = 3;
constexpr uint32_t BURST_GAP_MS       = 300;
constexpr uint32_t COMMAND_MAX_AGE_S  = 600;
constexpr uint32_t SAS_TOKEN_TTL_S    = 24UL * 3600UL;
constexpr uint32_t WIFI_LOST_BLINK_MS = 5000;

// ---- queues ----
constexpr int MAX_QUEUED_EVENTS = 5; // RAM queue while Wi-Fi is down (photos kept for the newest ones)

// ---- firmware identity ----
constexpr const char* FIRMWARE_VERSION = "0.1.0";
