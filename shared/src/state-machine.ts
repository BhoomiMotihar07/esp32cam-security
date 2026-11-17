/**
 * The arming state machine, written once in TypeScript so the simulator runs it and the
 * tests pin its behaviour. The firmware copy (firmware/src/control/AlarmStateMachine.cpp)
 * follows the same table; docs/test-plan.md lists the transitions to verify on hardware.
 *
 *   DISARMED --arm--> EXIT_COUNTDOWN --(exit delay elapsed)--> ARMED --candidate--> ALARM
 *   ALARM --ack--> ARMED        ALARM --disarm--> DISARMED
 *   any --disarm--> DISARMED    EXIT_COUNTDOWN --disarm--> DISARMED
 */
import type { ArmSource, DeviceState } from "./device-contract.js";

export interface MachineState {
  state: DeviceState;
  armSource: ArmSource | null;
  /** epoch seconds when EXIT_COUNTDOWN ends; undefined otherwise */
  countdownEndsAt?: number;
  /** epoch seconds when the alarm started; undefined otherwise */
  alarmSince?: number;
}

export type MachineInput =
  | { type: "arm"; source: ArmSource; now: number; exitDelaySec: number }
  | { type: "disarm"; now: number }
  | { type: "tick"; now: number }
  | { type: "candidate"; now: number }
  | { type: "ack"; now: number };

export const INITIAL_MACHINE: MachineState = { state: "DISARMED", armSource: null };

/** Pure transition function: returns the next state and whether it changed. */
export function transition(current: MachineState, input: MachineInput): { next: MachineState; changed: boolean } {
  switch (input.type) {
    case "arm":
      if (current.state !== "DISARMED") return { next: current, changed: false };
      if (input.exitDelaySec <= 0) {
        return { next: { state: "ARMED", armSource: input.source }, changed: true };
      }
      return {
        next: { state: "EXIT_COUNTDOWN", armSource: input.source, countdownEndsAt: input.now + input.exitDelaySec },
        changed: true,
      };

    case "disarm":
      if (current.state === "DISARMED") return { next: current, changed: false };
      return { next: { state: "DISARMED", armSource: null }, changed: true };

    case "tick":
      if (current.state === "EXIT_COUNTDOWN" && current.countdownEndsAt !== undefined && input.now >= current.countdownEndsAt) {
        return { next: { state: "ARMED", armSource: current.armSource }, changed: true };
      }
      return { next: current, changed: false };

    case "candidate":
      // Only an ARMED device raises an alarm. During EXIT_COUNTDOWN the owner is still leaving.
      if (current.state !== "ARMED") return { next: current, changed: false };
      return { next: { state: "ALARM", armSource: current.armSource, alarmSince: input.now }, changed: true };

    case "ack":
      // Acknowledging silences the alarm but the system stays armed.
      if (current.state !== "ALARM") return { next: current, changed: false };
      return { next: { state: "ARMED", armSource: current.armSource }, changed: true };
  }
}

/** Detectors only run while armed or alarmed; this keeps the rule in one place. */
export function detectorsActive(state: DeviceState): boolean {
  return state === "ARMED" || state === "ALARM";
}
