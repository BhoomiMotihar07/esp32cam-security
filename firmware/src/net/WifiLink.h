// Wi-Fi with reconnect backoff and NTP time. Never blocks the caller for long.
#pragma once
#include <Arduino.h>
#include <WiFi.h>

class WifiLink {
public:
  void begin(const char* ssid, const char* password);
  void loop();                       // call from the network task
  bool connected() const { return WiFi.status() == WL_CONNECTED; }
  bool timeValid() const { return time(nullptr) > 1600000000; }
  int rssi() const { return connected() ? WiFi.RSSI() : 0; }

private:
  const char* ssid_ = nullptr;
  const char* password_ = nullptr;
  uint32_t lastAttempt_ = 0;
  uint32_t backoffMs_ = 2000;
  bool ntpStarted_ = false;
};
