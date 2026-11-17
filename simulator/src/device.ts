/**
 * The simulated ESP32-CAM. Same state machine, schedule rules and message shapes as the
 * firmware, driven by a 1 s tick. Sensors are replaced by `trigger()` calls from the CLI.
 */
import {
  DEFAULT_CONFIG, INITIAL_MACHINE, TIMING, detectorsActive, scheduleWants, transition,
  type ArmSource, type DeviceCommand, type DeviceConfig, type EventMessage, type MachineState,
} from "@esp32cam/shared";
import type { CloudLink } from "./links/types.js";
import { Uploader } from "./uploader.js";
import { renderFrame } from "./camera.js";

export type TriggerType = EventMessage["type"];

export interface DeviceOptions {
  deviceId: string;
  link: CloudLink;
  uploader: Uploader;
  log: (s: string) => void;
  heartbeatSec?: number;
}

const nowSec = () => Math.floor(Date.now() / 1000);

export class SimulatedDevice {
  machine: MachineState = INITIAL_MACHINE;
  config: DeviceConfig = DEFAULT_CONFIG;
  /** 0..1 scene brightness; the app's nightThreshold is on the 0..255 scale */
  sceneBrightness = 0.85;
  resetReason = "POWERON";
  heartbeatsPaused = false;
  private readonly bootAt = nowSec();
  private lastHeartbeat = 0;
  private darkSince: number | null = null;
  private lastScheduleWant: "armed" | "disarmed" | null = null;
  private frameSeed = 0;
  private busy = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly o: DeviceOptions) {}

  async start(): Promise<void> {
    await this.o.link.start((cmd) => void this.onCommand(cmd));
    await this.publishState();
    this.timer = setInterval(() => void this.tick(), 1000);
    this.o.log(`device ${this.o.deviceId} up (${this.machine.state})`);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.o.link.stop();
  }

  get brightness255(): number {
    return Math.round(this.sceneBrightness * 255);
  }

  // ---- inputs ----

  /** Local override button: toggles arm/disarm like the physical GPIO15 button. */
  pressButton(): void {
    if (this.machine.state === "DISARMED") this.apply({ type: "arm", source: "button", now: nowSec(), exitDelaySec: this.config.exitDelaySec });
    else this.apply({ type: "disarm", now: nowSec() });
  }

  /** A detector fired. Mirrors firmware: only while ARMED/ALARM, burst first, then publish, then alarm. */
  async trigger(type: TriggerType, zone?: string, score = 0.42): Promise<void> {
    if (!detectorsActive(this.machine.state)) { this.o.log(`${type} ignored: state is ${this.machine.state}`); return; }
    if (this.busy) { this.o.log(`${type} ignored: capture/upload in progress`); return; }
    this.busy = true;
    try {
      const ts = nowSec();
      const photos: string[] = [];
      for (let seq = 0; seq < TIMING.BURST_PHOTOS; seq++) {
        const frame = renderFrame({ seed: ++this.frameSeed, brightness: type === "tamper_dark" ? 0.03 : this.sceneBrightness, label: `${type}-${seq}` });
        try {
          photos.push(await this.o.uploader.upload(seq, frame.jpeg));
        } catch (err) {
          this.o.log(`photo ${seq} upload failed: ${(err as Error).message}`);
        }
        await sleep(TIMING.BURST_GAP_MS);
      }
      const zoneName = zone ?? (type === "motion" ? this.config.zones.find((z) => z.enabled)?.name : undefined);
      await this.o.link.publish({ kind: "event", deviceId: this.o.deviceId, type, zone: zoneName, score, photoCount: photos.length, photos, ts });
      this.o.log(`event ${type}${zoneName ? ` in ${zoneName}` : ""} published with ${photos.length} photo(s)`);
      this.apply({ type: "candidate", now: ts });
    } finally {
      this.busy = false;
    }
  }

  // ---- commands from the cloud ----

  private async onCommand(cmd: DeviceCommand): Promise<void> {
    const age = nowSec() - cmd.ts;
    if (age > TIMING.COMMAND_MAX_AGE_SEC) { this.o.log(`stale ${cmd.cmd} (${age} s old) ignored`); return; }
    this.o.log(`command ${cmd.cmd}`);
    switch (cmd.cmd) {
      case "arm": this.apply({ type: "arm", source: cmd.source, now: nowSec(), exitDelaySec: this.config.exitDelaySec }); break;
      case "disarm": this.apply({ type: "disarm", now: nowSec() }); break;
      case "ack": this.apply({ type: "ack", now: nowSec() }); break;
      case "ping": this.o.log("♪ buzzer chirp + flash LED pattern (I see you)"); break;
      case "snapshot": await this.snapshot(); break;
      case "setConfig": this.config = cmd.config; this.o.log(`config v${cmd.config.version} applied (${cmd.config.zones.length} zones)`); await this.heartbeat(); break;
    }
  }

  private async snapshot(): Promise<void> {
    const frame = renderFrame({ seed: ++this.frameSeed, brightness: this.sceneBrightness, label: "snapshot" });
    try {
      const blob = await this.o.uploader.upload(0, frame.jpeg);
      await this.o.link.publish({ kind: "snapshot", deviceId: this.o.deviceId, blob, ts: nowSec() });
      this.o.log(`snapshot uploaded ${blob}`);
    } catch (err) {
      this.o.log(`snapshot failed: ${(err as Error).message}`);
    }
  }

  // ---- periodic ----

  private async tick(): Promise<void> {
    const now = nowSec();
    this.apply({ type: "tick", now });
    this.checkSchedule(now);
    this.checkAutoDark(now);
    if (!this.heartbeatsPaused && now - this.lastHeartbeat >= (this.o.heartbeatSec ?? TIMING.HEARTBEAT_INTERVAL_SEC)) await this.heartbeat();
  }

  /** Schedule edges only: an owner who disarms manually inside a window stays disarmed. */
  private checkSchedule(now: number): void {
    const want = scheduleWants(this.config.schedule, now);
    if (want === this.lastScheduleWant) return;
    const first = this.lastScheduleWant === null;
    this.lastScheduleWant = want;
    if (first || want === null) return;
    if (want === "armed") this.apply({ type: "arm", source: "schedule", now, exitDelaySec: 0 });
    else if (this.machine.armSource === "schedule") this.apply({ type: "disarm", now });
  }

  /** Dark for 5 continuous minutes while DISARMED → arm with no exit delay. */
  private checkAutoDark(now: number): void {
    if (!this.config.autoArmWhenDark) { this.darkSince = null; return; }
    const dark = this.brightness255 < this.config.nightThreshold;
    if (!dark) { this.darkSince = null; return; }
    this.darkSince ??= now;
    if (this.machine.state === "DISARMED" && now - this.darkSince >= 300) this.apply({ type: "arm", source: "auto_dark", now, exitDelaySec: 0 });
  }

  private async heartbeat(): Promise<void> {
    this.lastHeartbeat = nowSec();
    await this.o.link.publish({
      kind: "heartbeat", deviceId: this.o.deviceId, state: this.machine.state, armSource: this.machine.armSource,
      rssi: -55 - Math.floor(Math.random() * 10), uptime: nowSec() - this.bootAt, resetReason: this.resetReason,
      brightness: this.brightness255, freeHeap: 150_000 + Math.floor(Math.random() * 20_000), configVersion: this.config.version, ts: this.lastHeartbeat,
    }).catch((err) => this.o.log(`heartbeat failed: ${(err as Error).message}`));
  }

  private apply(input: Parameters<typeof transition>[1]): void {
    const { next, changed } = transition(this.machine, input);
    if (!changed) return;
    this.machine = next;
    this.o.log(`state → ${next.state}${next.armSource ? ` (${next.armSource})` : ""}`);
    void this.publishState();
  }

  private async publishState(): Promise<void> {
    await this.o.link.publish({
      kind: "state", deviceId: this.o.deviceId, state: this.machine.state, armSource: this.machine.armSource, countdownEndsAt: this.machine.countdownEndsAt, ts: nowSec(),
    }).catch((err) => this.o.log(`state publish failed: ${(err as Error).message}`));
  }

  /** Used by scripted runs that need "arm now" without a 30 s wait. */
  forceArm(source: ArmSource = "app"): void {
    this.apply({ type: "arm", source, now: nowSec(), exitDelaySec: 0 });
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
