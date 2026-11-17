/**
 * In-app alerts, no Telegram needed. Shown on every tab while any device is in ALARM or has
 * unacknowledged events. On the transition into ALARM it beeps (Web Audio), vibrates, and
 * raises a browser notification if the user has granted permission. Data comes from the same
 * 3 s device poll the Status tab uses; Web Push (sw.js) covers the app-closed case.
 */
import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import type { DeviceView } from "@esp32cam/shared";
import { useDevices } from "../api/hooks";
import { EVENT_LABEL } from "./ui";

export function AlarmBanner() {
  const devices = useDevices();
  const alarmed = (devices.data ?? []).filter((d) => d.state === "ALARM" && !d.offline);
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    const now = new Set(alarmed.map((d) => d.deviceId));
    for (const d of alarmed) if (!seen.current.has(d.deviceId)) announce(d);
    seen.current = now;
  }, [alarmed]);

  if (alarmed.length === 0) return null;
  return (
    <div className="sticky top-0 z-30 -mx-4 mb-3 animate-pulse bg-red-600 px-4 py-3 text-white shadow-lg">
      {alarmed.map((d) => (
        <Link key={d.deviceId} to="/events" className="flex items-center justify-between gap-2">
          <span className="font-semibold">
            🚨 ALARM · {d.name}
            {d.lastEvent ? ` · ${EVENT_LABEL[d.lastEvent.type]}${d.lastEvent.zone ? ` in ${d.lastEvent.zone}` : ""}` : ""}
          </span>
          <span className="text-sm underline">View &amp; acknowledge ›</span>
        </Link>
      ))}
    </div>
  );
}

function announce(d: DeviceView): void {
  beep();
  navigator.vibrate?.([300, 150, 300, 150, 300]);
  if ("Notification" in window && Notification.permission === "granted" && document.visibilityState !== "visible") {
    new Notification(`ALARM · ${d.name}`, { body: d.lastEvent ? EVENT_LABEL[d.lastEvent.type] : "Intrusion detected", tag: `alarm-${d.deviceId}`, icon: "/icon-192.png" });
  }
}

/** Two-tone beep, ~1 s. Browsers only allow audio after the user has interacted with the page once. */
function beep(): void {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    gain.gain.value = 0.08;
    osc.connect(gain).connect(ctx.destination);
    for (let i = 0; i < 4; i++) osc.frequency.setValueAtTime(i % 2 ? 1400 : 1000, ctx.currentTime + i * 0.25);
    osc.start();
    osc.stop(ctx.currentTime + 1);
    osc.onended = () => void ctx.close();
  } catch {
    // audio blocked (no prior user gesture); the visual banner still shows
  }
}
