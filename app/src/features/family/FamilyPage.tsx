/** Screens 8 + 9: members and roles, invites, device registration, Telegram linking, push, sign out. */
import { useEffect, useState } from "react";
import { ROLES, can, type Role } from "@esp32cam/shared";
import { useClaimDevice, useDevices, useHousehold, useHouseholdMutations } from "../../api/hooks";
import { useAuth } from "../../auth/AuthContext";
import { Banner, Field, Spinner, relTime } from "../../components/ui";
import { currentSubscription, disablePush, enablePush, pushSupported } from "../../push";

export function FamilyPage() {
  const { user, logout } = useAuth();
  const household = useHousehold();
  if (!user) return null;
  if (household.isLoading) return <Spinner />;
  const h = household.data;
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold">{h?.household.name ?? "Household"}</h1>
        <p className="text-xs text-slate-400">{user.email} · {user.role}</p>
      </header>
      <MembersCard members={h?.members ?? []} me={user.id} canManage={can(user.role, "member.manage")} />
      {can(user.role, "member.invite") && <InvitesCard invites={h?.invites ?? []} />}
      <TelegramCard links={h?.telegramLinks ?? []} canLink={can(user.role, "telegram.link")} />
      <PushCard />
      {can(user.role, "device.register") && <DevicesCard />}
      <button className="btn-ghost w-full" onClick={logout}>Sign out</button>
    </div>
  );
}

function MembersCard({ members, me, canManage }: { members: { userId: string; email: string; role: Role; joinedAt: number }[]; me: string; canManage: boolean }) {
  const { setRole, remove } = useHouseholdMutations();
  return (
    <section className="card">
      <h2 className="mb-2 font-medium">Members</h2>
      <ul className="divide-y divide-white/5">
        {members.map((m) => (
          <li key={m.userId} className="flex items-center justify-between gap-2 py-2 text-sm">
            <div className="min-w-0"><p className="truncate">{m.email}{m.userId === me && <span className="text-slate-500"> (you)</span>}</p><p className="text-xs text-slate-500">joined {relTime(m.joinedAt)}</p></div>
            {canManage ? (
              <div className="flex items-center gap-2">
                <select className="input w-auto py-1" value={m.role} onChange={(e) => setRole.mutate({ userId: m.userId, role: e.target.value })}>
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                <button className="text-xs text-red-300" onClick={() => { if (confirm(`Remove ${m.email}?`)) remove.mutate(m.userId); }}>remove</button>
              </div>
            ) : <span className="rounded-full bg-panel-2 px-2 py-0.5 text-xs">{m.role}</span>}
          </li>
        ))}
      </ul>
      {(setRole.isError || remove.isError) && <Banner tone="danger">{((setRole.error ?? remove.error) as Error).message}</Banner>}
      <p className="mt-2 text-xs text-slate-500">owner: everything · member: arm, disarm, acknowledge, snapshot · viewer: read-only</p>
    </section>
  );
}

function InvitesCard({ invites }: { invites: { code: string; role: Role; expiresAt: number }[] }) {
  const { invite } = useHouseholdMutations();
  return (
    <section className="card">
      <h2 className="mb-2 font-medium">Invite codes</h2>
      <div className="flex gap-2">
        <button className="btn-ghost flex-1 text-sm" onClick={() => invite.mutate("member")} disabled={invite.isPending}>+ Member invite</button>
        <button className="btn-ghost flex-1 text-sm" onClick={() => invite.mutate("viewer")} disabled={invite.isPending}>+ Viewer invite</button>
      </div>
      {invites.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm">
          {invites.map((i) => (
            <li key={i.code} className="flex items-center justify-between rounded-lg bg-panel-2 px-3 py-2">
              <span className="font-mono text-lg tracking-widest">{i.code}</span>
              <span className="text-xs text-slate-400">{i.role} · expires {relTime(i.expiresAt).replace("ago", "")}</span>
              <button className="text-xs text-emerald-300" onClick={() => void navigator.clipboard?.writeText(i.code)}>copy</button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-slate-500">Share the code; the person signs up with "Join with invite". Codes are single-use and last 7 days.</p>
    </section>
  );
}

function TelegramCard({ links, canLink }: { links: { chatId: string; title: string; linkedAt: number }[]; canLink: boolean }) {
  const { linkCode, unlinkTelegram } = useHouseholdMutations();
  return (
    <section className="card">
      <h2 className="mb-2 font-medium">Telegram</h2>
      {links.length === 0 && <p className="text-sm text-slate-400">No chat linked. Alerts with photos and buttons go to linked chats.</p>}
      <ul className="space-y-1 text-sm">
        {links.map((l) => (
          <li key={l.chatId} className="flex items-center justify-between rounded-lg bg-panel-2 px-3 py-2">
            <span>{l.title} <span className="text-xs text-slate-500">chat {l.chatId}</span></span>
            {canLink && <button className="text-xs text-red-300" onClick={() => unlinkTelegram.mutate(l.chatId)}>unlink</button>}
          </li>
        ))}
      </ul>
      {canLink && (
        <div className="mt-3">
          <button className="btn-ghost w-full text-sm" onClick={() => linkCode.mutate()} disabled={linkCode.isPending}>Get a link code</button>
          {linkCode.data && (
            <Banner tone="info">Send <b className="font-mono">/link {linkCode.data.code}</b> to the bot within 10 minutes. Then /status, /arm, /disarm, /snapshot work from that chat.</Banner>
          )}
        </div>
      )}
    </section>
  );
}

function PushCard() {
  const [state, setState] = useState<"unknown" | "on" | "off" | "unsupported" | "denied" | "unavailable">("unknown");
  useEffect(() => {
    if (!pushSupported()) { setState("unsupported"); return; }
    currentSubscription().then((s) => setState(s ? "on" : "off")).catch(() => setState("off"));
  }, []);
  const toggle = async () => {
    if (state === "on") { await disablePush(); setState("off"); return; }
    const r = await enablePush();
    setState(r === "enabled" ? "on" : r);
  };
  return (
    <section className="card">
      <div className="flex items-center justify-between">
        <div><h2 className="font-medium">Push notifications</h2><p className="text-xs text-slate-400">Alerts on this device, even with the app closed</p></div>
        {state === "unsupported" ? <span className="text-xs text-slate-500">not supported here</span>
          : <button className="btn-ghost text-sm" onClick={toggle} disabled={state === "unknown"}>{state === "on" ? "Disable" : "Enable"}</button>}
      </div>
      {state === "denied" && <Banner tone="warn">Notifications are blocked in the browser settings.</Banner>}
      {state === "unavailable" && <Banner tone="warn">The server has no VAPID keys configured, so push is off. Telegram alerts still work.</Banner>}
      <p className="mt-2 text-xs text-slate-500">On iPhone, add the app to the Home Screen first.</p>
    </section>
  );
}

function DevicesCard() {
  const devices = useDevices();
  const claim = useClaimDevice();
  const [deviceId, setDeviceId] = useState("cam-01");
  const [name, setName] = useState("Hall camera");
  const [uploadKey, setUploadKey] = useState("");
  return (
    <section className="card space-y-2">
      <h2 className="font-medium">Devices</h2>
      <ul className="text-sm text-slate-300">{devices.data?.map((d) => <li key={d.deviceId}>{d.name} <span className="text-xs text-slate-500">({d.deviceId})</span></li>)}</ul>
      <Field label="Device id (DEVICE_ID in secrets.h)"><input className="input" value={deviceId} onChange={(e) => setDeviceId(e.target.value)} /></Field>
      <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Upload key (DEVICE_UPLOAD_KEY in secrets.h)"><input className="input" value={uploadKey} onChange={(e) => setUploadKey(e.target.value)} placeholder="at least 8 characters" /></Field>
      <button className="btn-primary w-full" disabled={claim.isPending || uploadKey.length < 8} onClick={() => claim.mutate({ deviceId, name, uploadKey })}>Register / update device</button>
      {claim.isError && <Banner tone="danger">{(claim.error as Error).message}</Banner>}
      {claim.isSuccess && <Banner tone="info">Registered. The device will appear on Status after its first heartbeat.</Banner>}
    </section>
  );
}
