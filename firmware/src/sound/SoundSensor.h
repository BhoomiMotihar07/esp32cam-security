// KY-038 digital output: pulses per 1 s window against a learned baseline (exponential average).
#pragma once
#include <Arduino.h>

struct SoundResult {
  bool spike = false;
  int pulses = 0;
  float baseline = 0;
  float score = 0; // pulses / max(baseline, 1)
};

class SoundSensor {
public:
  void begin(int pin, bool activeLow);
  void setSensitivity(int oneToTen);
  // Call often; returns a result once per closed 1 s window (windowClosed = true).
  bool poll(uint32_t nowMs, SoundResult& out);

private:
  static void IRAM_ATTR onEdge();
  static volatile uint32_t pulseCount_;
  uint32_t windowStart_ = 0;
  float baseline_ = 0;
  bool baselineReady_ = false;
  int warmupWindows_ = 0;
  float multiplier_ = 3.0f;
  int minPulses_ = 8;
};
