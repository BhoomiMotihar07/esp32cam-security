/** Matches Azure-style route templates ("devices/{deviceId}", "local/blob/{*name}") for the dev server. */
export interface Compiled { regex: RegExp; keys: string[] }

export function compileRoute(template: string): Compiled {
  const keys: string[] = [];
  const pattern = template
    .split("/")
    .map((seg) => {
      const catchAll = /^\{\*(\w+)\}$/.exec(seg);
      if (catchAll) { keys.push(catchAll[1]!); return "(.+)"; }
      const single = /^\{(\w+)\}$/.exec(seg);
      if (single) { keys.push(single[1]!); return "([^/]+)"; }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return { regex: new RegExp(`^${pattern}$`), keys };
}

export function matchRoute(c: Compiled, path: string): Record<string, string> | null {
  const m = c.regex.exec(path);
  if (!m) return null;
  const params: Record<string, string> = {};
  c.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1] ?? ""); });
  return params;
}
