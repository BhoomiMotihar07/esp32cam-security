/** Screen 1: live status, arm/disarm with countdown, snapshot-now, diagnostics. */
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { TIMING, type DeviceView } from "@esp32cam/shared";
import { useDevices, useSendCommand, useSnapshot } from "../../api/hooks";
import { useSelectedDevice } from "../../selectedDevice";
import { useAuth } from "../../auth/AuthContext";
import { can } from "@esp32cam/shared";
import { Banner, EVENT_LABEL, Spinner, StatusPill, fmtUptime, relTime } from "../../components/ui";
import { Link } from "react-router-dom";

function useNow(): number {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => { const t = setInterval(() => setNow(Date.now() / 1000), 1000); return () => clearInterval(t); }, []);
  return now;
}

export function StatusPage() {
  const { user } = useAuth();
  const devices = useDevices();
  const [device, select] = useSelectedDevice(devices.data);
  const now = useNow();

  if (devices.isLoading) return <Spinner />;
  if (!devices.data?.length) return <NoDevice isOwner={user?.role === "owner"} />;
  if (!device) return null;

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{device.name}</h1>
          <p className="text-xs text-slate-400">{devices.data.length > 1 ? (
            <select className="bg-transparent" value={device.deviceId} onChange={(e) => select(e.target.value)}>
              {devices.data.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.name}</option>)}
            </select>
          ) : device.deviceId}</p>
        </div>
        <StatusPill state={device.state} offline={device.offline} />
      </header>

      <StaleBanner device={device} now={now} />
      <ArmCard device={device} now={now} />
      <SnapshotCard device={device} />
      <LastEventCard device={device} now={now} />
      <DiagnosticsCard device={device} now={now} />
    </div>
  );
}

function StaleBanner({ device, now }: { device: DeviceView; now: number }) {
  if (device.offline) {
    return <Banner tone="danger">OFFLINE: no heartbeat for {relTime(device.lastHeartbeatAt, now)}. Power or Wi-Fi may be down. LEDs and buzzer keep working locally.</Banner>;
  }
  const age = device.lastHeartbeatAt ? now - device.lastHeartbeatAt : Infinity;
  if (age > TIMING.HEARTBEAT_INTERVAL_SEC * 1.5) {
    return <Banner tone="warn">State may be stale: last heartbeat {relTime(device.lastHeartbeatAt, now)} (expected every {TIMING.HEARTBEAT_INTERVAL_SEC} s).</Banner>;
  }
  if (device.resetReason && device.resetReason !== "POWERON" && device.resetReason !== "SW" && (device.uptime ?? 0) < 600) {
    return <Banner tone="warn">Device rebooted {fmtUptime(device.uptime)} ago, reason {device.resetReason}. A BROWNOUT means the 5 V supply sagged.</Banner>;
  }
  return null;
}

function ArmCard({ device, now }: { device: DeviceView; now: number }) {
  const { user } = useAuth();
  const send = useSendCommand(device.deviceId);
  const [pending, setPending] = useState<"arm" | "disarm" | null>(null);
  useEffect(() => { setPending(null); }, [device.state]);

  const armed = device.state === "ARMED" || device.state === "ALARM" || device.state === "EXIT_COUNTDOWN";
  const action = armed ? "disarm" : "arm";
  const allowed = user ? can(user.role, armed ? "device.disarm" : "device.arm") : false;
  const remaining = device.countdownEndsAt ? Math.max(0, Math.ceil(device.countdownEndsAt - now)) : 0;

  const onClick = async () => {
    setPending(action);
    try { await send.mutateAsync(action); } catch { setPending(null); }
  };

  return (
    <section className="card text-center">
      <button
        onClick={onClick}
        disabled={!allowed || pending !== null || device.offline}
        className={`mx-auto flex h-40 w-40 flex-col items-center justify-center rounded-full text-lg font-semibold shadow-xl transition active:scale-95 disabled:opacity-50 ${
          device.state === "ALARM" ? "bg-red-500 text-white" : armed ? "bg-emerald-500 text-slate-950" : "bg-panel-2 text-slate-100 ring-2 ring-slate-600"
        }`}
      >
        {pending ? <Spinner /> : device.state === "EXIT_COUNTDOWN" ? <><span className="text-4xl tabular-nums">{remaining}</span><span className="text-xs font-normal">leaving… tap to cancel</span></>
          : device.state === "ALARM" ? <><span>ALARM</span><span className="text-xs font-normal">tap to disarm</span></>
          : armed ? <><span>ARMED</span><span className="text-xs font-normal">tap to disarm</span></>
          : <><span>DISARMED</span><span className="text-xs font-normal">tap to arm</span></>}
      </button>
      <p className="mt-3 text-sm text-slate-400">
        {armed && device.armSource ? `armed by ${sourceLabel(device.armSource)}` : "ready"}
        {device.state === "EXIT_COUNTDOWN" && " · red LED fast blink, buzzer ticks"}
      </p>
      {!allowed && <p className="mt-1 text-xs text-slate-500">Your role ({user?.role}) cannot {action}.</p>}
      {send.isError && <p className="mt-1 text-xs text-red-300">{(send.error as Error).message}</p>}
    </section>
  );
}

function sourceLabel(s: NonNullable<DeviceView["armSource"]>): string {
  return { app: "app", schedule: "schedule", auto_dark: "auto (dark)", button: "local button", telegram: "Telegram" }[s];
}

function SnapshotCard({ device }: { device: DeviceView }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const send = useSendCommand(device.deviceId);
  const snapshot = useSnapshot(device.deviceId);
  const [waitingSince, setWaitingSince] = useState<number | null>(null);
  const allowed = user ? can(user.role, "device.snapshot") : false;

  // After requesting, poll until the device reports a newer snapshot (or give up after 25 s).
  useEffect(() => {
    if (waitingSince === null) return;
    if (device.lastSnapshotAt && device.lastSnapshotAt * 1000 >= waitingSince) {
      setWaitingSince(null);
      void qc.invalidateQueries({ queryKey: ["snapshot", device.deviceId] });
      return;
    }
    const t = setTimeout(() => setWaitingSince(null), 25_000);
    return () => clearTimeout(t);
  }, [device.lastSnapshotAt, waitingSince, device.deviceId, qc]);

  const request = async () => {
    setWaitingSince(Date.now() - 2000); // small slack for clock differences
    try { await send.mutateAsync("snapshot"); } catch { setWaitingSince(null); }
  };

  return (
    <section className="card">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-medium">Live snapshot</h2>
        <button className="btn-ghost text-sm" onClick={request} disabled={!allowed || waitingSince !== null || device.offline}>
          {waitingSince !== null ? <><Spinner /> capturing…</> : "Snapshot now"}
        </button>
      </div>
      <div className="aspect-[4/3] overflow-hidden rounded-xl bg-panel-2">
        {snapshot.data?.url ? <img src={snapshot.data.url} alt="latest snapshot" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-sm text-slate-500">No snapshot yet</div>}
      </div>
      {snapshot.data?.ts && <p className="mt-1 text-xs text-slate-500">taken {relTime(snapshot.data.ts)} · single JPEG, no stream while armed</p>}
      {user && can(user.role, "device.ping") && (
        <button className="btn-ghost mt-2 w-full text-sm" onClick={() => send.mutate("ping")} disabled={device.offline}>👋 "I see you" (buzzer + flash pattern)</button>
      )}
    </section>
  );
}

function LastEventCard({ device, now }: { device: DeviceView; now: number }) {
  return (
    <section className="card">
      <h2 className="mb-1 font-medium">Last event</h2>
      {device.lastEvent ? (
        <Link to={`/events`} className="flex items-center justify-between">
          <span>{EVENT_LABEL[device.lastEvent.type]}{device.lastEvent.zone ? ` · ${device.lastEvent.zone}` : ""}</span>
          <span className="text-sm text-slate-400">{relTime(device.lastEvent.ts, now)} ›</span>
        </Link>
      ) : <p className="text-sm text-slate-500">Nothing yet</p>}
    </section>
  );
}

function DiagnosticsCard({ device, now }: { device: DeviceView; now: number }) {
  const rows: [string, string][] = [
    ["Last heartbeat", relTime(device.lastHeartbeatAt, now)],
    ["Wi-Fi RSSI", device.rssi !== undefined ? `${device.rssi} dBm` : "–"],
    ["Uptime", fmtUptime(device.uptime)],
    ["Reset reason", device.resetReason ?? "–"],
    ["Brightness", device.brightness !== undefined ? `${device.brightness} / 255` : "–"],
    ["Free heap", device.freeHeap !== undefined ? `${Math.round(device.freeHeap / 1024)} KB` : "–"],
    ["Config", device.appliedConfigVersion === device.configVersion ? `v${device.configVersion} applied` : `v${device.configVersion} pending (device on v${device.appliedConfigVersion ?? "?"})`],
  ];
  return (
    <section className="card">
      <h2 className="mb-2 font-medium">Device</h2>
      <dl className="grid grid-cols-2 gap-y-1 text-sm">
        {rows.map(([k, v]) => <div key={k} className="contents"><dt className="text-slate-400">{k}</dt><dd className="text-right tabular-nums">{v}</dd></div>)}
      </dl>
    </section>
  );
}

function NoDevice({ isOwner }: { isOwner: boolean }) {
  return (
    <div className="card mt-10 text-center">
      <p className="text-lg">No device yet</p>
      <p className="mt-1 text-sm text-slate-400">{isOwner ? "Register your ESP32-CAM under Family → Devices with the id and upload key from secrets.h." : "Ask the household owner to register the camera."}</p>
      {isOwner && <Link to="/family" className="btn-primary mt-4">Register device</Link>}
    </div>
  );
}
