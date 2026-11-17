// Runtime configuration pushed by the app (setConfig command) and kept in NVS across reboots.
#pragma once
#include <Arduino.h>
#include "../vision/Zones.h"

constexpr int MAX_SCHEDULE_ENTRIES = 14;

struct ScheduleEntry {
  uint8_t daysMask = 0;     // bit 0 = Sunday
  int16_t armMin = 0;       // minutes after midnight, local time
  int16_t disarmMin = 0;
};

struct DeviceConfig {
  uint32_t version = 1;
  Zone zones[MAX_ZONES];
  int zoneCount = 1;
  float motionThreshold = 0.08f;
  int soundSensitivity = 5;
  uint8_t nightThreshold = 40;
  bool autoArmWhenDark = false;
  uint16_t exitDelaySec = 30;
  bool scheduleEnabled = false;
  int16_t tzOffsetMin = 330;
  ScheduleEntry schedule[MAX_SCHEDULE_ENTRIES];
  int scheduleCount = 0;

  static DeviceConfig defaults();
  // JSON <-> struct (the "config" object of the setConfig command). Returns false on malformed input.
  bool fromJson(const char* json, size_t len);
  size_t toJson(char* out, size_t cap) const;
  bool load();  // from NVS; false if none stored
  bool save() const;
};
