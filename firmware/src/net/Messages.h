// JSON builders for the device contract (docs/device-contract.md). Heartbeat stays < 500 bytes.
#pragma once
#include <Arduino.h>
#include "Jobs.h"

const char* resetReasonName();
size_t buildHeartbeat(const Job& job, const char* deviceId, int rssi, uint32_t uptimeSec, uint32_t freeHeap, char* out, size_t cap);
size_t buildState(const Job& job, const char* deviceId, char* out, size_t cap);
size_t buildEvent(const EventJob& ev, const char* deviceId, const String* blobNames, int uploaded, char* out, size_t cap);
size_t buildSnapshot(const char* deviceId, const String& blob, uint32_t ts, char* out, size_t cap);
