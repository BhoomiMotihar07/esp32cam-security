// Same table as shared/src/state-machine.ts:
//   DISARMED -arm-> EXIT_COUNTDOWN -(delay)-> ARMED -candidate-> ALARM -ack-> ARMED ; any -disarm-> DISARMED
#pragma once
#include <Arduino.h>

enum class DeviceState : uint8_t { Disarmed, ExitCountdown, Armed, Alarm };
enum class ArmSource : uint8_t { None, App, Schedule, AutoDark, Button, Telegram };

const char* toString(DeviceState s);
const char* toString(ArmSource s);
ArmSource armSourceFrom(const char* s);

class AlarmStateMachine {
public:
  DeviceState state() const { return state_; }
  ArmSource source() const { return source_; }
  uint32_t countdownEndsAtEpoch() const { return countdownEnds_; }
  bool detectorsActive() const { return state_ == DeviceState::Armed || state_ == DeviceState::Alarm; }

  // Each returns true when the state changed (caller publishes a state message).
  bool arm(ArmSource src, uint32_t nowEpoch, uint32_t exitDelaySec);
  bool disarm();
  bool tick(uint32_t nowEpoch);
  bool candidate();
  bool ack();

private:
  DeviceState state_ = DeviceState::Disarmed;
  ArmSource source_ = ArmSource::None;
  uint32_t countdownEnds_ = 0;
};
