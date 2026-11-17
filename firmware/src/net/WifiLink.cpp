#include "WifiLink.h"

void WifiLink::begin(const char* ssid, const char* password) {
  ssid_ = ssid; password_ = password;
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);              // modem sleep adds latency spikes to MQTT keepalive
  WiFi.setAutoReconnect(false);      // we own the retry policy
  WiFi.begin(ssid_, password_);
  lastAttempt_ = millis();
}

void WifiLink::loop() {
  if (connected()) {
    backoffMs_ = 2000;
    if (!ntpStarted_) {
      configTime(0, 0, "pool.ntp.org", "time.google.com"); // UTC; the schedule applies tzOffsetMin itself
      ntpStarted_ = true;
    }
    return;
  }
  if (millis() - lastAttempt_ < backoffMs_) return;
  lastAttempt_ = millis();
  backoffMs_ = min<uint32_t>(backoffMs_ * 2, 60000); // 2 s .. 60 s
  log_w("wifi reconnect (next retry in %lu ms)", backoffMs_);
  WiFi.disconnect();
  WiFi.begin(ssid_, password_);
}
