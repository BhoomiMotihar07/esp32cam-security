# Architecture

## System

```mermaid
flowchart LR
  subgraph Device["ESP32-CAM (AI-Thinker)"]
    CAM[OV2640<br/>gray QQVGA loop<br/>JPEG SVGA bursts]
    MIC[KY-038 sound<br/>pulses / 1 s window]
    BTN[Button GPIO15]
    VIS["Vision task · core 1<br/>zone motion · tamper · night<br/>state machine · LEDs · buzzer"]
    NET["Network task · core 0<br/>Wi-Fi · MQTT/TLS · HTTPS uploads<br/>RAM offline queue"]
    CAM --> VIS
    MIC --> VIS
    BTN --> VIS
    VIS -- "FreeRTOS queue: jobs" --> NET
    NET -- "FreeRTOS queue: commands" --> VIS
  end

  subgraph Azure
    HUB[(IoT Hub F1<br/>D2C telemetry · C2D commands)]
    FUNC["Azure Functions (TypeScript)<br/>HTTP API · IoT Hub trigger · timers"]
    COSMOS[(Cosmos DB<br/>devices · events · config · users)]
    BLOB[(Blob Storage<br/>private container, SAS only)]
    SWA[Static Web Apps<br/>PWA]
  end

  TG[Telegram Bot API]
  PUSH[Web Push service]
  PHONE[Phone / PWA]

  NET -- "MQTT 8883, SAS token" --> HUB
  HUB -- "Event Hub endpoint" --> FUNC
  FUNC -- "C2D (azure-iothub)" --> HUB
  NET -- "GET /upload-url (device key)<br/>PUT JPEG with write-only SAS" --> FUNC
  NET -. "PUT" .-> BLOB
  FUNC <--> COSMOS
  FUNC -- "sign SAS" --> BLOB
  FUNC -- "sendPhoto + inline buttons" --> TG
  TG -- "webhook (secret header)" --> FUNC
  FUNC -- "VAPID" --> PUSH
  SWA --> PHONE
  PHONE -- "JWT · /api" --> FUNC
  PHONE -- "read SAS" --> BLOB
  TG --> PHONE
  PUSH --> PHONE
```

## Backend layering (ports and adapters)

```mermaid
flowchart TB
  subgraph Triggers
    HTTP[functions/http.ts<br/>route table → app.http]
    IOT[functions/iothub.ts<br/>EventHub trigger]
    TIM[functions/timers.ts<br/>offline 1 min · repeat 30 s]
    DEV[dev-server.ts<br/>Node http + setInterval]
  end
  ROUTES[routes.ts]
  subgraph Domain
    ING[ingest]
    AL[alerts]
    OFF[offline]
    DVC[devices / config]
    PH[photos]
    ACC[accounts / roles]
    TGC[telegram-commands]
  end
  subgraph Ports
    STORE[Store]
    BLOBS[Blobs]
    LINK[DeviceLink]
  end
  subgraph Adapters
    MEM[memory-store<br/>JSON file]
    COS[cosmos-store]
    LB[local-blobs<br/>HMAC tokens]
    AB[azure-blobs<br/>Blob SAS]
    LL[local-link<br/>long-poll queue]
    IL[iothub-link<br/>C2D]
  end
  HTTP --> ROUTES --> Domain
  DEV --> ROUTES
  DEV --> OFF
  DEV --> AL
  IOT --> ING
  TIM --> OFF
  TIM --> AL
  Domain --> Ports
  STORE --> MEM & COS
  BLOBS --> LB & AB
  LINK --> LL & IL
```

`services.ts` is the only place that chooses adapters (`APP_MODE=local|azure`). The domain and
routes never import an SDK, which is what makes every slice testable on a laptop without an Azure
account and lets the unit tests run in milliseconds against the memory store.

## Local, Supabase and Azure modes

Supabase mode uses the same HTTPS device routes as local mode, with Postgres, Storage and a
command table behind them; see [setup-supabase.md](setup-supabase.md).

### Local vs Azure

| concern | local (`npm run dev -w api`) | Azure |
|---|---|---|
| device → cloud | `POST /api/device/{id}/telemetry` (device key) | IoT Hub D2C → Event Hub trigger |
| cloud → device | `GET /api/device/{id}/commands` (device key) | IoT Hub C2D (`azure-iothub`) |
| photos | `PUT/GET /api/local/blob/{name}?perm=&exp=&sig=` (HMAC) | Blob SAS (`sp=cw` write, `sp=r` read) |
| data | `.data/store.json` | Cosmos DB |
| timers | `setInterval` | timer triggers |

The simulator speaks both: `--link local` (default) and `--link iothub`.

## Arming state machine

```mermaid
stateDiagram-v2
  [*] --> DISARMED
  DISARMED --> EXIT_COUNTDOWN: arm (app/button, exitDelay > 0)
  DISARMED --> ARMED: arm (schedule / auto-dark / exitDelay 0)
  EXIT_COUNTDOWN --> ARMED: countdown elapsed → lock exposure, reference frame
  EXIT_COUNTDOWN --> DISARMED: disarm
  ARMED --> ALARM: candidate (motion / sound / tamper) → 3-photo burst, event
  ALARM --> ARMED: ack (app, Telegram button)
  ALARM --> DISARMED: disarm
  ARMED --> DISARMED: disarm
```

Implemented once in `shared/src/state-machine.ts` (used by the simulator, pinned by tests) and
mirrored in `firmware/src/control/AlarmStateMachine.cpp`.

## Alert lifecycle

```mermaid
sequenceDiagram
  participant D as Device
  participant F as Functions
  participant T as Telegram
  participant P as Phone
  D->>F: GET /upload-url ×3 (device key)
  F-->>D: write-only SAS ×3
  D->>Blob: PUT jpeg ×3
  D->>F: event{photos[]} via IoT Hub
  F->>Cosmos: event (alert.acknowledged=false)
  F->>T: sendPhoto + [Acknowledge][Disarm][Snapshot]
  F->>P: Web Push
  loop every 30 s until ack (max 20)
    F->>T: reminder
  end
  P->>F: POST /events/{id}/ack   (or Telegram button)
  F->>D: C2D ack → siren off, stays ARMED
  F->>T: edit: remove buttons, "acknowledged by …"
```

## Data model (Cosmos)

| container | partition key | documents |
|---|---|---|
| `devices` | `/deviceId` | one per device: state, last heartbeat fields, household, upload-key hash |
| `events` | `/deviceId` | one per event with embedded `alert` state |
| `config` | `/deviceId` | current `DeviceConfig` (versioned) |
| `users` | `/householdId` | `type`: `user`, `household`, `invite`, `telegramLink`, `linkCode`, `pushSub` |

Cross-partition queries (user by email, Telegram chat by id, all devices for the offline timer) are
cheap at household scale and are isolated inside `cosmos-store.ts`.

## Security model

- **App users**: email + bcrypt password → HS256 JWT (7 d). The user document is re-read on every
  request so a role change or removal applies immediately. Roles: owner / member / viewer
  (`shared/src/roles.ts`), checked server-side on every route; household ownership is checked on
  every device, event and photo access.
- **Devices**: IoT Hub device key (SAS) for MQTT; a separate per-device upload key (sha256 stored)
  for the SAS-grant endpoint. The server names the blob, so a device writes only under its prefix.
- **Storage**: private container; app and Telegram only ever receive short-lived SAS URLs.
- **Telegram**: webhook authenticated by `X-Telegram-Bot-Api-Secret-Token`; only linked chats can
  act; linking requires a one-time code minted by an app user with `telegram.link` permission, and
  the linked user's *current* role gates every command and button.
- **Secrets**: none in the repo (`secrets.h`, `local.settings.json`, `.env` are gitignored).

## Why not Static Web Apps built-in auth?

IoT Hub and timer triggers cannot run in SWA-managed functions, and linking an external Function
App (which forwards the signed identity header) is a Standard-tier feature. SWA Free therefore hosts
only the PWA, and the API authenticates with its own JWT.
