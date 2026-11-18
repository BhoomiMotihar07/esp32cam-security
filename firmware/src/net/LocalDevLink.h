// Device link over HTTP(S) instead of IoT Hub MQTT. Talks to the laptop dev server or the
// Supabase deployment on Render; both expose the same two routes:
//   POST {API_BASE_URL}/device/{id}/telemetry   same JSON as the IoT Hub messages
//   GET  {API_BASE_URL}/device/{id}/commands    same JSON as IoT Hub C2D commands
// Every request carries x-device-key (DEVICE_UPLOAD_KEY); the server checks its sha256.
#pragma once
#include <Arduino.h>
#include <functional>

class LocalDevLink {
public:
  using CommandHandler = std::function<void(const char* json, size_t len)>;

  LocalDevLink(const char* apiBase, const char* deviceId, const char* deviceKey)
      : apiBase_(apiBase), deviceId_(deviceId), deviceKey_(deviceKey) {}
  void onCommand(CommandHandler h) { handler_ = h; }
  bool publish(const char* json, size_t len);
  void poll(uint32_t nowMs);           // fetch queued commands every COMMAND_POLL_MS
  bool reachable() const { return reachable_; }

private:
  static constexpr uint32_t COMMAND_POLL_MS = 3000; // command latency vs requests to a free host
  const char* apiBase_;
  const char* deviceId_;
  const char* deviceKey_;
  CommandHandler handler_;
  uint32_t lastPollMs_ = 0;
  bool reachable_ = false;
};
