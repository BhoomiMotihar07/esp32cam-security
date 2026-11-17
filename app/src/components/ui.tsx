/** Small presentational pieces shared by the screens. */
import type { DeviceState, EventType } from "@esp32cam/shared";
import type { ReactNode } from "react";

export function StatusPill({ state, offline }: { state: DeviceState; offline: boolean }) {
  const label = offline ? "OFFLINE" : state.replace("_", " ");
  const cls = offline ? "bg-slate-600 text-slate-100"
    : state === "ARMED" ? "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/50"
    : state === "ALARM" ? "bg-red-500/20 text-red-300 ring-1 ring-red-500/60 animate-pulse"
    : state === "EXIT_COUNTDOWN" ? "bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/50"
    : "bg-slate-700 text-slate-200";
  return <span className={`inline-block rounded-full px-3 py-1 text-xs font-semibold tracking-wide ${cls}`}>{label}</span>;
}

export const EVENT_LABEL: Record<EventType, string> = {
  motion: "Motion", sound: "Sound", tamper_dark: "Tamper · covered", tamper_moved: "Tamper · moved", offline: "Offline",
};

export function EventIcon({ type }: { type: EventType }) {
  const glyph = { motion: "🏃", sound: "🔊", tamper_dark: "🕶️", tamper_moved: "📐", offline: "📡" }[type];
  return <span aria-hidden className="text-xl leading-none">{glyph}</span>;
}

export function Banner({ tone, children }: { tone: "warn" | "danger" | "info"; children: ReactNode }) {
  const cls = tone === "danger" ? "bg-red-500/15 text-red-200 ring-red-500/40" : tone === "warn" ? "bg-amber-500/15 text-amber-200 ring-amber-500/40" : "bg-sky-500/15 text-sky-200 ring-sky-500/40";
  return <div className={`rounded-xl px-3 py-2 text-sm ring-1 ${cls}`}>{children}</div>;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block"><span className="label">{label}</span>{children}</label>;
}

export function Spinner() {
  return <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-500 border-t-emerald-400" aria-label="loading" />;
}

export function relTime(ts: number | undefined, now = Date.now() / 1000): string {
  if (!ts) return "never";
  const d = Math.max(0, Math.round(now - ts));
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return new Date(ts * 1000).toLocaleString();
}

export function fmtTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function fmtUptime(sec: number | undefined): string {
  if (sec === undefined) return "–";
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}
