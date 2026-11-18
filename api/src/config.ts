/**
 * The only module that reads process.env. Everything else receives an AppConfig.
 * In Azure these come from Function App settings; locally from local.settings.json
 * (func start) or a .env-style export before `npm run dev`.
 */
export type AppMode = "local" | "azure" | "supabase";

export interface AppConfig {
  mode: AppMode;
  jwtSecret: string;
  setupCode: string;
  appOrigin: string;
  publicApiBase: string;
  localDataDir: string;
  localBlobSecret: string;
  cosmos: { connectionString: string; database: string };
  storage: { connectionString: string; container: string };
  iotHub: { serviceConnectionString: string };
  supabase: { url: string; serviceRoleKey: string; bucket: string };
  /** folder with the built PWA (app/dist) to serve from the same origin; empty = API only */
  staticDir: string;
  telegram: { botToken: string; webhookSecret: string };
  vapid: { publicKey: string; privateKey: string; subject: string };
  alertMaxRepeats: number;
  devPort: number;
}

function env(name: string, fallback = ""): string {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

export function loadConfig(): AppConfig {
  const requested = env("APP_MODE", env("COSMOS_CONNECTION_STRING") ? "azure" : "local");
  const mode: AppMode = requested === "azure" || requested === "supabase" ? requested : "local";
  const cfg: AppConfig = {
    mode,
    jwtSecret: env("JWT_SECRET"),
    setupCode: env("SETUP_CODE"),
    appOrigin: env("APP_ORIGIN", "http://localhost:5173"),
    publicApiBase: env("PUBLIC_API_BASE", "http://localhost:7071/api"),
    localDataDir: env("LOCAL_DATA_DIR", "./.data"),
    localBlobSecret: env("LOCAL_BLOB_SECRET", "local-blob-signing-secret"),
    cosmos: { connectionString: env("COSMOS_CONNECTION_STRING"), database: env("COSMOS_DATABASE", "homesec") },
    storage: { connectionString: env("STORAGE_CONNECTION_STRING"), container: env("BLOB_CONTAINER", "evidence") },
    iotHub: { serviceConnectionString: env("IOTHUB_SERVICE_CONNECTION_STRING") },
    supabase: { url: env("SUPABASE_URL"), serviceRoleKey: env("SUPABASE_SERVICE_ROLE_KEY"), bucket: env("SUPABASE_BUCKET", "evidence") },
    staticDir: env("STATIC_DIR"),
    telegram: { botToken: env("TELEGRAM_BOT_TOKEN"), webhookSecret: env("TELEGRAM_WEBHOOK_SECRET") },
    vapid: { publicKey: env("VAPID_PUBLIC_KEY"), privateKey: env("VAPID_PRIVATE_KEY"), subject: env("VAPID_SUBJECT", "mailto:owner@example.com") },
    alertMaxRepeats: Number(env("ALERT_MAX_REPEATS", "20")),
    // Render (and most hosts) assign the port through PORT
    devPort: Number(env("PORT", env("DEV_PORT", "7071"))),
  };
  validate(cfg);
  return cfg;
}

function validate(cfg: AppConfig): void {
  const missing: string[] = [];
  if (cfg.jwtSecret.length < 16) missing.push("JWT_SECRET (>= 16 chars)");
  if (!cfg.setupCode) missing.push("SETUP_CODE");
  if (cfg.mode === "azure") {
    if (!cfg.cosmos.connectionString) missing.push("COSMOS_CONNECTION_STRING");
    if (!cfg.storage.connectionString) missing.push("STORAGE_CONNECTION_STRING");
    if (!cfg.iotHub.serviceConnectionString) missing.push("IOTHUB_SERVICE_CONNECTION_STRING");
  }
  if (cfg.mode === "supabase") {
    if (!cfg.supabase.url) missing.push("SUPABASE_URL");
    if (!cfg.supabase.serviceRoleKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  }
  if (missing.length) throw new Error(`Missing required settings: ${missing.join(", ")}`);
}
