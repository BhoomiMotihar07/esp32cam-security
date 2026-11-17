#!/usr/bin/env node
/**
 * Device simulator CLI.
 *   npm run sim -- --link local                  interactive (keys below)
 *   npm run sim -- --script "button,wait:2,arm0,motion,wait:3,quit"   scripted smoke run
 *   npm run sim -- --link iothub                 real IoT Hub (IOTHUB_DEVICE_CONNECTION_STRING)
 */
import { SimulatedDevice } from "./device.js";
import { LocalCloudLink } from "./links/local-link.js";
import { IotHubCloudLink } from "./links/iothub-link.js";
import { Uploader } from "./uploader.js";

const args = parseArgs(process.argv.slice(2));
const deviceId = args["device"] ?? process.env["SIM_DEVICE_ID"] ?? "cam-01";
const uploadKey = args["key"] ?? process.env["SIM_UPLOAD_KEY"] ?? "dev-upload-key-123";
const apiBase = args["api"] ?? process.env["SIM_API_BASE"] ?? "http://localhost:7071/api";
const linkMode = args["link"] ?? process.env["SIM_LINK"] ?? "local";
const heartbeatSec = args["heartbeat"] ? Number(args["heartbeat"]) : undefined;

const log = (s: string) => console.log(`${new Date().toISOString().slice(11, 19)} [sim ${deviceId}] ${s}`);

const link = linkMode === "iothub"
  ? new IotHubCloudLink(requireEnv("IOTHUB_DEVICE_CONNECTION_STRING"), log)
  : new LocalCloudLink(apiBase, deviceId, log);
const device = new SimulatedDevice({ deviceId, link, uploader: new Uploader(apiBase, deviceId, uploadKey), log, heartbeatSec });

const HELP = `keys: m motion · s sound · d toggle dark · t tamper (moved) · c tamper (covered) · b button · o pause/resume heartbeats · r brown-out reset · a arm now · h help · q quit`;

async function main(): Promise<void> {
  await device.start();
  if (args["script"]) return runScript(args["script"]);
  log(HELP);
  process.stdin.setRawMode?.(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (key: string) => void handleKey(key));
}

async function handleKey(key: string): Promise<void> {
  switch (key) {
    case "m": await device.trigger("motion"); break;
    case "s": await device.trigger("sound", undefined, 3.4); break;
    case "t": await device.trigger("tamper_moved", undefined, 0.81); break;
    case "c": await device.trigger("tamper_dark", undefined, 0.02); break;
    case "d": device.sceneBrightness = device.sceneBrightness < 0.3 ? 0.85 : 0.05; log(`scene brightness ${device.brightness255}/255`); break;
    case "b": device.pressButton(); break;
    case "a": device.forceArm(); break;
    case "o": device.heartbeatsPaused = !device.heartbeatsPaused; log(`heartbeats ${device.heartbeatsPaused ? "paused (simulating Wi-Fi/power loss)" : "resumed"}`); break;
    case "r": device.resetReason = "BROWNOUT"; log("next heartbeat reports resetReason=BROWNOUT"); break;
    case "h": log(HELP); break;
    case "q": case "\u0003": await quit(); break;
  }
}

/** Steps: button | arm0 | motion | sound | tamper | dark | wait:N | hb | quit */
async function runScript(script: string): Promise<void> {
  for (const step of script.split(",").map((s) => s.trim()).filter(Boolean)) {
    const [name, arg] = step.split(":");
    log(`script: ${step}`);
    switch (name) {
      case "button": device.pressButton(); break;
      case "arm0": device.forceArm(); break;
      case "motion": await device.trigger("motion"); break;
      case "sound": await device.trigger("sound", undefined, 3.4); break;
      case "tamper": await device.trigger("tamper_moved", undefined, 0.81); break;
      case "dark": device.sceneBrightness = 0.05; break;
      case "wait": await new Promise((r) => setTimeout(r, Number(arg ?? "1") * 1000)); break;
      case "quit": await quit(); return;
      default: log(`unknown step ${step}`);
    }
  }
}

async function quit(): Promise<void> {
  log("bye");
  await device.stop();
  process.exit(0);
}

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) { out[a.slice(2)] = argv[i + 1] && !argv[i + 1]!.startsWith("--") ? argv[++i]! : "true"; }
  }
  return out;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) { console.error(`${name} is required for --link iothub`); process.exit(1); }
  return v;
}

main().catch((err) => { console.error(err); process.exit(1); });
