#include "TamperDetector.h"
#include "../config.h"

bool TamperDetector::begin(int width, int height) {
  w_ = width; h_ = height;
  ref_ = static_cast<uint8_t*>(ps_malloc(w_ * h_));
  return ref_ != nullptr;
}

uint8_t TamperDetector::meanOf(const uint8_t* frame, int n) {
  uint32_t sum = 0;
  for (int p = 0; p < n; p++) sum += frame[p];
  return uint8_t(sum / n);
}

void TamperDetector::captureReference(const uint8_t* frame) {
  memcpy(ref_, frame, w_ * h_);
  refMean_ = meanOf(frame, w_ * h_);
  // If the room is already dark when arming, "went dark" cannot be told from "is dark":
  // the dark check is disabled and the sound sensor covers the night. Documented limitation.
  refIsDark_ = refMean_ < 2 * DARK_LEVEL;
  haveRef_ = true;
  darkSince_ = mismatchSince_ = 0;
}

TamperResult TamperDetector::update(const uint8_t* frame, uint32_t nowMs) {
  TamperResult r;
  const int n = w_ * h_;
  int mean = meanOf(frame, n);
  r.meanBrightness = uint8_t(mean);
  if (!haveRef_) return r;

  // 1) covered: near-black for TAMPER_DARK_MS
  if (!refIsDark_ && mean < DARK_LEVEL) {
    if (!darkSince_) darkSince_ = nowMs;
    if (nowMs - darkSince_ >= TAMPER_DARK_MS) {
      r.kind = TamperKind::Dark;
      r.score = 1.0f - float(mean) / DARK_LEVEL;
      return r;
    }
  } else {
    darkSince_ = 0;
  }

  // 2) moved: compare mean-normalised pixels so a light switch (same structure, new brightness)
  //    scores low while a new view of the room scores high.
  int mismatched = 0;
  for (int p = 0; p < n; p++) {
    int d = (int(frame[p]) - mean) - (int(ref_[p]) - refMean_);
    if (d < 0) d = -d;
    if (d > TAMPER_DELTA) mismatched++;
  }
  float frac = float(mismatched) / n;
  if (frac >= TAMPER_MOVED_FRAC && mean >= DARK_LEVEL) {
    if (!mismatchSince_) mismatchSince_ = nowMs;
    if (nowMs - mismatchSince_ >= TAMPER_MOVED_MS) {
      r.kind = TamperKind::Moved;
      r.score = frac;
    }
  } else {
    mismatchSince_ = 0;
  }
  return r;
}
