## Task: Project 7 — ESP32-CAM Smart Home Security (full system)
## Goal: A viva-explainable monorepo: PWA + Azure Functions/IoT Hub/Cosmos/Blob backend + Telegram + Node simulator + PlatformIO firmware, every slice smoke-checked against the simulator in local mode.

### Decisions (Rahul: "go with azure", new repo, install requirements, Azure not yet activated)
- Partition: `min_spiffs` (OTA-capable). Firmware is 1.05 MB of the 1.9 MB slot. Switch to `huge_app` only for on-chip ESP-WHO.
- Repo: /Users/bhoomimotihar/Projects/esp32cam-security (sibling of Resonance).
- Auth: own JWT (HS256) + bcrypt passwords + invite codes. SWA Free hosts the PWA only.
- Backend ports: Store (cosmos|memory), Blobs (azure|local), DeviceLink (iothub|local). dev-server runs handlers in local mode.
- Telegram sent by backend; firmware has a direct fallback when no hub / hub unreachable.
- Firmware: PlatformIO, Arduino (espressif32@6.9.0). Grayscale QQVGA loop, re-init to SVGA JPEG for bursts. No SDK for IoT Hub (hand-built SAS + esp-mqtt), root-CA bundle instead of PEMs.
- Tools installed user-locally: PlatformIO 6.2 (~/.local/tools/pio-venv), az CLI 2.79 (~/.local/tools/az-venv), Functions Core Tools as api devDependency (global npm prefix needs sudo).

### Slices
- [x] 1 scaffold + shared contract + simulator + ingest + Store (memory, cosmos)
- [x] 2 status + arm/disarm + countdown + C2D (local link, IoT Hub adapter)
- [x] 3 SAS upload + Blob adapters + event feed with photos
- [x] 4 zones + sensitivity + schedule (setConfig)
- [x] 5 Telegram alerts + commands + linking
- [x] 6 heartbeat/OFFLINE + 30 s repeat alerts + tamper/offline alerts + web push
- [x] 7 family sharing / roles
- [x] 8 firmware (camera, motion, sound, tamper, state machine + indicators, burst + upload, MQTT + heartbeat + C2D, Telegram fallback) — compiles
- [x] 9 docs, README tables, quality gates, self-review

### Verified
- `npm run check`: typecheck (4 workspaces), eslint, 34 tests (11 shared + 23 api), builds (shared, api, simulator, app).
- Local smoke (`scripts/smoke-local.sh`): register → claim → simulator arm/motion/sound → 2 events × 3 JPEGs → photo GET 200 → ack → C2D ack.
- Config smoke: PUT config v2 (2 zones + schedule) → simulator applies; bad zone → 400; snapshot/ping/arm commands → simulator reacts; appliedConfigVersion echoes.
- Firmware: `pio run` SUCCESS, RAM 15.9 %, flash 53.5 % of min_spiffs slot.
- API deploy bundle (`npm run bundle -w api`) builds with esbuild.

### Risks / open questions
- IoT Hub F1: 8,000 msgs/day. Heartbeat 60 s = 1,440; C2D also counts.
- Azure Functions timer 30 s granularity is best-effort on Consumption (cold starts).
- Camera re-init between gray loop and JPEG burst: measure on hardware (expected 0.3–0.5 s).
- `arduino_esp_crt_bundle_attach` relies on the core's compiled-in bundle (confirmed in sdkconfig for espressif32@6.9.0).
- KY-038 digital threshold pot: baseline learning tolerates a stuck-active output.
- Web Push on iOS needs an installed PWA.
- Cosmos free tier: one per subscription; serverless fallback documented.
- Deploying with bundled `@azure/functions` is standard but not exercised here (no subscription).

### Done criteria
- [x] Happy path (simulator → API → app) works end-to-end in local mode (API + simulator verified; app type-checked and built, not browser-automated)
- [x] Error paths handled (invalid JSON 400, bad config 400, unauthorized 401/403, cross-household 404, stale C2D ignored, upload failures logged and counted)
- [x] Edge cases: empty feed, no device, stale state banner, unauthorized chat, expired/wrong-blob/wrong-perm SAS, last-owner rule, single-use invites
- [x] typecheck, lint, build, tests green
- [x] Firmware compiles under PlatformIO
- [x] Self-reviewed (Gate 4)

### Review
Built: shared contract + state machine; Functions API with ports/adapters and dev server; PWA with 5 screens; simulator with local and IoT Hub links; firmware (16 modules); docs (architecture, contract, pin map, BOM, Azure + Telegram setup, test plan); smoke and webhook scripts.
Verified: see "Verified". Not verified: hardware behaviour, Azure deployment, browser UI interaction, real Telegram/Web Push delivery.
Deferred (stretch): person/face check, I2S mic, microSD queue, clips, OTA updater, signed commands, battery; Telegram snapshot echo to chat.
Self-review fixes made: injected clock in alert notify (test exposed real-clock bug); CJS SDK imports under ESM; invalid JSON → 400; scene-change re-reference flag instead of timing hack; pre-NTP timestamps stamped by the network task; Tailwind v4 `@utility` for shared button class; JpegPhoto made POD for the queue union.
