// Image-based tamper: covered (near-black) or moved/turned (persistent mismatch with the reference).
#pragma once
#include <Arduino.h>

enum class TamperKind { None, Dark, Moved };

struct TamperResult {
  TamperKind kind = TamperKind::None;
  float score = 0;
  uint8_t meanBrightness = 0;
};

class TamperDetector {
public:
  bool begin(int width, int height);
  void captureReference(const uint8_t* frame); // call at arm time and after each burst
  bool hasReference() const { return haveRef_; }
  TamperResult update(const uint8_t* frame, uint32_t nowMs);
  static uint8_t meanOf(const uint8_t* frame, int n);

private:
  int w_ = 0, h_ = 0;
  uint8_t* ref_ = nullptr; // PSRAM
  int refMean_ = 0;
  bool haveRef_ = false;
  bool refIsDark_ = false;
  uint32_t darkSince_ = 0;
  uint32_t mismatchSince_ = 0;
};
