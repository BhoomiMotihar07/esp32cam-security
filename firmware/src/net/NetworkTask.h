// Core-0 task: Wi-Fi, IoT Hub MQTT, photo uploads, Telegram fallback, offline queue.
// Vision never waits on the network; it only pushes Jobs and pops Commands.
#pragma once
#include <Arduino.h>
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "../config.h"
#include "Jobs.h"
#include "WifiLink.h"
#include "AzureIotClient.h"
#include "LocalDevLink.h"
#include "BlobUploader.h"
#include "TelegramClient.h"

class NetworkTask {
public:
  NetworkTask(QueueHandle_t jobs, QueueHandle_t commands);
  void start();
  bool wifiUp() const { return wifi_.connected(); }
  bool cloudUp() const {
    if (azure_.configured()) return azure_.connected();
    if (useLocal_) return wifi_.connected() && local_.reachable();
    return wifi_.connected();
  }
  bool timeValid() const { return wifi_.timeValid(); }

private:
  static void taskEntry(void* arg);
  void run();
  void handleJob(Job& job);
  void setupOta();   // ArduinoOTA: later firmware updates over Wi-Fi, no USB
  bool publish(const char* json, size_t len); // IoT Hub, or the laptop dev server in local mode
  void stampIfUnset(Job& job);
  bool sendEvent(EventJob& ev);
  void onC2D(const char* json, size_t len);
  void freePhotos(EventJob& ev);
  void queueOffline(Job& job);
  void drainOffline();

  QueueHandle_t jobs_;
  QueueHandle_t commands_;
  WifiLink wifi_;
  AzureIotClient azure_;
  LocalDevLink local_;
  bool useLocal_ = false;
  BlobUploader blobs_;
  TelegramClient telegram_;
  Job offline_[MAX_QUEUED_EVENTS];
  int offlineCount_ = 0;
  uint32_t bootMs_ = 0;
  bool otaStarted_ = false;
};
