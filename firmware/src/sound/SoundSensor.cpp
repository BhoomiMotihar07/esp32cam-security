#include "SoundSensor.h"

volatile uint32_t SoundSensor::pulseCount_ = 0;

void IRAM_ATTR SoundSensor::onEdge() { pulseCount_++; }

void SoundSensor::begin(int pin, bool activeLow) {
  pinMode(pin, INPUT);
  attachInterrupt(digitalPinToInterrupt(pin), onEdge, activeLow ? FALLING : RISING);
  windowStart_ = millis();
}

// Sensitivity 1 (least) .. 10 (most): multiplier over baseline 6x .. 1.5x, floor 12 .. 3 pulses.
void SoundSensor::setSensitivity(int s) {
  s = constrain(s, 1, 10);
  multiplier_ = 1.0f + (11 - s) * 0.5f;
  minPulses_ = 3 + (10 - s);
}

bool SoundSensor::poll(uint32_t nowMs, SoundResult& out) {
  if (nowMs - windowStart_ < 1000) return false;
  windowStart_ = nowMs;
  noInterrupts();
  uint32_t pulses = pulseCount_;
  pulseCount_ = 0;
  interrupts();

  out = SoundResult{};
  out.pulses = int(pulses);
  // First 10 windows only learn (the pot may be mis-set; a stuck-active output just raises the baseline).
  if (warmupWindows_ < 10) {
    baseline_ = warmupWindows_ == 0 ? pulses : baseline_ * 0.8f + pulses * 0.2f;
    warmupWindows_++;
    out.baseline = baseline_;
    return true;
  }
  float limit = max(float(minPulses_), baseline_ * multiplier_);
  out.baseline = baseline_;
  out.score = pulses / max(baseline_, 1.0f);
  out.spike = pulses > limit;
  // Only quiet windows train the baseline, so a long alarm does not teach the sensor that noise is normal.
  if (!out.spike) baseline_ = baseline_ * 0.95f + pulses * 0.05f;
  return true;
}
