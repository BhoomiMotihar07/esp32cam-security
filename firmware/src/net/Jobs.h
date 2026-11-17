// Messages between the vision task (core 1) and the network task (core 0).
// Photos travel as PSRAM pointers; the network task frees them after upload.
#pragma once
#include <Arduino.h>
#include "../camera/CameraService.h"
#include "../control/AlarmStateMachine.h"
#include "../control/DeviceConfig.h"

enum class JobType : uint8_t { Event, State, Heartbeat, Snapshot };

struct EventJob {
  char type[16];        // motion | sound | tamper_dark | tamper_moved
  char zone[24];        // "" when not zone based
  float score;
  uint32_t ts;          // epoch seconds
  int photoCount;
  JpegPhoto photos[3];
};

struct Job {
  JobType type;
  union {
    EventJob event;
    struct { DeviceState state; ArmSource source; uint32_t countdownEndsAt; uint32_t ts; } state;
    struct { DeviceState state; ArmSource source; uint8_t brightness; uint32_t configVersion; uint32_t ts; } heartbeat;
    struct { JpegPhoto photo; uint32_t ts; } snapshot;
  };
};

// Network -> vision commands (already validated for age by the network task).
enum class CommandType : uint8_t { Arm, Disarm, Snapshot, Ack, Ping, SetConfig };

struct Command {
  CommandType type;
  ArmSource source;      // for Arm/Disarm
  char* configJson;      // SetConfig: heap string, freed by the receiver
  size_t configLen;
};
