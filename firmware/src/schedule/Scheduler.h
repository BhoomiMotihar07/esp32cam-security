// Weekly schedule: same rules as shared/src/schedule.ts. Reports edges only, so a manual
// disarm inside a window is respected until the next window begins.
#pragma once
#include <Arduino.h>
#include "../control/DeviceConfig.h"

enum class ScheduleWant : uint8_t { None, Armed, Disarmed };

class Scheduler {
public:
  static ScheduleWant wants(const DeviceConfig& cfg, uint32_t nowEpoch);
  // Returns the new want when it changed since the last call, else None.
  ScheduleWant edge(const DeviceConfig& cfg, uint32_t nowEpoch);

private:
  ScheduleWant last_ = ScheduleWant::None;
  bool primed_ = false;
};
