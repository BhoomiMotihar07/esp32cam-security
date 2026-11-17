#include "Scheduler.h"

ScheduleWant Scheduler::wants(const DeviceConfig& cfg, uint32_t nowEpoch) {
  if (!cfg.scheduleEnabled || cfg.scheduleCount == 0) return ScheduleWant::None;
  int64_t local = int64_t(nowEpoch) + int64_t(cfg.tzOffsetMin) * 60;
  int day = int(((local / 86400) + 4) % 7); // 1970-01-01 was a Thursday (4)
  if (day < 0) day += 7;
  int minute = int((local % 86400) / 60);
  int yesterday = (day + 6) % 7;
  for (int i = 0; i < cfg.scheduleCount; i++) {
    const ScheduleEntry& e = cfg.schedule[i];
    bool today = e.daysMask & (1 << day);
    bool yday = e.daysMask & (1 << yesterday);
    if (e.armMin < e.disarmMin) {
      if (today && minute >= e.armMin && minute < e.disarmMin) return ScheduleWant::Armed;
    } else {
      if (today && minute >= e.armMin) return ScheduleWant::Armed;
      if (yday && minute < e.disarmMin) return ScheduleWant::Armed;
    }
  }
  return ScheduleWant::Disarmed;
}

ScheduleWant Scheduler::edge(const DeviceConfig& cfg, uint32_t nowEpoch) {
  ScheduleWant w = wants(cfg, nowEpoch);
  if (!primed_) { primed_ = true; last_ = w; return ScheduleWant::None; } // no action at boot
  if (w == last_) return ScheduleWant::None;
  last_ = w;
  return w;
}
