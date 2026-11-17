// "It is dark" from the camera itself (ADC2 pins cannot read an LDR while Wi-Fi is on).
// Dark = mean brightness below the threshold even though auto-exposure is at its longest
// exposure (or the exposure is frozen while armed). Held NIGHT_HOLD_MS before reporting.
#pragma once
#include <Arduino.h>

class NightDetector {
public:
  void setThreshold(uint8_t level) { threshold_ = level; }
  // Returns true once the scene has been continuously dark for NIGHT_HOLD_MS.
  bool update(uint8_t meanBrightness, int aecValue, int aecMax, bool exposureLocked, uint32_t nowMs);
  bool isDarkNow() const { return darkNow_; }

private:
  uint8_t threshold_ = 40;
  bool darkNow_ = false;
  uint32_t darkSince_ = 0;
};
