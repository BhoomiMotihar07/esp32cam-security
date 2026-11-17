// Non-blocking LED + buzzer patterns (see docs/pin-map.md "LED codes").
#pragma once
#include <Arduino.h>
#include "AlarmStateMachine.h"

class Indicators {
public:
  void begin();
  void setState(DeviceState s, uint32_t countdownRemainingSec);
  void setWifiLost(bool lost) { wifiLost_ = lost; }
  void setFlashForCapture(bool on);  // explicit control during an evidence burst
  void ping();                        // "I see you": chirps + flash blinks for ~2 s
  void update(uint32_t nowMs);        // call every loop iteration

private:
  void red(bool on) { digitalWrite(33, on ? LOW : HIGH); }
  void flash(bool on) { if (!captureHold_) digitalWrite(4, on ? HIGH : LOW); }
  void tone(int hz);
  DeviceState state_ = DeviceState::Disarmed;
  uint32_t countdownRemaining_ = 0;
  bool wifiLost_ = false;
  bool captureHold_ = false;
  uint32_t pingUntil_ = 0;
};
