/**
 * Produces api/deploy/: each Functions entry file bundled with esbuild (dependencies and the
 * workspace package @esp32cam/shared included), plus host.json and a minimal package.json.
 * npm workspaces hoist node_modules to the repo root, so a plain zip of api/ would ship no deps.
 *   npm run bundle -w api  →  cd api/deploy && npx func azure functionapp publish <name> --javascript
 */
import { build } from "esbuild";
import { cpSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const out = join(root, "deploy");
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "functions"), { recursive: true });

const entries = readdirSync(join(root, "src/functions")).filter((f) => f.endsWith(".ts")).map((f) => join(root, "src/functions", f));
await build({
  entryPoints: entries,
  outdir: join(out, "functions"),
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  sourcemap: true,
  // provided by the Functions host at runtime; must stay a real require()
  external: ["@azure/functions-core"],
  logLevel: "info",
});

cpSync(join(root, "host.json"), join(out, "host.json"));
writeFileSync(join(out, "package.json"), JSON.stringify({ name: "esp32cam-api-deploy", private: true, main: "functions/*.js" }, null, 2));
writeFileSync(join(out, ".funcignore"), "*.map\n");
console.log(`bundled ${entries.length} entry files into ${out}`);
