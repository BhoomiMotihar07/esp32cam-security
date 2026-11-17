#include "Messages.h"
#include <ArduinoJson.h>
#include "esp_system.h"

const char* resetReasonName() {
  switch (esp_reset_reason()) {
    case ESP_RST_POWERON: return "POWERON";
    case ESP_RST_EXT: return "EXT";
    case ESP_RST_SW: return "SW";
    case ESP_RST_PANIC: return "PANIC";
    case ESP_RST_INT_WDT: return "INT_WDT";
    case ESP_RST_TASK_WDT: return "TASK_WDT";
    case ESP_RST_WDT: return "WDT";
    case ESP_RST_DEEPSLEEP: return "DEEPSLEEP";
    case ESP_RST_BROWNOUT: return "BROWNOUT";
    case ESP_RST_SDIO: return "SDIO";
    default: return "UNKNOWN";
  }
}

static void putSource(JsonDocument& doc, ArmSource s) {
  const char* name = toString(s);
  if (name) doc["armSource"] = name; else doc["armSource"] = nullptr;
}

size_t buildHeartbeat(const Job& job, const char* deviceId, int rssi, uint32_t uptime, uint32_t freeHeap, char* out, size_t cap) {
  JsonDocument doc;
  doc["kind"] = "heartbeat";
  doc["deviceId"] = deviceId;
  doc["state"] = toString(job.heartbeat.state);
  putSource(doc, job.heartbeat.source);
  doc["rssi"] = rssi;
  doc["uptime"] = uptime;
  doc["resetReason"] = resetReasonName();
  doc["brightness"] = job.heartbeat.brightness;
  doc["freeHeap"] = freeHeap;
  doc["configVersion"] = job.heartbeat.configVersion;
  doc["ts"] = job.heartbeat.ts;
  return serializeJson(doc, out, cap);
}

size_t buildState(const Job& job, const char* deviceId, char* out, size_t cap) {
  JsonDocument doc;
  doc["kind"] = "state";
  doc["deviceId"] = deviceId;
  doc["state"] = toString(job.state.state);
  putSource(doc, job.state.source);
  if (job.state.state == DeviceState::ExitCountdown) doc["countdownEndsAt"] = job.state.countdownEndsAt;
  doc["ts"] = job.state.ts;
  return serializeJson(doc, out, cap);
}

size_t buildEvent(const EventJob& ev, const char* deviceId, const String* blobs, int uploaded, char* out, size_t cap) {
  JsonDocument doc;
  doc["kind"] = "event";
  doc["deviceId"] = deviceId;
  doc["type"] = ev.type;
  if (ev.zone[0]) doc["zone"] = ev.zone;
  doc["score"] = ev.score;
  doc["photoCount"] = ev.photoCount;
  JsonArray photos = doc["photos"].to<JsonArray>();
  for (int i = 0; i < uploaded; i++) photos.add(blobs[i]);
  doc["ts"] = ev.ts;
  return serializeJson(doc, out, cap);
}

size_t buildSnapshot(const char* deviceId, const String& blob, uint32_t ts, char* out, size_t cap) {
  JsonDocument doc;
  doc["kind"] = "snapshot";
  doc["deviceId"] = deviceId;
  doc["blob"] = blob;
  doc["ts"] = ts;
  return serializeJson(doc, out, cap);
}
