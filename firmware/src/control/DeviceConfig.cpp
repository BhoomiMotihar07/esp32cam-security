#include "DeviceConfig.h"
#include <ArduinoJson.h>
#include <Preferences.h>

static const char* NVS_NS = "homesec";
static const char* NVS_KEY = "config";

DeviceConfig DeviceConfig::defaults() {
  DeviceConfig c;
  strlcpy(c.zones[0].id, "z1", sizeof(c.zones[0].id));
  strlcpy(c.zones[0].name, "Whole frame", sizeof(c.zones[0].name));
  c.zones[0].enabled = true;
  c.zones[0].x = 0; c.zones[0].y = 0; c.zones[0].w = 1; c.zones[0].h = 1;
  c.zoneCount = 1;
  return c;
}

static int16_t parseHHMM(const char* s) {
  if (!s || strlen(s) < 4) return -1;
  int h = atoi(s);
  const char* colon = strchr(s, ':');
  int m = colon ? atoi(colon + 1) : 0;
  if (h < 0 || h > 23 || m < 0 || m > 59) return -1;
  return int16_t(h * 60 + m);
}

bool DeviceConfig::fromJson(const char* json, size_t len) {
  JsonDocument doc;
  if (deserializeJson(doc, json, len)) return false;
  DeviceConfig c = defaults();
  c.version = doc["version"] | 1;
  c.motionThreshold = constrain(float(doc["motionThreshold"] | 0.08f), 0.01f, 0.5f);
  c.soundSensitivity = constrain(int(doc["soundSensitivity"] | 5), 1, 10);
  c.nightThreshold = uint8_t(constrain(int(doc["nightThreshold"] | 40), 0, 255));
  c.autoArmWhenDark = doc["autoArmWhenDark"] | false;
  c.exitDelaySec = uint16_t(constrain(int(doc["exitDelaySec"] | 30), 0, 300));

  JsonArray zones = doc["zones"].as<JsonArray>();
  c.zoneCount = 0;
  for (JsonObject z : zones) {
    if (c.zoneCount >= MAX_ZONES) break;
    Zone& out = c.zones[c.zoneCount++];
    strlcpy(out.id, z["id"] | "z", sizeof(out.id));
    strlcpy(out.name, z["name"] | "zone", sizeof(out.name));
    out.enabled = z["enabled"] | true;
    out.x = constrain(float(z["x"] | 0.0f), 0.0f, 1.0f);
    out.y = constrain(float(z["y"] | 0.0f), 0.0f, 1.0f);
    out.w = constrain(float(z["w"] | 1.0f), 0.0f, 1.0f - out.x);
    out.h = constrain(float(z["h"] | 1.0f), 0.0f, 1.0f - out.y);
  }
  if (c.zoneCount == 0) c = defaults(), c.version = doc["version"] | 1;

  JsonObject sch = doc["schedule"].as<JsonObject>();
  c.scheduleEnabled = sch["enabled"] | false;
  c.tzOffsetMin = int16_t(constrain(int(sch["tzOffsetMin"] | 330), -720, 840));
  c.scheduleCount = 0;
  for (JsonObject e : sch["entries"].as<JsonArray>()) {
    if (c.scheduleCount >= MAX_SCHEDULE_ENTRIES) break;
    ScheduleEntry& out = c.schedule[c.scheduleCount];
    out.daysMask = 0;
    for (int d : e["days"].as<JsonArray>()) if (d >= 0 && d <= 6) out.daysMask |= 1 << d;
    out.armMin = parseHHMM(e["armAt"] | "");
    out.disarmMin = parseHHMM(e["disarmAt"] | "");
    if (out.armMin < 0 || out.disarmMin < 0) continue;
    c.scheduleCount++;
  }
  *this = c;
  return true;
}

size_t DeviceConfig::toJson(char* out, size_t cap) const {
  JsonDocument doc;
  doc["version"] = version;
  doc["motionThreshold"] = motionThreshold;
  doc["soundSensitivity"] = soundSensitivity;
  doc["nightThreshold"] = nightThreshold;
  doc["autoArmWhenDark"] = autoArmWhenDark;
  doc["exitDelaySec"] = exitDelaySec;
  JsonArray zs = doc["zones"].to<JsonArray>();
  for (int i = 0; i < zoneCount; i++) {
    JsonObject z = zs.add<JsonObject>();
    z["id"] = zones[i].id; z["name"] = zones[i].name; z["enabled"] = zones[i].enabled;
    z["x"] = zones[i].x; z["y"] = zones[i].y; z["w"] = zones[i].w; z["h"] = zones[i].h;
  }
  JsonObject sch = doc["schedule"].to<JsonObject>();
  sch["enabled"] = scheduleEnabled;
  sch["tzOffsetMin"] = tzOffsetMin;
  JsonArray es = sch["entries"].to<JsonArray>();
  char buf[6];
  for (int i = 0; i < scheduleCount; i++) {
    JsonObject e = es.add<JsonObject>();
    JsonArray days = e["days"].to<JsonArray>();
    for (int d = 0; d < 7; d++) if (schedule[i].daysMask & (1 << d)) days.add(d);
    snprintf(buf, sizeof(buf), "%02d:%02d", schedule[i].armMin / 60, schedule[i].armMin % 60); e["armAt"] = String(buf);
    snprintf(buf, sizeof(buf), "%02d:%02d", schedule[i].disarmMin / 60, schedule[i].disarmMin % 60); e["disarmAt"] = String(buf);
  }
  return serializeJson(doc, out, cap);
}

bool DeviceConfig::load() {
  Preferences p;
  if (!p.begin(NVS_NS, true)) return false;
  String s = p.getString(NVS_KEY, "");
  p.end();
  if (s.isEmpty()) return false;
  return fromJson(s.c_str(), s.length());
}

bool DeviceConfig::save() const {
  char buf[3072];
  size_t n = toJson(buf, sizeof(buf));
  if (n == 0 || n >= sizeof(buf)) return false;
  Preferences p;
  if (!p.begin(NVS_NS, false)) return false;
  bool ok = p.putString(NVS_KEY, buf) > 0;
  p.end();
  return ok;
}
