// Development link to the laptop dev server (npm run dev -w api), used before Azure exists:
//   POST {API_BASE_URL}/local/device/{id}/telemetry   same JSON as the IoT Hub messages
//   GET  {API_BASE_URL}/local/device/{id}/commands    same JSON as IoT Hub C2D commands
// Plain HTTP on the LAN with no device authentication, so it is for bench testing only.
#pragma once
#include <Arduino.h>
#include <functional>

class LocalDevLink {
public:
  using CommandHandler = std::function<void(const char* json, size_t len)>;

  LocalDevLink(const char* apiBase, const char* deviceId) : apiBase_(apiBase), deviceId_(deviceId) {}
  void onCommand(CommandHandler h) { handler_ = h; }
  bool publish(const char* json, size_t len);
  void poll(uint32_t nowMs);           // fetch queued commands every COMMAND_POLL_MS
  bool reachable() const { return reachable_; }

private:
  static constexpr uint32_t COMMAND_POLL_MS = 2000;
  const char* apiBase_;
  const char* deviceId_;
  CommandHandler handler_;
  uint32_t lastPollMs_ = 0;
  bool reachable_ = false;
};
