// The vision/control side (core 1, Arduino loop). Owns the camera, detectors, state machine
// and indicators; talks to the network task only through two FreeRTOS queues.
#pragma once
#include <Arduino.h>
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "../camera/CameraService.h"
#include "../vision/MotionDetector.h"
#include "../vision/TamperDetector.h"
#include "../vision/NightDetector.h"
#include "../sound/SoundSensor.h"
#include "../control/AlarmStateMachine.h"
#include "../control/Indicators.h"
#include "../control/Button.h"
#include "../control/DeviceConfig.h"
#include "../schedule/Scheduler.h"
#include "../net/Jobs.h"
#include "../net/NetworkTask.h"

class Controller {
public:
  void setup();
  void loop();

private:
  // inputs
  void handleCommands();
  void handleButton(uint32_t nowMs);
  void handleSchedule(uint32_t nowEpoch);
  void handleVision(uint32_t nowMs);
  void handleSound(uint32_t nowMs);
  // actions
  void arm(ArmSource src, uint32_t exitDelayOverride = 0xFFFFFFFF);
  void disarm();
  void onStateChanged();
  void enterArmed();            // lock exposure, take reference
  void raiseEvent(const char* type, const char* zone, float score, uint32_t nowMs);
  bool captureBurst(EventJob& ev);
  void takeSnapshot();
  void applyConfig(const DeviceConfig& cfg);
  // telemetry
  void publishState();
  void publishHeartbeat();
  void logStats(uint32_t nowMs);
  uint32_t nowEpoch() const { time_t t = time(nullptr); return t > 1600000000 ? uint32_t(t) : 0; }

  CameraService camera_;
  MotionDetector motion_;
  TamperDetector tamper_;
  NightDetector night_;
  SoundSensor sound_;
  AlarmStateMachine machine_;
  Indicators leds_;
  Button button_;
  Scheduler scheduler_;
  DeviceConfig config_;
  QueueHandle_t jobs_ = nullptr;
  QueueHandle_t commands_ = nullptr;
  NetworkTask* net_ = nullptr;

  uint8_t lastBrightness_ = 0;
  uint32_t lastHeartbeatMs_ = 0;
  uint32_t lastStatsMs_ = 0;
  uint32_t lastMotionEventMs_ = 0, lastSoundEventMs_ = 0, lastTamperEventMs_ = 0;
  uint32_t skipMotionUntilMs_ = 0;
  bool needReference_ = false;  // set after a scene change; next frame becomes the tamper reference
  uint32_t armedSinceMs_ = 0;
  bool wasWifiUp_ = true;
  DeviceState lastIndicated_ = DeviceState::Disarmed;
  // measurements for the README
  uint32_t lastBurstMs_ = 0, lastBurstBytes_ = 0;
};
