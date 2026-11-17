import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/AuthContext";
import { Layout } from "./components/Layout";
import { LoginPage } from "./features/auth/LoginPage";
import { StatusPage } from "./features/status/StatusPage";
import { EventsPage } from "./features/events/EventsPage";
import { SettingsPage } from "./features/settings/SettingsPage";
import { FamilyPage } from "./features/family/FamilyPage";
import { Spinner } from "./components/ui";

export function App() {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex h-full items-center justify-center"><Spinner /></div>;
  if (!user) return <LoginPage />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<StatusPage />} />
        <Route path="events" element={<EventsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="family" element={<FamilyPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
