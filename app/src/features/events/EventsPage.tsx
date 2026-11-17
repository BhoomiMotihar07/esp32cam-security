/** Screen 6: evidence feed with filters, 3-photo bursts and acknowledge. */
import { useState, type ReactNode } from "react";
import { EVENT_TYPES, can, type EventType, type EventView } from "@esp32cam/shared";
import { useAcknowledge, useDevices, useEvents } from "../../api/hooks";
import { useSelectedDevice } from "../../selectedDevice";
import { useAuth } from "../../auth/AuthContext";
import { Photo } from "../../components/Photo";
import { EVENT_LABEL, EventIcon, Spinner, fmtTime } from "../../components/ui";

export function EventsPage() {
  const devices = useDevices();
  const [device] = useSelectedDevice(devices.data);
  const [type, setType] = useState<EventType | undefined>();
  const [onlyOpen, setOnlyOpen] = useState(false);
  const events = useEvents(device?.deviceId, type);
  const [viewer, setViewer] = useState<{ photos: string[]; index: number } | null>(null);

  if (!device) return <p className="text-slate-400">No device.</p>;
  const list = (events.data ?? []).filter((e) => !onlyOpen || !e.acknowledged);

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-semibold">Events · {device.name}</h1>
      <div className="flex gap-2 overflow-x-auto pb-1 text-xs">
        <Chip active={!type} onClick={() => setType(undefined)}>All</Chip>
        {EVENT_TYPES.map((t) => <Chip key={t} active={type === t} onClick={() => setType(t)}>{EVENT_LABEL[t]}</Chip>)}
        <Chip active={onlyOpen} onClick={() => setOnlyOpen(!onlyOpen)}>Unacknowledged</Chip>
      </div>
      {events.isLoading && <Spinner />}
      {!events.isLoading && list.length === 0 && <p className="card text-center text-sm text-slate-500">No events{type ? ` of type ${EVENT_LABEL[type]}` : ""}.</p>}
      {list.map((e) => <EventCard key={e.id} event={e} onOpen={(i) => setViewer({ photos: e.photos, index: i })} />)}
      {viewer && <Lightbox photos={viewer.photos} index={viewer.index} onClose={() => setViewer(null)} onIndex={(i) => setViewer({ ...viewer, index: i })} />}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return <button onClick={onClick} className={`whitespace-nowrap rounded-full px-3 py-1 ${active ? "bg-emerald-500 text-slate-950" : "bg-panel-2 text-slate-300"}`}>{children}</button>;
}

function EventCard({ event, onOpen }: { event: EventView; onOpen: (i: number) => void }) {
  const { user } = useAuth();
  const ack = useAcknowledge(event.deviceId);
  const mayAck = user ? can(user.role, "event.ack") : false;
  const tone = event.type === "offline" ? "border-slate-600" : event.acknowledged ? "border-transparent" : "border-red-500/60";
  return (
    <article className={`card border ${tone}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <EventIcon type={event.type} />
          <div>
            <p className="font-medium">{EVENT_LABEL[event.type]}{event.zone ? <span className="text-slate-300"> · {event.zone}</span> : null}</p>
            <p className="text-xs text-slate-400">{fmtTime(event.ts)} · score {event.score.toFixed(2)}{event.repeatCount ? ` · ${event.repeatCount} reminder(s)` : ""}</p>
          </div>
        </div>
        {event.acknowledged
          ? <span className="text-xs text-emerald-300">✓ {event.acknowledgedBy ?? "acknowledged"}</span>
          : event.type !== "offline" && mayAck && <button className="btn-primary px-3 py-1.5 text-sm" onClick={() => ack.mutate(event.id)} disabled={ack.isPending}>Acknowledge</button>}
      </div>
      {event.photos.length > 0 && (
        <div className="mt-3 grid grid-cols-3 gap-1.5">
          {event.photos.map((p, i) => <Photo key={p} blob={p} className="aspect-[4/3] w-full cursor-zoom-in rounded-lg" onClick={() => onOpen(i)} />)}
        </div>
      )}
      {event.photoCount > event.photos.length && <p className="mt-1 text-xs text-slate-500">{event.photoCount - event.photos.length} photo(s) failed to upload</p>}
    </article>
  );
}

function Lightbox({ photos, index, onClose, onIndex }: { photos: string[]; index: number; onClose: () => void; onIndex: (i: number) => void }) {
  const blob = photos[index];
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/95" onClick={onClose}>
      <div className="flex items-center justify-between p-4 text-sm text-slate-300">
        <span>Photo {index + 1} of {photos.length} · {blob?.split("/").pop()}</span>
        <button className="btn-ghost px-3 py-1">Close</button>
      </div>
      <div className="flex flex-1 items-center justify-center" onClick={(e) => e.stopPropagation()}>
        {blob && <Photo blob={blob} className="max-h-full w-full" />}
      </div>
      <div className="flex justify-center gap-3 p-4" onClick={(e) => e.stopPropagation()}>
        <button className="btn-ghost" disabled={index === 0} onClick={() => onIndex(index - 1)}>‹ Prev</button>
        <button className="btn-ghost" disabled={index >= photos.length - 1} onClick={() => onIndex(index + 1)}>Next ›</button>
      </div>
    </div>
  );
}
