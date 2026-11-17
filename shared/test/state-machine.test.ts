import { describe, expect, it } from "vitest";
import { INITIAL_MACHINE, transition, type MachineState } from "../src/state-machine.js";

const arm = (s: MachineState, now = 1000) => transition(s, { type: "arm", source: "app", now, exitDelaySec: 30 }).next;

describe("arming state machine", () => {
  it("DISARMED -> EXIT_COUNTDOWN on arm, with the countdown end stamped", () => {
    const s = arm(INITIAL_MACHINE);
    expect(s.state).toBe("EXIT_COUNTDOWN");
    expect(s.countdownEndsAt).toBe(1030);
    expect(s.armSource).toBe("app");
  });

  it("EXIT_COUNTDOWN -> ARMED only once the exit delay has elapsed", () => {
    const s = arm(INITIAL_MACHINE);
    expect(transition(s, { type: "tick", now: 1029 }).next.state).toBe("EXIT_COUNTDOWN");
    expect(transition(s, { type: "tick", now: 1030 }).next.state).toBe("ARMED");
  });

  it("arm with zero exit delay goes straight to ARMED (auto-dark, schedule)", () => {
    const s = transition(INITIAL_MACHINE, { type: "arm", source: "auto_dark", now: 1, exitDelaySec: 0 }).next;
    expect(s.state).toBe("ARMED");
  });

  it("candidate events are ignored unless ARMED", () => {
    expect(transition(INITIAL_MACHINE, { type: "candidate", now: 1 }).changed).toBe(false);
    const counting = arm(INITIAL_MACHINE);
    expect(transition(counting, { type: "candidate", now: 1 }).changed).toBe(false);
    const armed = transition(counting, { type: "tick", now: 2000 }).next;
    const alarm = transition(armed, { type: "candidate", now: 2001 }).next;
    expect(alarm.state).toBe("ALARM");
    expect(alarm.alarmSince).toBe(2001);
  });

  it("ack returns ALARM to ARMED and keeps the arm source", () => {
    const armed = transition(arm(INITIAL_MACHINE), { type: "tick", now: 2000 }).next;
    const alarm = transition(armed, { type: "candidate", now: 2001 }).next;
    const after = transition(alarm, { type: "ack", now: 2002 }).next;
    expect(after).toEqual({ state: "ARMED", armSource: "app" });
  });

  it("disarm works from every non-disarmed state and is a no-op when already disarmed", () => {
    expect(transition(INITIAL_MACHINE, { type: "disarm", now: 1 }).changed).toBe(false);
    const counting = arm(INITIAL_MACHINE);
    expect(transition(counting, { type: "disarm", now: 1 }).next).toEqual(INITIAL_MACHINE);
    const armed = transition(counting, { type: "tick", now: 2000 }).next;
    expect(transition(armed, { type: "disarm", now: 1 }).next).toEqual(INITIAL_MACHINE);
    const alarm = transition(armed, { type: "candidate", now: 1 }).next;
    expect(transition(alarm, { type: "disarm", now: 1 }).next).toEqual(INITIAL_MACHINE);
  });

  it("arming while already armed does nothing", () => {
    const armed = transition(arm(INITIAL_MACHINE), { type: "tick", now: 2000 }).next;
    expect(transition(armed, { type: "arm", source: "button", now: 1, exitDelaySec: 30 }).changed).toBe(false);
  });
});
