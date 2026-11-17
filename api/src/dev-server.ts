/**
 * Local-mode runner: serves the route table over Node http (same handlers the Functions
 * host runs), plus the two timers. No Azure account, emulator or Core Tools required.
 *   npm run dev -w api      →  http://localhost:7071/api
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { TIMING } from "@esp32cam/shared";
import { buildRoutes } from "./routes.js";
import { compileRoute, matchRoute } from "./http/match.js";
import { HttpError, errorResponse, json } from "./http/respond.js";
import type { Req, Res } from "./http/types.js";
import { getServices } from "./services.js";
import { checkOfflineDevices } from "./domain/offline.js";
import { repeatPendingAlerts } from "./domain/alerts.js";

const MAX_BODY = 4 * 1024 * 1024;

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
  if (svc.config.mode !== "local") svc.log.warn("dev-server running against Azure adapters (APP_MODE=azure)");
  const routes = buildRoutes(svc).map((r) => ({ ...r, compiled: compileRoute(r.route) }));
  const cors = {
    "access-control-allow-origin": svc.config.appOrigin,
    "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers": "authorization,content-type,x-device-key",
    "access-control-max-age": "600",
  };

  const server = createServer(async (nodeReq: IncomingMessage, nodeRes: ServerResponse) => {
    const url = new URL(nodeReq.url ?? "/", "http://localhost");
    const path = url.pathname.replace(/^\/api\/?/, "");
    const method = (nodeReq.method ?? "GET").toUpperCase();
    const send = (res: Res) => {
      nodeRes.writeHead(res.status, { ...cors, ...(res.headers ?? {}) });
      nodeRes.end(res.body);
    };
    if (method === "OPTIONS") return send({ status: 204 });

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
    svc.log.info(`dev-server listening on http://localhost:${svc.config.devPort}/api (mode=${svc.config.mode}, data=${svc.config.localDataDir})`);
    svc.log.info(`telegram: ${svc.telegram ? "configured" : "off"}, push: ${svc.push ? "configured" : "off"}`);
  });

  setInterval(() => checkOfflineDevices(svc).then((f) => f.length && svc.log.info("offline", f)).catch((e) => svc.log.error("offline timer", e)), 60_000).unref();
  setInterval(() => repeatPendingAlerts(svc).then((n) => n && svc.log.info(`reminders sent: ${n}`)).catch((e) => svc.log.error("repeat timer", e)), TIMING.ALERT_REPEAT_SEC * 1000).unref();
}

main();
