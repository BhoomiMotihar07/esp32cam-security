#include "NetworkTask.h"
#include <ArduinoJson.h>
#include <ArduinoOTA.h>
#include "Messages.h"
#include "../config.h"
#include "../../include/secrets.h"

// Older secrets.h files do not define this; default to the Azure / Telegram behaviour.
#ifndef USE_LOCAL_DEV_SERVER
#define USE_LOCAL_DEV_SERVER 0
#endif

NetworkTask::NetworkTask(QueueHandle_t jobs, QueueHandle_t commands)
    : jobs_(jobs), commands_(commands),
      azure_(AZURE_IOT_HUB_HOST, DEVICE_ID, AZURE_DEVICE_KEY),
      local_(API_BASE_URL, DEVICE_ID, DEVICE_UPLOAD_KEY),
      blobs_(API_BASE_URL, DEVICE_ID, DEVICE_UPLOAD_KEY),
      telegram_(TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID) {}

void NetworkTask::start() {
  bootMs_ = millis();
  wifi_.begin(WIFI_SSID, WIFI_PASSWORD);
  azure_.onCommand([this](const char* json, size_t len) { onC2D(json, len); });
  local_.onCommand([this](const char* json, size_t len) { onC2D(json, len); });
  useLocal_ = USE_LOCAL_DEV_SERVER && !azure_.configured();
  log_i("cloud link: %s", azure_.configured() ? "Azure IoT Hub" : useLocal_ ? "HTTPS device link (" API_BASE_URL ")" : "none (Telegram fallback only)");
  // 12 KB stack: TLS handshakes for HTTPS uploads happen on this task.
  xTaskCreatePinnedToCore(taskEntry, "net", 12288, this, 1, nullptr, 0);
}

void NetworkTask::taskEntry(void* arg) { static_cast<NetworkTask*>(arg)->run(); }

void NetworkTask::run() {
  Job job;
  for (;;) {
    wifi_.loop();
    if (wifi_.connected()) {
      if (!otaStarted_) setupOta();
      ArduinoOTA.handle();
    }
    azure_.loop(wifi_.connected(), wifi_.timeValid());
    if (useLocal_ && wifi_.connected() && wifi_.timeValid()) local_.poll(millis());
    if (cloudUp() && offlineCount_ > 0) drainOffline();
    if (xQueueReceive(jobs_, &job, pdMS_TO_TICKS(200)) == pdTRUE) handleJob(job);
  }
}

// One heavy network job at a time: this task is the only one that opens TLS sessions,
// and it finishes every upload before publishing the event that references it.
void NetworkTask::handleJob(Job& job) {
  char buf[1024];
  size_t n = 0;
  stampIfUnset(job);
  switch (job.type) {
    case JobType::Heartbeat:
      n = buildHeartbeat(job, DEVICE_ID, wifi_.rssi(), (millis() - bootMs_) / 1000, ESP.getFreeHeap(), buf, sizeof(buf));
      if (!publish(buf, n)) log_d("heartbeat not sent (offline)");
      return;
    case JobType::State:
      n = buildState(job, DEVICE_ID, buf, sizeof(buf));
      if (!publish(buf, n)) log_d("state not sent (offline)");
      return;
    case JobType::Snapshot: {
      String blob;
      bool ok = wifi_.connected() && blobs_.upload(0, job.snapshot.photo.data, job.snapshot.photo.len, blob);
      free(job.snapshot.photo.data);
      if (ok) { n = buildSnapshot(DEVICE_ID, blob, job.snapshot.ts, buf, sizeof(buf)); publish(buf, n); }
      return;
    }
    case JobType::Event:
      if (!wifi_.connected()) { queueOffline(job); return; }
      if (!sendEvent(job.event)) queueOffline(job); else freePhotos(job.event);
      return;
  }
}

// Over-the-air updates: after the first USB flash, `pio run -e esp32cam-ota -t upload` sends new
// firmware over Wi-Fi. Password-protected with the device upload key; the min_spiffs partition
// keeps two app slots, so a failed update leaves the old firmware running.
void NetworkTask::setupOta() {
  ArduinoOTA.setHostname(DEVICE_ID);
  ArduinoOTA.setPassword(DEVICE_UPLOAD_KEY);
  ArduinoOTA.onStart([]() { log_w("OTA update starting"); });
  ArduinoOTA.onEnd([]() { log_w("OTA update done, rebooting"); });
  ArduinoOTA.onError([](ota_error_t e) { log_e("OTA error %u", e); });
  ArduinoOTA.begin();
  otaStarted_ = true;
  log_i("OTA ready: %s.local / %s", DEVICE_ID, WiFi.localIP().toString().c_str());
}

bool NetworkTask::publish(const char* json, size_t len) {
  if (useLocal_) return wifi_.connected() && local_.publish(json, len);
  return azure_.publish(json, len);
}

// Jobs created before NTP answered carry ts = 0; the backend rejects those, so stamp them now.
void NetworkTask::stampIfUnset(Job& job) {
  if (!wifi_.timeValid()) return;
  uint32_t now = time(nullptr);
  switch (job.type) {
    case JobType::Heartbeat: if (!job.heartbeat.ts) job.heartbeat.ts = now; break;
    case JobType::State: if (!job.state.ts) job.state.ts = now; break;
    case JobType::Event: if (!job.event.ts) job.event.ts = now; break;
    case JobType::Snapshot: if (!job.snapshot.ts) job.snapshot.ts = now; break;
  }
}

bool NetworkTask::sendEvent(EventJob& ev) {
  String blobs[3];
  int uploaded = 0;
  uint32_t t0 = millis();
  for (int i = 0; i < ev.photoCount; i++) {
    if (!ev.photos[i].data) continue;
    if (blobs_.upload(i, ev.photos[i].data, ev.photos[i].len, blobs[uploaded])) uploaded++;
  }
  log_i("event %s: %d/%d photos uploaded in %lu ms", ev.type, uploaded, ev.photoCount, millis() - t0);

  char buf[1024];
  size_t n = buildEvent(ev, DEVICE_ID, blobs, uploaded, buf, sizeof(buf));
  bool published = publish(buf, n);

  // Direct Telegram when there is no hub configured, or the hub is unreachable while Wi-Fi works.
  if (!published && telegram_.configured()) {
    String caption = String("🚨 ") + ev.type + (ev.zone[0] ? String(" in ") + ev.zone : "") + " · " + DEVICE_ID;
    if (ev.photoCount > 0 && ev.photos[0].data) telegram_.sendPhoto(ev.photos[0].data, ev.photos[0].len, caption);
    else telegram_.sendMessage(caption);
    return !azure_.configured() && !useLocal_; // Telegram is the delivery only when there is no cloud at all; otherwise keep the event queued
  }
  return published;
}

void NetworkTask::freePhotos(EventJob& ev) {
  for (int i = 0; i < 3; i++) { free(ev.photos[i].data); ev.photos[i].data = nullptr; ev.photos[i].len = 0; }
}

// RAM queue while offline. Beyond MAX_QUEUED_EVENTS the oldest event's photos are dropped
// (its JSON is still sent with photoCount but no blob names) to bound PSRAM use.
void NetworkTask::queueOffline(Job& job) {
  if (offlineCount_ >= MAX_QUEUED_EVENTS) {
    freePhotos(offline_[0].event);
    for (int i = 1; i < offlineCount_; i++) offline_[i - 1] = offline_[i];
    offlineCount_--;
  }
  offline_[offlineCount_++] = job;
  log_w("event queued offline (%d waiting)", offlineCount_);
}

void NetworkTask::drainOffline() {
  while (offlineCount_ > 0 && cloudUp()) {
    Job& job = offline_[0];
    if (!sendEvent(job.event)) return; // still failing; try again next loop
    freePhotos(job.event);
    for (int i = 1; i < offlineCount_; i++) offline_[i - 1] = offline_[i];
    offlineCount_--;
  }
}

// Cloud-to-device command: validate shape and age here, hand the decision to the vision/controller task.
void NetworkTask::onC2D(const char* json, size_t len) {
  JsonDocument doc;
  if (deserializeJson(doc, json, len)) { log_w("c2d: bad json"); return; }
  const char* cmd = doc["cmd"] | "";
  uint32_t ts = doc["ts"] | 0;
  uint32_t now = time(nullptr);
  if (ts == 0 || (now > ts && now - ts > COMMAND_MAX_AGE_S)) { log_w("c2d: stale %s ignored (%lu s old)", cmd, now - ts); return; }

  Command c = {};
  c.source = armSourceFrom(doc["source"] | "app");
  if (!strcmp(cmd, "arm")) c.type = CommandType::Arm;
  else if (!strcmp(cmd, "disarm")) c.type = CommandType::Disarm;
  else if (!strcmp(cmd, "snapshot")) c.type = CommandType::Snapshot;
  else if (!strcmp(cmd, "ack")) c.type = CommandType::Ack;
  else if (!strcmp(cmd, "ping")) c.type = CommandType::Ping;
  else if (!strcmp(cmd, "setConfig")) {
    c.type = CommandType::SetConfig;
    String cfg;
    serializeJson(doc["config"], cfg);
    c.configLen = cfg.length();
    c.configJson = static_cast<char*>(malloc(c.configLen + 1));
    if (!c.configJson) return;
    memcpy(c.configJson, cfg.c_str(), c.configLen + 1);
  } else { log_w("c2d: unknown cmd %s", cmd); return; }
  if (xQueueSend(commands_, &c, 0) != pdTRUE && c.configJson) free(c.configJson);
}
