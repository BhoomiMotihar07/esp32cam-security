#include "CameraService.h"
#include "CameraPins.h"
#include "../config.h"

static camera_config_t baseConfig() {
  camera_config_t c = {};
  c.ledc_channel = LEDC_CHANNEL_0;
  c.ledc_timer = LEDC_TIMER_0;
  c.pin_d0 = CAM_PIN_D0; c.pin_d1 = CAM_PIN_D1; c.pin_d2 = CAM_PIN_D2; c.pin_d3 = CAM_PIN_D3;
  c.pin_d4 = CAM_PIN_D4; c.pin_d5 = CAM_PIN_D5; c.pin_d6 = CAM_PIN_D6; c.pin_d7 = CAM_PIN_D7;
  c.pin_xclk = CAM_PIN_XCLK; c.pin_pclk = CAM_PIN_PCLK; c.pin_vsync = CAM_PIN_VSYNC; c.pin_href = CAM_PIN_HREF;
  c.pin_sccb_sda = CAM_PIN_SIOD; c.pin_sccb_scl = CAM_PIN_SIOC;
  c.pin_pwdn = CAM_PIN_PWDN; c.pin_reset = CAM_PIN_RESET;
  c.xclk_freq_hz = CAM_XCLK_HZ;
  c.fb_location = CAMERA_FB_IN_PSRAM;
  c.grab_mode = CAMERA_GRAB_LATEST; // always the newest frame, never a stale buffered one
  return c;
}

bool CameraService::begin() {
  return setMode(Mode::Gray);
}

bool CameraService::init(Mode mode) {
  camera_config_t c = baseConfig();
  if (mode == Mode::Gray) {
    c.pixel_format = PIXFORMAT_GRAYSCALE;
    c.frame_size = FRAMESIZE_QQVGA;
    c.fb_count = 2;
  } else {
    c.pixel_format = PIXFORMAT_JPEG;
    c.frame_size = FRAMESIZE_SVGA;
    c.jpeg_quality = CAM_JPEG_QUALITY;
    c.fb_count = 1;
  }
  esp_err_t err = esp_camera_init(&c);
  if (err != ESP_OK) {
    log_e("camera init failed: 0x%x", err);
    return false;
  }
  sensor_t* s = esp_camera_sensor_get();
  if (s) {
    s->set_brightness(s, 0);
    s->set_saturation(s, 0);
    s->set_lenc(s, 1);
    // OV2640 ships mirrored/flipped on some modules; keep defaults so the app's zones match the snapshot.
  }
  return true;
}

bool CameraService::setMode(Mode mode) {
  if (mode == mode_) return true;
  uint32_t t0 = millis();
  releaseGray();
  if (mode_ != Mode::None) esp_camera_deinit();
  mode_ = Mode::None;
  locked_ = false;
  if (!init(mode)) return false;
  mode_ = mode;
  lastReinitMs_ = millis() - t0;
  fpsWindowStart_ = millis();
  fpsFrames_ = 0;
  return true;
}

bool CameraService::grabGray(GrayFrame& out) {
  if (mode_ != Mode::Gray) return false;
  releaseGray();
  fb_ = esp_camera_fb_get();
  if (!fb_) return false;
  out.pixels = fb_->buf;
  out.width = fb_->width;
  out.height = fb_->height;
  out.captureMs = millis();
  // rolling fps over 5 s windows
  fpsFrames_++;
  uint32_t dt = millis() - fpsWindowStart_;
  if (dt >= 5000) {
    grayFps_ = fpsFrames_ * 1000.0f / dt;
    fpsWindowStart_ = millis();
    fpsFrames_ = 0;
  }
  return true;
}

void CameraService::releaseGray() {
  if (fb_) { esp_camera_fb_return(fb_); fb_ = nullptr; }
}

void CameraService::lockExposure() {
  sensor_t* s = esp_camera_sensor_get();
  if (!s) return;
  int aec = s->status.aec_value;
  int gain = s->status.agc_gain;
  s->set_exposure_ctrl(s, 0); // AEC off
  s->set_gain_ctrl(s, 0);     // AGC off
  s->set_whitebal(s, 0);
  s->set_awb_gain(s, 0);
  s->set_aec_value(s, aec);   // hold what auto-exposure had converged to
  s->set_agc_gain(s, gain);
  locked_ = true;
  log_i("exposure locked: aec=%d gain=%d", aec, gain);
}

void CameraService::unlockExposure() {
  sensor_t* s = esp_camera_sensor_get();
  if (!s) return;
  s->set_exposure_ctrl(s, 1);
  s->set_gain_ctrl(s, 1);
  s->set_whitebal(s, 1);
  s->set_awb_gain(s, 1);
  locked_ = false;
}

int CameraService::aecValue() const {
  sensor_t* s = esp_camera_sensor_get();
  return s ? s->status.aec_value : 0;
}

int CameraService::agcGain() const {
  sensor_t* s = esp_camera_sensor_get();
  return s ? s->status.agc_gain : 0;
}

bool CameraService::captureJpeg(JpegPhoto& photo) {
  if (mode_ != Mode::Jpeg) return false;
  camera_fb_t* fb = esp_camera_fb_get();
  if (!fb) return false;
  // Copy out so the driver buffer is released immediately ("release the frame buffer, then upload").
  photo.data = static_cast<uint8_t*>(ps_malloc(fb->len));
  if (!photo.data) { esp_camera_fb_return(fb); log_e("no PSRAM for %u byte photo", fb->len); return false; }
  memcpy(photo.data, fb->buf, fb->len);
  photo.len = fb->len;
  esp_camera_fb_return(fb);
  return true;
}
