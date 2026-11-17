#include "NightDetector.h"
#include "../config.h"

bool NightDetector::update(uint8_t mean, int aecValue, int aecMax, bool exposureLocked, uint32_t nowMs) {
  bool exposureMaxed = exposureLocked || aecValue >= (aecMax * 9) / 10;
  darkNow_ = mean < threshold_ && exposureMaxed;
  if (!darkNow_) { darkSince_ = 0; return false; }
  if (!darkSince_) darkSince_ = nowMs;
  return nowMs - darkSince_ >= NIGHT_HOLD_MS;
}
