#include "Indicators.h"
#include "../config.h"

void Indicators::begin() {
  pinMode(PIN_RED_LED, OUTPUT);
  pinMode(PIN_FLASH_LED, OUTPUT);
  red(false);
  digitalWrite(PIN_FLASH_LED, LOW);
  if (BUZZER_PASSIVE) {
    ledcSetup(LEDC_CH_BUZZER, 2000, 8);
    ledcAttachPin(PIN_BUZZER, LEDC_CH_BUZZER);
    ledcWrite(LEDC_CH_BUZZER, 0);
  } else {
    pinMode(PIN_BUZZER, OUTPUT);
    digitalWrite(PIN_BUZZER, LOW);
  }
}

void Indicators::tone(int hz) {
  if (BUZZER_PASSIVE) {
    if (hz > 0) ledcWriteTone(LEDC_CH_BUZZER, hz); else ledcWrite(LEDC_CH_BUZZER, 0);
  } else {
    digitalWrite(PIN_BUZZER, hz > 0 ? HIGH : LOW);
  }
}

void Indicators::setState(DeviceState s, uint32_t remaining) {
  state_ = s;
  countdownRemaining_ = remaining;
}

void Indicators::setFlashForCapture(bool on) {
  captureHold_ = on;
  digitalWrite(PIN_FLASH_LED, on ? HIGH : LOW);
}

void Indicators::ping() { pingUntil_ = millis() + 2000; }

void Indicators::update(uint32_t now) {
  // Ping overrides everything briefly: 3 chirps + 3 flash blinks.
  if (now < pingUntil_) {
    bool on = ((pingUntil_ - now) / 300) % 2 == 0;
    tone(on ? 2500 : 0);
    flash(on);
    red(on);
    return;
  }
  uint32_t phase = now % 1000;
  switch (state_) {
    case DeviceState::Disarmed:
      red(false); flash(false); tone(0);
      break;
    case DeviceState::ExitCountdown: {
      red((now / 100) % 2 == 0);                               // fast blink
      bool tick = countdownRemaining_ <= 5 ? (phase % 250) < 40 : phase < 40; // faster ticks in the last 5 s
      tone(tick ? 1800 : 0);
      flash(false);
      break;
    }
    case DeviceState::Armed:
      red(phase < 100);                                        // slow blink: 100 ms on per second
      flash(false); tone(0);
      break;
    case DeviceState::Alarm:
      red(true);
      flash((now / 250) % 2 == 0);                             // 2 Hz strobe
      tone((now / 400) % 2 == 0 ? 2800 : 2000);                // two-tone siren
      break;
  }
  // Wi-Fi lost overlay: two short red blinks every 5 s (only visible in DISARMED/ARMED idle gaps).
  if (wifiLost_ && state_ != DeviceState::Alarm) {
    uint32_t p = now % WIFI_LOST_BLINK_MS;
    if (p < 80 || (p >= 160 && p < 240)) red(true);
  }
}
