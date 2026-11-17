#include "Controller.h"
#include "../config.h"
#include "../net/Messages.h"

void Controller::setup() {
  Serial.begin(115200);
  delay(200);
  log_i("ESP32-CAM home security fw %s, reset reason %s, psram %u", FIRMWARE_VERSION, resetReasonName(), ESP.getPsramSize());

  leds_.begin();
  button_.begin(PIN_BUTTON);
  if (!config_.load()) config_ = DeviceConfig::defaults();

  if (!camera_.begin()) {
    // Without a camera the board still runs the sound sensor + indicators and reports via heartbeat.
    log_e("camera unavailable; running sound-only");
  }
  motion_.begin(MOTION_FRAME_W, MOTION_FRAME_H);
  tamper_.begin(MOTION_FRAME_W, MOTION_FRAME_H);
  sound_.begin(PIN_SOUND_DO, SOUND_ACTIVE_LOW);
  applyConfig(config_);

  jobs_ = xQueueCreate(8, sizeof(Job));
  commands_ = xQueueCreate(8, sizeof(Command));
  net_ = new NetworkTask(jobs_, commands_);
  net_->start();
  lastHeartbeatMs_ = millis() - HEARTBEAT_MS + 5000; // first heartbeat 5 s after boot
  publishState();
}

void Controller::loop() {
  uint32_t nowMs = millis();
  handleCommands();
  handleButton(nowMs);

  if (machine_.tick(nowEpoch())) { enterArmed(); onStateChanged(); }
  handleSchedule(nowEpoch());
  handleVision(nowMs);
  handleSound(nowMs);

  if (nowMs - lastHeartbeatMs_ >= HEARTBEAT_MS) publishHeartbeat();

  bool wifiUp = net_->wifiUp();
  if (wifiUp != wasWifiUp_) { wasWifiUp_ = wifiUp; leds_.setWifiLost(!wifiUp); log_w("wifi %s", wifiUp ? "up" : "LOST: working offline"); }
  uint32_t remaining = machine_.countdownEndsAtEpoch() > nowEpoch() ? machine_.countdownEndsAtEpoch() - nowEpoch() : 0;
  leds_.setState(machine_.state(), remaining);
  leds_.update(nowMs);
  logStats(nowMs);
}

// ---------- inputs ----------

void Controller::handleCommands() {
  Command c;
  while (xQueueReceive(commands_, &c, 0) == pdTRUE) {
    switch (c.type) {
      case CommandType::Arm: arm(c.source); break;
      case CommandType::Disarm: disarm(); break;
      case CommandType::Ack: if (machine_.ack()) onStateChanged(); break;
      case CommandType::Ping: leds_.ping(); break;
      case CommandType::Snapshot: takeSnapshot(); break;
      case CommandType::SetConfig: {
        DeviceConfig cfg;
        if (c.configJson && cfg.fromJson(c.configJson, c.configLen)) {
          applyConfig(cfg);
          config_.save();
          log_i("config v%lu applied (%d zones)", config_.version, config_.zoneCount);
          publishHeartbeat(); // tells the app which version is now applied
        } else {
          log_w("setConfig rejected: malformed");
        }
        free(c.configJson);
        break;
      }
    }
  }
}

void Controller::handleButton(uint32_t nowMs) {
  if (!button_.pressed(nowMs)) return;
  if (machine_.state() == DeviceState::Disarmed) arm(ArmSource::Button);
  else disarm(); // in ALARM, EXIT_COUNTDOWN or ARMED the button is the local override
}

void Controller::handleSchedule(uint32_t nowEpoch) {
  if (!nowEpoch) return; // no NTP yet
  ScheduleWant w = scheduler_.edge(config_, nowEpoch);
  if (w == ScheduleWant::Armed) arm(ArmSource::Schedule, 0);
  else if (w == ScheduleWant::Disarmed && machine_.source() == ArmSource::Schedule) disarm();
}

void Controller::handleVision(uint32_t nowMs) {
  if (camera_.mode() != CameraService::Mode::Gray) return;
  GrayFrame f;
  if (!camera_.grabGray(f)) return;
  const int n = f.width * f.height;
  lastBrightness_ = TamperDetector::meanOf(f.pixels, n);

  // Night auto-arm uses the camera as the light sensor.
  bool darkLong = night_.update(lastBrightness_, camera_.aecValue(), CameraService::aecMax(), camera_.exposureLocked(), nowMs);
  if (darkLong && config_.autoArmWhenDark && machine_.state() == DeviceState::Disarmed) arm(ArmSource::AutoDark, 0);

  if (!machine_.detectorsActive()) { camera_.releaseGray(); return; }

  if (needReference_ && nowMs >= skipMotionUntilMs_) {
    // The light switch settled: this frame is the new "empty room".
    tamper_.captureReference(f.pixels);
    needReference_ = false;
  }
  TamperResult t = tamper_.update(f.pixels, nowMs);
  MotionResult m = motion_.update(f.pixels);
  camera_.releaseGray();

  // A whole-frame change (light switched) is not an intruder: pause briefly and re-reference instead of alarming.
  if (m.globalChange > 0.6f && t.kind == TamperKind::None) {
    skipMotionUntilMs_ = nowMs + SCENE_CHANGE_SKIP_MS;
    needReference_ = true;
    motion_.reset();
    log_i("scene change (%.0f%% of frame): re-referencing", m.globalChange * 100);
    return;
  }
  if (nowMs < skipMotionUntilMs_) return;

  if (t.kind != TamperKind::None && nowMs - lastTamperEventMs_ > TAMPER_COOLDOWN_MS) {
    lastTamperEventMs_ = nowMs;
    raiseEvent(t.kind == TamperKind::Dark ? "tamper_dark" : "tamper_moved", "", t.score, nowMs);
    return;
  }
  if (m.motion && nowMs - lastMotionEventMs_ > MOTION_COOLDOWN_MS && machine_.state() == DeviceState::Armed) {
    lastMotionEventMs_ = nowMs;
    raiseEvent("motion", config_.zones[m.zoneIndex].name, m.score, nowMs);
  }
}

void Controller::handleSound(uint32_t nowMs) {
  SoundResult r;
  if (!sound_.poll(nowMs, r)) return;
  if (r.spike) log_i("sound: %d pulses vs baseline %.1f (x%.1f)", r.pulses, r.baseline, r.score);
  if (r.spike && machine_.state() == DeviceState::Armed && nowMs - lastSoundEventMs_ > SOUND_COOLDOWN_MS) {
    lastSoundEventMs_ = nowMs;
    raiseEvent("sound", "", r.score, nowMs);
  }
}

// ---------- actions ----------

void Controller::arm(ArmSource src, uint32_t exitDelayOverride) {
  uint32_t delaySec = exitDelayOverride != 0xFFFFFFFF ? exitDelayOverride : config_.exitDelaySec;
  if (!machine_.arm(src, nowEpoch(), delaySec)) return;
  if (machine_.state() == DeviceState::Armed) enterArmed();
  onStateChanged();
}

void Controller::disarm() {
  if (!machine_.disarm()) return;
  camera_.unlockExposure();
  onStateChanged();
}

void Controller::onStateChanged() {
  log_i("state -> %s (%s)", toString(machine_.state()), toString(machine_.source()) ? toString(machine_.source()) : "-");
  publishState();
}

// Becoming ARMED: let AE converge on the empty room, freeze it, then remember the scene.
void Controller::enterArmed() {
  armedSinceMs_ = millis();
  if (camera_.mode() != CameraService::Mode::Gray) return;
  camera_.unlockExposure();
  uint32_t until = millis() + AE_SETTLE_MS;
  GrayFrame f;
  while (millis() < until) { if (camera_.grabGray(f)) camera_.releaseGray(); }
  camera_.lockExposure();
  motion_.reset();
  if (camera_.grabGray(f)) { tamper_.captureReference(f.pixels); motion_.update(f.pixels); camera_.releaseGray(); }
  lastMotionEventMs_ = lastSoundEventMs_ = lastTamperEventMs_ = 0;
}

void Controller::raiseEvent(const char* type, const char* zone, float score, uint32_t nowMs) {
  Job job = {};
  job.type = JobType::Event;
  strlcpy(job.event.type, type, sizeof(job.event.type));
  strlcpy(job.event.zone, zone, sizeof(job.event.zone));
  job.event.score = score;
  job.event.ts = nowEpoch();
  log_w("EVENT %s%s%s score %.2f", type, zone[0] ? " in " : "", zone, score);

  captureBurst(job.event);
  if (xQueueSend(jobs_, &job, pdMS_TO_TICKS(100)) != pdTRUE) {
    log_e("job queue full, photos dropped");
    for (auto& p : job.event.photos) free(p.data);
  }
  if (machine_.candidate()) onStateChanged();
}

// Switch to JPEG SVGA, flash if dark, three photos 300 ms apart, back to gray and re-reference.
bool Controller::captureBurst(EventJob& ev) {
  uint32_t t0 = millis();
  bool night = night_.isDarkNow() || lastBrightness_ < config_.nightThreshold;
  if (night) leds_.setFlashForCapture(true); // only after the trigger, never while watching
  ev.photoCount = 0;
  if (!camera_.setMode(CameraService::Mode::Jpeg)) { leds_.setFlashForCapture(false); return false; }
  uint32_t reinitMs = camera_.lastReinitMs();
  JpegPhoto scratch = {};
  for (int i = 0; i < BURST_FLUSH_FRAMES; i++) if (camera_.captureJpeg(scratch)) { free(scratch.data); scratch.data = nullptr; }
  lastBurstBytes_ = 0;
  for (int i = 0; i < BURST_PHOTOS; i++) {
    uint32_t shot = millis();
    if (camera_.captureJpeg(ev.photos[i])) { ev.photoCount++; lastBurstBytes_ += ev.photos[i].len; }
    uint32_t spent = millis() - shot;
    if (i < BURST_PHOTOS - 1 && spent < BURST_GAP_MS) delay(BURST_GAP_MS - spent);
  }
  leds_.setFlashForCapture(false);
  camera_.setMode(CameraService::Mode::Gray);
  lastBurstMs_ = millis() - t0;
  log_i("burst: %d photos, %lu bytes, reinit %lu ms, total %lu ms", ev.photoCount, lastBurstBytes_, reinitMs, lastBurstMs_);
  if (machine_.detectorsActive()) enterArmed(); // exposure changed: new reference
  return ev.photoCount > 0;
}

void Controller::takeSnapshot() {
  Job job = {};
  job.type = JobType::Snapshot;
  job.snapshot.ts = nowEpoch();
  bool armed = machine_.detectorsActive();
  if (!camera_.setMode(CameraService::Mode::Jpeg)) return;
  JpegPhoto scratch = {};
  for (int i = 0; i < BURST_FLUSH_FRAMES; i++) if (camera_.captureJpeg(scratch)) { free(scratch.data); scratch.data = nullptr; }
  bool ok = camera_.captureJpeg(job.snapshot.photo);
  camera_.setMode(CameraService::Mode::Gray);
  if (armed) enterArmed();
  if (ok && xQueueSend(jobs_, &job, pdMS_TO_TICKS(100)) != pdTRUE) free(job.snapshot.photo.data);
}

void Controller::applyConfig(const DeviceConfig& cfg) {
  config_ = cfg;
  motion_.setZones(config_.zones, config_.zoneCount);
  motion_.setThreshold(config_.motionThreshold);
  sound_.setSensitivity(config_.soundSensitivity);
  night_.setThreshold(config_.nightThreshold);
}

// ---------- telemetry ----------

void Controller::publishState() {
  Job job = {};
  job.type = JobType::State;
  job.state.state = machine_.state();
  job.state.source = machine_.source();
  job.state.countdownEndsAt = machine_.countdownEndsAtEpoch();
  job.state.ts = nowEpoch();
  xQueueSend(jobs_, &job, 0);
}

void Controller::publishHeartbeat() {
  lastHeartbeatMs_ = millis();
  Job job = {};
  job.type = JobType::Heartbeat;
  job.heartbeat.state = machine_.state();
  job.heartbeat.source = machine_.source();
  job.heartbeat.brightness = lastBrightness_;
  job.heartbeat.configVersion = config_.version;
  job.heartbeat.ts = nowEpoch();
  xQueueSend(jobs_, &job, 0);
}

// Numbers for the README: fps in the gray loop, last burst timing, heap.
void Controller::logStats(uint32_t nowMs) {
  if (nowMs - lastStatsMs_ < 10000) return;
  lastStatsMs_ = nowMs;
  log_i("stats: %s gray %.1f fps, brightness %u, last burst %lu ms / %lu B, heap %u, psram %u, wifi %s, cloud %s",
        toString(machine_.state()), camera_.grayFps(), lastBrightness_, lastBurstMs_, lastBurstBytes_,
        ESP.getFreeHeap(), ESP.getFreePsram(), net_->wifiUp() ? "up" : "down", net_->cloudUp() ? "up" : "down");
}
