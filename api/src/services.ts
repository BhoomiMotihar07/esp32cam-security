/**
 * Composition root: picks adapters from AppConfig once per process.
 * Tests call createServices() with a config and in-memory adapters.
 */
import { loadConfig, type AppConfig } from "./config.js";
import type { Store } from "./ports/store.js";
import type { Blobs } from "./ports/blobs.js";
import type { DeviceLink } from "./ports/device-link.js";
import { MemoryStore } from "./adapters/memory-store.js";
import { CosmosStore } from "./adapters/cosmos-store.js";
import { LocalBlobs } from "./adapters/local-blobs.js";
import { AzureBlobs } from "./adapters/azure-blobs.js";
import { LocalLink } from "./adapters/local-link.js";
import { IotHubLink } from "./adapters/iothub-link.js";
import { TelegramClient } from "./domain/telegram-client.js";
import { PushSender } from "./domain/push.js";
import { consoleLogger, type Logger } from "./util.js";
import { join } from "node:path";

export interface Services {
  config: AppConfig;
  store: Store;
  blobs: Blobs;
  link: DeviceLink;
  telegram: TelegramClient | null;
  push: PushSender | null;
  log: Logger;
  /** local-mode extras the dev server needs; undefined in Azure */
  local?: { blobs: LocalBlobs; link: LocalLink };
}

export function createServices(config: AppConfig, overrides: Partial<Services> = {}): Services {
  const log = overrides.log ?? consoleLogger;
  let store: Store;
  let blobs: Blobs;
  let link: DeviceLink;
  let local: Services["local"];

  if (config.mode === "azure") {
    store = new CosmosStore(config.cosmos.connectionString, config.cosmos.database);
    blobs = new AzureBlobs(config.storage.connectionString, config.storage.container);
    link = new IotHubLink(config.iotHub.serviceConnectionString);
  } else {
    const localBlobs = new LocalBlobs(join(config.localDataDir, "blobs"), config.localBlobSecret, config.publicApiBase);
    const localLink = new LocalLink();
    store = new MemoryStore(join(config.localDataDir, "store.json"));
    blobs = localBlobs;
    link = localLink;
    local = { blobs: localBlobs, link: localLink };
  }

  const telegram = config.telegram.botToken ? new TelegramClient(config.telegram.botToken, log) : null;
  const push = config.vapid.publicKey && config.vapid.privateKey ? new PushSender(config.vapid, log) : null;

  return { config, store, blobs, link, telegram, push, log, local, ...overrides };
}

let singleton: Services | null = null;

/** Process-wide services for the Functions host and dev server. */
export function getServices(): Services {
  if (!singleton) singleton = createServices(loadConfig());
  return singleton;
}
