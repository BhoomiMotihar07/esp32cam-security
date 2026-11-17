/**
 * Draw rectangles over the latest snapshot. Coordinates are stored normalised (0..1), so the
 * firmware maps them onto its 160x120 motion frame regardless of the snapshot resolution.
 */
import { useRef, useState, type PointerEvent } from "react";
import type { Zone } from "@esp32cam/shared";

const COLORS = ["#10b981", "#38bdf8", "#f59e0b", "#f472b6", "#a78bfa", "#fb7185", "#34d399", "#facc15"];

interface Props { zones: Zone[]; snapshotUrl?: string; onChange: (zones: Zone[]) => void; disabled?: boolean }

export function ZoneEditor({ zones, snapshotUrl, onChange, disabled }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

  const toNorm = (e: PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return { x: clamp((e.clientX - r.left) / r.width), y: clamp((e.clientY - r.top) / r.height) };
  };

  const down = (e: PointerEvent) => {
    if (disabled || zones.length >= 8) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    const p = toNorm(e);
    setDraft({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  };
  const move = (e: PointerEvent) => { if (draft) { const p = toNorm(e); setDraft({ ...draft, x1: p.x, y1: p.y }); } };
  const up = () => {
    if (!draft) return;
    const rect = normalise(draft);
    setDraft(null);
    if (rect.w < 0.03 || rect.h < 0.03) return; // a tap, not a drag
    const id = nextId(zones);
    onChange([...zones, { id, name: `Zone ${zones.length + 1}`, enabled: true, ...round(rect) }]);
  };

  return (
    <div className="space-y-3">
      <div ref={box} className="relative aspect-[4/3] select-none overflow-hidden rounded-xl bg-panel-2 touch-none" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => setDraft(null)}>
        {snapshotUrl ? <img src={snapshotUrl} alt="snapshot" className="pointer-events-none h-full w-full object-cover" draggable={false} />
          : <div className="pointer-events-none flex h-full items-center justify-center text-sm text-slate-500">Take a snapshot on the Status tab to draw on it</div>}
        <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 75" preserveAspectRatio="none">
          {zones.map((z, i) => (
            <g key={z.id} opacity={z.enabled ? 1 : 0.35}>
              <rect x={z.x * 100} y={z.y * 75} width={z.w * 100} height={z.h * 75} fill={COLORS[i % COLORS.length]} fillOpacity={0.2} stroke={COLORS[i % COLORS.length]} strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
              <text x={z.x * 100 + 1} y={z.y * 75 + 4} fontSize={3.2} fill="white" style={{ paintOrder: "stroke", stroke: "black", strokeWidth: 0.6 }}>{z.name}</text>
            </g>
          ))}
          {draft && (() => { const r = normalise(draft); return <rect x={r.x * 100} y={r.y * 75} width={r.w * 100} height={r.h * 75} fill="white" fillOpacity={0.15} stroke="white" strokeDasharray="2 1" strokeWidth={0.5} vectorEffect="non-scaling-stroke" />; })()}
        </svg>
      </div>
      <p className="text-xs text-slate-500">Drag to draw a zone (max 8). Motion is scored only inside enabled zones.</p>
      <ul className="space-y-2">
        {zones.map((z, i) => (
          <li key={z.id} className="flex items-center gap-2 rounded-xl bg-panel-2 px-3 py-2">
            <span className="h-3 w-3 rounded-sm" style={{ background: COLORS[i % COLORS.length] }} />
            <input className="min-w-0 flex-1 bg-transparent text-sm outline-none" value={z.name} maxLength={24} disabled={disabled} onChange={(e) => onChange(zones.map((o) => (o.id === z.id ? { ...o, name: e.target.value } : o)))} />
            <label className="flex items-center gap-1 text-xs text-slate-400"><input type="checkbox" checked={z.enabled} disabled={disabled} onChange={(e) => onChange(zones.map((o) => (o.id === z.id ? { ...o, enabled: e.target.checked } : o)))} /> on</label>
            <button className="text-xs text-red-300" disabled={disabled} onClick={() => onChange(zones.filter((o) => o.id !== z.id))}>remove</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

const clamp = (v: number) => Math.max(0, Math.min(1, v));
function normalise(d: { x0: number; y0: number; x1: number; y1: number }) {
  const x = Math.min(d.x0, d.x1), y = Math.min(d.y0, d.y1);
  return { x, y, w: Math.abs(d.x1 - d.x0), h: Math.abs(d.y1 - d.y0) };
}
const round = (r: { x: number; y: number; w: number; h: number }) => ({ x: r3(r.x), y: r3(r.y), w: r3(Math.min(r.w, 1 - r.x)), h: r3(Math.min(r.h, 1 - r.y)) });
const r3 = (v: number) => Math.round(v * 1000) / 1000;
function nextId(zones: Zone[]): string {
  let n = zones.length + 1;
  while (zones.some((z) => z.id === `z${n}`)) n++;
  return `z${n}`;
}
