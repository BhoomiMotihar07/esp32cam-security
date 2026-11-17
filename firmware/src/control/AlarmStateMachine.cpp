#include "AlarmStateMachine.h"

const char* toString(DeviceState s) {
  switch (s) {
    case DeviceState::Disarmed: return "DISARMED";
    case DeviceState::ExitCountdown: return "EXIT_COUNTDOWN";
    case DeviceState::Armed: return "ARMED";
    case DeviceState::Alarm: return "ALARM";
  }
  return "?";
}

const char* toString(ArmSource s) {
  switch (s) {
    case ArmSource::App: return "app";
    case ArmSource::Schedule: return "schedule";
    case ArmSource::AutoDark: return "auto_dark";
    case ArmSource::Button: return "button";
    case ArmSource::Telegram: return "telegram";
    default: return nullptr; // JSON null
  }
}

ArmSource armSourceFrom(const char* s) {
  if (!s) return ArmSource::App;
  if (!strcmp(s, "schedule")) return ArmSource::Schedule;
  if (!strcmp(s, "auto_dark")) return ArmSource::AutoDark;
  if (!strcmp(s, "button")) return ArmSource::Button;
  if (!strcmp(s, "telegram")) return ArmSource::Telegram;
  return ArmSource::App;
}

bool AlarmStateMachine::arm(ArmSource src, uint32_t nowEpoch, uint32_t exitDelaySec) {
  if (state_ != DeviceState::Disarmed) return false;
  source_ = src;
  if (exitDelaySec == 0) { state_ = DeviceState::Armed; countdownEnds_ = 0; return true; }
  state_ = DeviceState::ExitCountdown;
  countdownEnds_ = nowEpoch + exitDelaySec;
  return true;
}

bool AlarmStateMachine::disarm() {
  if (state_ == DeviceState::Disarmed) return false;
  state_ = DeviceState::Disarmed;
  source_ = ArmSource::None;
  countdownEnds_ = 0;
  return true;
}

bool AlarmStateMachine::tick(uint32_t nowEpoch) {
  if (state_ == DeviceState::ExitCountdown && nowEpoch >= countdownEnds_) {
    state_ = DeviceState::Armed;
    countdownEnds_ = 0;
    return true;
  }
  return false;
}

bool AlarmStateMachine::candidate() {
  if (state_ != DeviceState::Armed) return false; // leaving during the countdown is not an intrusion
  state_ = DeviceState::Alarm;
  return true;
}

bool AlarmStateMachine::ack() {
  if (state_ != DeviceState::Alarm) return false;
  state_ = DeviceState::Armed; // silenced, still armed
  return true;
}
