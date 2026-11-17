// Owns the OV2640. Two modes: grayscale QQVGA for the motion loop, JPEG SVGA for evidence.
// Only the vision task touches this object.
#pragma once
#include <Arduino.h>
#include "esp_camera.h"

// Plain-old-data on purpose: it lives inside the Job union passed through FreeRTOS queues.
struct JpegPhoto {
  uint8_t* data; // PSRAM, owned by the receiver (free with free()); nullptr when empty
  size_t len;
};

struct GrayFrame {
  const uint8_t* pixels; // width*height bytes, valid until the next grab
  int width;
  int height;
  uint32_t captureMs;
};

class CameraService {
public:
  enum class Mode { None, Gray, Jpeg };

  bool begin();                       // first init in Gray mode
  bool setMode(Mode mode);            // deinit + init; returns false on failure
  Mode mode() const { return mode_; }

  // Gray mode. Returns false when no frame arrived.
  bool grabGray(GrayFrame& out);
  void releaseGray();

  // Freeze AEC/AGC/AWB at their current values so lighting control does not look like motion.
  void lockExposure();
  void unlockExposure();
  bool exposureLocked() const { return locked_; }

  // Sensor status helpers for the night detector.
  int aecValue() const;
  int agcGain() const;
  static int aecMax() { return 1200; }

  // JPEG mode: capture one photo into a PSRAM copy. Caller frees photo.data.
  bool captureJpeg(JpegPhoto& photo);

  // Timing counters for the README.
  float grayFps() const { return grayFps_; }
  uint32_t lastReinitMs() const { return lastReinitMs_; }

private:
  bool init(Mode mode);
  camera_fb_t* fb_ = nullptr;
  Mode mode_ = Mode::None;
  bool locked_ = false;
  float grayFps_ = 0;
  uint32_t fpsWindowStart_ = 0;
  uint32_t fpsFrames_ = 0;
  uint32_t lastReinitMs_ = 0;
};
