import { NavLink, Outlet } from "react-router-dom";
import { AlarmBanner } from "./AlarmBanner";

const tabs = [
  { to: "/", label: "Status", icon: "🏠" },
  { to: "/events", label: "Events", icon: "🗂️" },
  { to: "/settings", label: "Settings", icon: "🎛️" },
  { to: "/family", label: "Family", icon: "👪" },
];

export function Layout() {
  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col">
      <main className="flex-1 px-4 pb-24 pt-[max(1rem,env(safe-area-inset-top))]">
        <AlarmBanner />
        <Outlet />
      </main>
      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-white/5 bg-slate-950/90 backdrop-blur" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div className="mx-auto grid max-w-md grid-cols-4">
          {tabs.map((t) => (
            <NavLink key={t.to} to={t.to} end={t.to === "/"} className={({ isActive }) => `flex flex-col items-center gap-0.5 py-2 text-[11px] ${isActive ? "text-emerald-400" : "text-slate-400"}`}>
              <span className="text-lg leading-none">{t.icon}</span>{t.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
