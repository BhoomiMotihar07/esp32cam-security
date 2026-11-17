/** Registers every non-local route with the Azure Functions host. */
import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from "@azure/functions";
import type { Req, Res } from "../http/types.js";
import { errorResponse } from "../http/respond.js";
import { buildRoutes } from "../routes.js";
import { getServices } from "../services.js";

function toReq(request: HttpRequest): Req {
  const url = new URL(request.url);
  return {
    method: request.method,
    path: url.pathname.replace(/^\/api\//, ""),
    params: request.params,
    query: request.query,
    header: (n) => request.headers.get(n),
    json: () => request.json() as Promise<never>,
    bytes: async () => new Uint8Array(await request.arrayBuffer()),
  };
}

function toResponse(res: Res): HttpResponseInit {
  return { status: res.status, headers: res.headers, body: res.body };
}

const svc = getServices();
for (const route of buildRoutes(svc)) {
  if (route.localOnly) continue;
  app.http(route.name, {
    methods: [route.method],
    route: route.route,
    authLevel: "anonymous", // our own JWT / device key / webhook secret do the authentication
    handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
      try {
        return toResponse(await route.handler(toReq(request)));
      } catch (err) {
        return toResponse(errorResponse(err, (m, e) => context.error(m, e)));
      }
    },
  });
}
