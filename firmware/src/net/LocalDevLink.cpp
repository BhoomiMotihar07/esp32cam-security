#include "LocalDevLink.h"
#include <ArduinoJson.h>
#include "HttpLite.h"

bool LocalDevLink::publish(const char* json, size_t len) {
  String url = String(apiBase_) + "/local/device/" + deviceId_ + "/telemetry";
  HttpResult r = HttpLite::post(url, (const uint8_t*)json, len, "application/json");
  reachable_ = r.status > 0;
  if (r.status != 202) log_w("local telemetry rejected: %d %s", r.status, r.body.c_str());
  return r.status == 202;
}

void LocalDevLink::poll(uint32_t nowMs) {
  if (nowMs - lastPollMs_ < COMMAND_POLL_MS) return;
  lastPollMs_ = nowMs;
  // wait=0: return at once. Long-polling would block this task, which also does the uploads.
  String url = String(apiBase_) + "/local/device/" + deviceId_ + "/commands?wait=0";
  HttpResult r = HttpLite::get(url, nullptr, nullptr, 4096);
  reachable_ = r.status == 200;
  if (r.status != 200 || !handler_) return;

  JsonDocument doc;
  if (deserializeJson(doc, r.body)) { log_w("local commands: bad json"); return; }
  for (JsonVariant cmd : doc.as<JsonArray>()) {
    String one;
    serializeJson(cmd, one);
    handler_(one.c_str(), one.length()); // same path as an IoT Hub C2D message
  }
}
