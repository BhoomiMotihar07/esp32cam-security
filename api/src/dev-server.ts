/**
 * Standalone server: serves the route table over Node http (the same handlers the Functions host
 * runs) plus the two timers. Used for local development and for the Supabase deployment on Render.
 * With STATIC_DIR set it also serves the built PWA, so app and API share one origin.
 *   npm run dev -w api      →  http://localhost:7071/api
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { TIMING } from "@esp32cam/shared";
import { buildRoutes } from "./routes.js";
import { compileRoute, matchRoute } from "./http/match.js";
import { HttpError, errorResponse, json } from "./http/respond.js";
import type { Req, Res } from "./http/types.js";
import { getServices } from "./services.js";
import { checkOfflineDevices } from "./domain/offline.js";
import { repeatPendingAlerts } from "./domain/alerts.js";

const MAX_BODY = 4 * 1024 * 1024;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml",
  ".png": "image/png", ".json": "application/json", ".webmanifest": "application/manifest+json", ".map": "application/json",
};

/** Serves a file from the PWA build, falling back to index.html for client-side routes. */
async function serveStatic(root: string, urlPath: string): Promise<Res> {
  const base = resolve(root);
  const target = normalize(join(base, decodeURIComponent(urlPath)));
  if (!target.startsWith(base)) return { status: 403 };
  const tryFile = async (file: string) => {
    try { return await readFile(file); } catch { return null; }
  };
  let file = urlPath.endsWith("/") ? null : target;
  let body = file ? await tryFile(file) : null;
  if (!body) { file = join(base, "index.html"); body = await tryFile(file); }
  if (!body || !file) return { status: 404, body: "not found" };
  const ext = extname(file);
  // hashed assets can be cached forever; index.html and sw.js must stay fresh
  const cache = file.includes(`${"/"}assets${"/"}`) ? "public, max-age=31536000, immutable" : "no-cache";
  return { status: 200, headers: { "content-type": MIME[ext] ?? "application/octet-stream", "cache-control": cache }, body: new Uint8Array(body) };
}

async function readBody(req: IncomingMessage): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new Error("body too large");
    chunks.push(chunk as Buffer);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

function main(): void {
  const svc = getServices();
  if (svc.config.mode === "azure") svc.log.warn("standalone server running against Azure adapters; IoT Hub ingest needs the Functions host");
  const routes = buildRoutes(svc).map((r) => ({ ...r, compiled: compileRoute(r.route) }));
  const cors = {
    "access-control-allow-origin": svc.config.appOrigin,
    "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers": "authorization,content-type,x-device-key",
    "access-control-max-age": "600",
  };

  const server = createServer(async (nodeReq: IncomingMessage, nodeRes: ServerResponse) => {
    const url = new URL(nodeReq.url ?? "/", "http://localhost");
    const isApi = url.pathname === "/api" || url.pathname.startsWith("/api/");
    const path = url.pathname.replace(/^\/api\/?/, "");
    const method = (nodeReq.method ?? "GET").toUpperCase();
    const send = (res: Res) => {
      nodeRes.writeHead(res.status, { ...cors, ...(res.headers ?? {}) });
      nodeRes.end(res.body);
    };
    if (method === "OPTIONS") return send({ status: 204 });
    if (!isApi && svc.config.staticDir && method === "GET") return send(await serveStatic(svc.config.staticDir, url.pathname));

    let matched: { route: (typeof routes)[number]; params: Record<string, string> } | null = null;
    for (const route of routes) {
      if (route.method !== method) continue;
      const params = matchRoute(route.compiled, path);
      if (params) { matched = { route, params }; break; }
    }
    if (!matched) return send(json({ error: "not_found", detail: `${method} /api/${path}` }, 404));

    let bodyCache: Promise<Uint8Array> | null = null;
    const bytes = () => (bodyCache ??= readBody(nodeReq));
    const req: Req = {
      method,
      path,
      params: matched.params,
      query: url.searchParams,
      header: (n) => { const v = nodeReq.headers[n.toLowerCase()]; return Array.isArray(v) ? v[0] ?? null : v ?? null; },
      json: async () => {
        const text = Buffer.from(await bytes()).toString("utf8");
        try { return text ? JSON.parse(text) : {}; } catch { throw new HttpError(400, "invalid_json"); }
      },
      bytes,
    };
    const started = Date.now();
    try {
      const res = await matched.route.handler(req);
      send(res);
      if (!path.startsWith("local/")) svc.log.info(`${method} /api/${path} -> ${res.status} (${Date.now() - started} ms)`);
    } catch (err) {
      send(errorResponse(err, svc.log.error));
    }
  });

  server.listen(svc.config.devPort, () => {
    svc.log.info(`server listening on port ${svc.config.devPort} (mode=${svc.config.mode}${svc.config.mode === "local" ? `, data=${svc.config.localDataDir}` : ""}${svc.config.staticDir ? `, serving app from ${svc.config.staticDir}` : ""})`);
    svc.log.info(`telegram: ${svc.telegram ? "configured" : "off"}, push: ${svc.push ? "configured" : "off"}`);
  });

  setInterval(() => checkOfflineDevices(svc).then((f) => f.length && svc.log.info("offline", f)).catch((e) => svc.log.error("offline timer", e)), 60_000).unref();
  setInterval(() => repeatPendingAlerts(svc).then((n) => n && svc.log.info(`reminders sent: ${n}`)).catch((e) => svc.log.error("repeat timer", e)), TIMING.ALERT_REPEAT_SEC * 1000).unref();
}

main();
