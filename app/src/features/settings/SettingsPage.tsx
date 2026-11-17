/** Screens 4 + 5 + schedule: zones, sensitivity sliders, night auto-arm, weekly schedule. */
import { useEffect, useState } from "react";
import { can, type DeviceConfig, type ScheduleEntry } from "@esp32cam/shared";
import { useConfig, useDevices, useSaveConfig, useSnapshot } from "../../api/hooks";
import { useSelectedDevice } from "../../selectedDevice";
import { useAuth } from "../../auth/AuthContext";
import { Banner, Spinner } from "../../components/ui";
import { ZoneEditor } from "./ZoneEditor";

const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

export function SettingsPage() {
  const { user } = useAuth();
  const devices = useDevices();
  const [device] = useSelectedDevice(devices.data);
  const config = useConfig(device?.deviceId);
  const snapshot = useSnapshot(device?.deviceId);
  const save = useSaveConfig(device?.deviceId);
  const [draft, setDraft] = useState<DeviceConfig | null>(null);
  const editable = user ? can(user.role, "device.config") : false;

  useEffect(() => { if (config.data) setDraft(config.data.config); }, [config.data]);

  if (!device) return <p className="text-slate-400">No device.</p>;
  if (!draft) return <Spinner />;
  const dirty = JSON.stringify(draft) !== JSON.stringify(config.data?.config);
  const set = <K extends keyof DeviceConfig>(k: K, v: DeviceConfig[K]) => setDraft({ ...draft, [k]: v });

  return (
    <div className="space-y-4 pb-16">
      <header>
        <h1 className="text-xl font-semibold">Settings · {device.name}</h1>
        <p className="text-xs text-slate-400">
          config v{config.data?.config.version} · {device.appliedConfigVersion === config.data?.config.version ? "applied on device" : `device still on v${device.appliedConfigVersion ?? "?"}`}
        </p>
      </header>
      {!editable && <Banner tone="info">Only the owner can change settings. You can view them.</Banner>}

      <section className="card">
        <h2 className="mb-2 font-medium">Detection zones</h2>
        <ZoneEditor zones={draft.zones} snapshotUrl={snapshot.data?.url} onChange={(z) => set("zones", z)} disabled={!editable} />
      </section>

      <section className="card space-y-4">
        <h2 className="font-medium">Sensitivity</h2>
        <Slider label="Motion threshold" hint={`${Math.round(draft.motionThreshold * 100)}% of zone pixels must change in two consecutive frames`} min={0.01} max={0.5} step={0.01} value={draft.motionThreshold} onChange={(v) => set("motionThreshold", v)} disabled={!editable} />
        <Slider label="Sound sensitivity" hint={`${draft.soundSensitivity} / 10 · pulses per second vs learned baseline`} min={1} max={10} step={1} value={draft.soundSensitivity} onChange={(v) => set("soundSensitivity", v)} disabled={!editable} />
        <Slider label="Night brightness threshold" hint={`dark below ${draft.nightThreshold} / 255 · current ${device.brightness ?? "?"}`} min={0} max={255} step={1} value={draft.nightThreshold} onChange={(v) => set("nightThreshold", v)} disabled={!editable} />
        <Slider label="Exit delay" hint={`${draft.exitDelaySec} s to leave after arming`} min={0} max={120} step={5} value={draft.exitDelaySec} onChange={(v) => set("exitDelaySec", v)} disabled={!editable} />
        <label className="flex items-center justify-between">
          <span>Auto-arm when dark for 5 min</span>
          <input type="checkbox" className="h-5 w-5 accent-emerald-500" checked={draft.autoArmWhenDark} disabled={!editable} onChange={(e) => set("autoArmWhenDark", e.target.checked)} />
        </label>
      </section>

      <section className="card space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Weekly schedule</h2>
          <input type="checkbox" className="h-5 w-5 accent-emerald-500" checked={draft.schedule.enabled} disabled={!editable} onChange={(e) => set("schedule", { ...draft.schedule, enabled: e.target.checked })} />
        </div>
        <label className="flex items-center justify-between text-sm">
          <span className="text-slate-400">Timezone offset (min from UTC)</span>
          <input type="number" className="input w-24 text-right" value={draft.schedule.tzOffsetMin} disabled={!editable} onChange={(e) => set("schedule", { ...draft.schedule, tzOffsetMin: Number(e.target.value) })} />
        </label>
        {draft.schedule.entries.map((entry, i) => (
          <ScheduleRow key={i} entry={entry} disabled={!editable}
            onChange={(e) => set("schedule", { ...draft.schedule, entries: draft.schedule.entries.map((o, j) => (j === i ? e : o)) })}
            onRemove={() => set("schedule", { ...draft.schedule, entries: draft.schedule.entries.filter((_, j) => j !== i) })} />
        ))}
        {editable && draft.schedule.entries.length < 14 && (
          <button className="btn-ghost w-full text-sm" onClick={() => set("schedule", { ...draft.schedule, entries: [...draft.schedule.entries, { days: [1, 2, 3, 4, 5], armAt: "22:00", disarmAt: "06:00" }] })}>+ Add window</button>
        )}
        <p className="text-xs text-slate-500">Windows arm with no exit delay and may cross midnight. A manual disarm inside a window stays disarmed until the next window starts.</p>
      </section>

      {editable && (
        <div className="fixed inset-x-0 bottom-16 z-10 mx-auto max-w-md px-4">
          <button className="btn-primary w-full shadow-xl" disabled={!dirty || save.isPending} onClick={() => save.mutate(draft)}>
            {save.isPending ? <Spinner /> : dirty ? "Save and send to device" : "Saved"}
          </button>
          {save.isError && <p className="mt-1 text-center text-xs text-red-300">{(save.error as Error).message}</p>}
        </div>
      )}
    </div>
  );
}

function Slider({ label, hint, min, max, step, value, onChange, disabled }: { label: string; hint: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <label className="block">
      <span className="flex justify-between text-sm"><span>{label}</span><span className="tabular-nums text-slate-300">{value}</span></span>
      <input type="range" className="w-full accent-emerald-500" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="text-xs text-slate-500">{hint}</span>
    </label>
  );
}

function ScheduleRow({ entry, onChange, onRemove, disabled }: { entry: ScheduleEntry; onChange: (e: ScheduleEntry) => void; onRemove: () => void; disabled: boolean }) {
  const toggle = (d: number) => onChange({ ...entry, days: entry.days.includes(d) ? entry.days.filter((x) => x !== d) : [...entry.days, d].sort() });
  return (
    <div className="rounded-xl bg-panel-2 p-3">
      <div className="mb-2 flex justify-between gap-1">
        {DAYS.map((name, d) => (
          <button key={d} disabled={disabled} onClick={() => toggle(d)} className={`h-8 w-8 rounded-full text-xs ${entry.days.includes(d) ? "bg-emerald-500 text-slate-950" : "bg-slate-700 text-slate-300"}`}>{name}</button>
        ))}
      </div>
      <div className="flex items-center gap-2 text-sm">
        <span className="text-slate-400">arm</span><input type="time" className="input w-auto px-2 py-1" value={entry.armAt} disabled={disabled} onChange={(e) => onChange({ ...entry, armAt: e.target.value })} />
        <span className="text-slate-400">disarm</span><input type="time" className="input w-auto px-2 py-1" value={entry.disarmAt} disabled={disabled} onChange={(e) => onChange({ ...entry, disarmAt: e.target.value })} />
        {!disabled && <button className="ml-auto text-xs text-red-300" onClick={onRemove}>remove</button>}
      </div>
    </div>
  );
}
