#include "MotionDetector.h"
#include "../config.h"

bool MotionDetector::begin(int width, int height) {
  w_ = width; h_ = height;
  prev_ = static_cast<uint8_t*>(ps_malloc(w_ * h_));
  mask_ = static_cast<uint8_t*>(ps_malloc(w_ * h_));
  if (!prev_ || !mask_) return false;
  memset(mask_, 0, w_ * h_);
  return true;
}

void MotionDetector::setZones(const Zone* zones, int count) {
  memset(mask_, 0, w_ * h_);
  memset(zoneArea_, 0, sizeof(zoneArea_));
  memset(hotStreak_, 0, sizeof(hotStreak_));
  zoneCount_ = min(count, MAX_ZONES);
  // Later zones win where zones overlap; each pixel is counted for one zone only.
  for (int i = 0; i < zoneCount_; i++) {
    if (!zones[i].enabled) continue;
    PixelRect r = toPixels(zones[i], w_, h_);
    for (int y = r.y0; y < r.y1; y++)
      for (int x = r.x0; x < r.x1; x++) mask_[y * w_ + x] = uint8_t(i + 1);
  }
  for (int p = 0; p < w_ * h_; p++) if (mask_[p]) zoneArea_[mask_[p] - 1]++;
}

void MotionDetector::reset() {
  havePrev_ = false;
  memset(hotStreak_, 0, sizeof(hotStreak_));
}

MotionResult MotionDetector::update(const uint8_t* frame) {
  MotionResult r;
  uint32_t t0 = micros();
  const int n = w_ * h_;
  if (!havePrev_) {
    memcpy(prev_, frame, n);
    havePrev_ = true;
    return r;
  }
  int changed[MAX_ZONES] = {0};
  int globalChanged = 0;
  for (int p = 0; p < n; p++) {
    int d = int(frame[p]) - int(prev_[p]);
    if (d < 0) d = -d;
    if (d > PIXEL_DELTA) {
      globalChanged++;
      if (mask_[p]) changed[mask_[p] - 1]++;
    }
  }
  memcpy(prev_, frame, n);
  r.globalChange = float(globalChanged) / n;

  for (int i = 0; i < zoneCount_; i++) {
    if (zoneArea_[i] == 0) continue;
    float frac = float(changed[i]) / zoneArea_[i];
    if (frac >= threshold_) hotStreak_[i]++; else hotStreak_[i] = 0;
    // Two consecutive hot frames: a single noisy frame (compression glitch, insect) is not motion.
    if (hotStreak_[i] >= 2 && frac > r.score) {
      r.motion = true;
      r.zoneIndex = i;
      r.score = frac;
    }
  }
  r.diffMicros = micros() - t0;
  return r;
}
