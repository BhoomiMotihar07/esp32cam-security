// Frame differencing inside zones. Two consecutive frames over the threshold = motion.
#pragma once
#include <Arduino.h>
#include "Zones.h"

struct MotionResult {
  bool motion = false;
  int zoneIndex = -1;
  float score = 0;        // fraction of changed pixels in the hottest zone
  float globalChange = 0; // fraction of changed pixels in the whole frame (scene-change check)
  uint32_t diffMicros = 0;
};

class MotionDetector {
public:
  bool begin(int width, int height);
  void setZones(const Zone* zones, int count);
  void setThreshold(float fraction) { threshold_ = fraction; }
  void reset();                                   // forget the previous frame
  MotionResult update(const uint8_t* frame);      // call once per grabbed frame

private:
  int w_ = 0, h_ = 0;
  uint8_t* prev_ = nullptr;   // PSRAM
  uint8_t* mask_ = nullptr;   // 0 or zone index+1 per pixel, built once in setZones
  bool havePrev_ = false;
  float threshold_ = 0.08f;
  int zoneCount_ = 0;
  int zoneArea_[MAX_ZONES] = {0};
  int hotStreak_[MAX_ZONES] = {0};
};
