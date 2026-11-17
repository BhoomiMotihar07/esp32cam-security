import { useState, type FormEvent } from "react";
import { useAuth } from "../../auth/AuthContext";
import { Banner, Field } from "../../components/ui";

type Mode = "login" | "invite" | "setup";

export function LoginPage() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [householdName, setHouseholdName] = useState("Home");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "login") await login(email, password);
      else if (mode === "invite") await register({ email, password, inviteCode: code.trim().toUpperCase() });
      else await register({ email, password, setupCode: code.trim(), householdName });
    } catch (err) {
      setError(friendly((err as Error).message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col justify-center px-6 py-10">
      <div className="mb-8 text-center">
        <img src="/icon.svg" alt="" className="mx-auto mb-3 h-16 w-16" />
        <h1 className="text-2xl font-semibold">Home Security</h1>
        <p className="text-sm text-slate-400">ESP32-CAM visual intrusion detection</p>
      </div>
      <div className="mb-4 grid grid-cols-3 rounded-xl bg-panel p-1 text-sm">
        {(["login", "invite", "setup"] as Mode[]).map((m) => (
          <button key={m} type="button" onClick={() => setMode(m)} className={`rounded-lg py-2 ${mode === m ? "bg-panel-2 text-white" : "text-slate-400"}`}>
            {m === "login" ? "Sign in" : m === "invite" ? "Join with invite" : "First setup"}
          </button>
        ))}
      </div>
      <form onSubmit={submit} className="card space-y-3">
        <Field label="Email"><input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Password"><input className="input" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        {mode === "invite" && <Field label="Invite code"><input className="input uppercase" required value={code} onChange={(e) => setCode(e.target.value)} placeholder="ABCD2345" /></Field>}
        {mode === "setup" && (
          <>
            <Field label="Setup code (SETUP_CODE on the server)"><input className="input" required value={code} onChange={(e) => setCode(e.target.value)} /></Field>
            <Field label="Household name"><input className="input" value={householdName} onChange={(e) => setHouseholdName(e.target.value)} /></Field>
          </>
        )}
        {error && <Banner tone="danger">{error}</Banner>}
        <button className="btn-primary w-full" disabled={busy}>{mode === "login" ? "Sign in" : "Create account"}</button>
        {mode === "setup" && <p className="text-xs text-slate-500">Creates a new household and makes you its owner. Members join with an invite code afterwards.</p>}
      </form>
    </div>
  );
}

function friendly(code: string): string {
  if (code.startsWith("invalid_credentials")) return "Wrong email or password.";
  if (code.startsWith("email_taken")) return "That email already has an account.";
  if (code.startsWith("invalid_invite")) return "Invite code is invalid, used or expired.";
  if (code.startsWith("invite_or_setup_code_required")) return "Setup code is wrong.";
  return code;
}
