// IoT Hub over MQTT/TLS using ESP-IDF's esp-mqtt (no SDK): SAS auth, telemetry up, C2D down.
#pragma once
#include <Arduino.h>
#include <functional>
#include "mqtt_client.h"

class AzureIotClient {
public:
  using CommandHandler = std::function<void(const char* json, size_t len)>;

  AzureIotClient(const char* hubHost, const char* deviceId, const char* deviceKey)
      : host_(hubHost), deviceId_(deviceId), key_(deviceKey) {}
  bool configured() const { return host_ && host_[0]; }
  void onCommand(CommandHandler h) { handler_ = h; }

  void loop(bool wifiUp, bool timeValid); // (re)connects, renews the SAS token
  bool connected() const { return connected_; }
  bool publish(const char* json, size_t len);   // device-to-cloud telemetry

private:
  static void eventHandler(void* arg, esp_event_base_t base, int32_t id, void* data);
  void start();
  void stop();
  const char* host_;
  const char* deviceId_;
  const char* key_;
  esp_mqtt_client_handle_t client_ = nullptr;
  bool connected_ = false;
  bool started_ = false;
  uint32_t tokenExpiry_ = 0;
  String username_, password_, uri_, telemetryTopic_, c2dTopic_;
  CommandHandler handler_;
};
