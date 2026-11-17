# Azure setup (free / student tier)

Everything below fits Azure for Students with no card. Run the commands in order; each block says
what to paste into `api/local.settings.json` (local `func start`) or the Function App settings.

Prerequisites: `az` CLI (this repo's install used `pip install azure-cli` in a venv; Homebrew `brew
install azure-cli` also works), Node 20+, and `npx func` from the `api` workspace
(`azure-functions-core-tools` is a dev dependency; run `npm install-scripts approve azure-functions-core-tools`
once if npm skipped its post-install).

```sh
az login                              # BITS e-mail, Azure for Students subscription
az account show --query name -o tsv
az extension add --name azure-iot     # az iot ... commands

# pick globally unique lowercase names
RG=homesec-rg
LOC=centralindia                      # or southeastasia; SWA has its own region list below
HUB=homesec-hub-<yourname>
STORAGE=homesecstore<yourname>        # 3-24 chars, letters+digits only
COSMOS=homesec-cosmos-<yourname>
FUNC=homesec-func-<yourname>
SWA=homesec-app-<yourname>

az group create -n $RG -l $LOC
```

## 1. IoT Hub F1 (8,000 messages/day, one per subscription)

```sh
az iot hub create -g $RG -n $HUB --sku F1 --partition-count 2 -l $LOC
az iot hub device-identity create -n $HUB -d cam-01

# firmware secrets.h → AZURE_IOT_HUB_HOST / AZURE_DEVICE_KEY
az iot hub show -n $HUB --query properties.hostName -o tsv
az iot hub device-identity show -n $HUB -d cam-01 --query authentication.symmetricKey.primaryKey -o tsv

# simulator (--link iothub) → IOTHUB_DEVICE_CONNECTION_STRING
az iot hub device-identity connection-string show -n $HUB -d cam-01 -o tsv

# Functions settings
az iot hub connection-string show -n $HUB --policy-name service -o tsv            # IOTHUB_SERVICE_CONNECTION_STRING
az iot hub connection-string show -n $HUB --default-eventhub -o tsv               # IOTHUB_EVENTHUB_CONNECTION
az iot hub show -n $HUB --query properties.eventHubEndpoints.events.path -o tsv   # IOTHUB_EVENTHUB_NAME
```

Budget: heartbeat every 60 s = 1,440/day per device; events, state changes and C2D commands add
a few hundred. Two devices still fit. Watch *IoT Hub → Overview → Device to cloud messages*.

Verify from the laptop before touching hardware:

```sh
export IOTHUB_DEVICE_CONNECTION_STRING="$(az iot hub device-identity connection-string show -n $HUB -d cam-01 -o tsv)"
npm run sim -- --link iothub --api https://$FUNC.azurewebsites.net/api --heartbeat 20
az iot hub monitor-events -n $HUB -d cam-01      # or Azure IoT Explorer
```

## 2. Storage (evidence photos, private container)

```sh
az storage account create -g $RG -n $STORAGE -l $LOC --sku Standard_LRS --kind StorageV2 \
  --allow-blob-public-access false --min-tls-version TLS1_2
CS=$(az storage account show-connection-string -g $RG -n $STORAGE -o tsv)        # STORAGE_CONNECTION_STRING
az storage container create -n evidence --connection-string "$CS"               # BLOB_CONTAINER=evidence
```

The same account doubles as `AzureWebJobsStorage` for the Function App. Optional lifecycle rule to
delete photos after 30 days: *Storage → Lifecycle management → add rule (delete blobs > 30 days)*.

## 3. Cosmos DB (free tier: 1000 RU/s + 25 GB, one per subscription)

```sh
az cosmosdb create -g $RG -n $COSMOS --enable-free-tier true --default-consistency-level Session \
  --locations regionName=$LOC failoverPriority=0
# shared throughput at database level so four containers stay inside the free 1000 RU/s
az cosmosdb sql database create -a $COSMOS -g $RG -n homesec --throughput 1000
for c in devices:/deviceId events:/deviceId config:/deviceId users:/householdId; do
  az cosmosdb sql container create -a $COSMOS -g $RG -d homesec -n ${c%%:*} --partition-key-path ${c##*:}
done
az cosmosdb keys list -g $RG -n $COSMOS --type connection-strings \
  --query "connectionStrings[0].connectionString" -o tsv                        # COSMOS_CONNECTION_STRING
```

If the free tier is already used by another account in the subscription, create a **serverless**
account instead (`--capabilities EnableServerless`, omit `--throughput`): pay-per-request, a few
rupees a month at this scale. Flagged: not free, but close.

## 4. Function App (Consumption plan: 1M executions/month free)

```sh
az functionapp create -g $RG -n $FUNC --consumption-plan-location $LOC \
  --runtime node --runtime-version 20 --functions-version 4 --os-type Linux --storage-account $STORAGE

az functionapp config appsettings set -g $RG -n $FUNC --settings \
  APP_MODE=azure \
  JWT_SECRET="$(openssl rand -base64 32)" \
  SETUP_CODE="$(openssl rand -hex 8)" \
  APP_ORIGIN="https://$SWA.azurestaticapps.net" \
  COSMOS_CONNECTION_STRING="<from step 3>" COSMOS_DATABASE=homesec \
  STORAGE_CONNECTION_STRING="$CS" BLOB_CONTAINER=evidence \
  IOTHUB_SERVICE_CONNECTION_STRING="<step 1>" \
  IOTHUB_EVENTHUB_CONNECTION="<step 1 default-eventhub>" IOTHUB_EVENTHUB_NAME="<step 1 path>" \
  TELEGRAM_BOT_TOKEN="<docs/setup-telegram.md>" TELEGRAM_WEBHOOK_SECRET="$(openssl rand -hex 16)" \
  VAPID_PUBLIC_KEY="<npx web-push generate-vapid-keys>" VAPID_PRIVATE_KEY="<same>" VAPID_SUBJECT="mailto:you@example.com" \
  ALERT_MAX_REPEATS=20

# browser calls from the PWA origin (the dev server adds these headers itself)
az functionapp cors add -g $RG -n $FUNC --allowed-origins "https://$SWA.azurestaticapps.net" http://localhost:5173
```

Note the `SETUP_CODE` you generated: it creates the first owner account in the app.

Deploy (the API is bundled with esbuild so the workspace package `@esp32cam/shared` and all
dependencies ship inside the zip):

```sh
npm run build -w shared
npm run bundle -w api            # writes api/deploy/
cd api/deploy && npx func azure functionapp publish $FUNC --javascript && cd ../..
curl https://$FUNC.azurewebsites.net/api/push/vapid-public-key
```

The Cosmos containers are also created on first use by `CosmosStore.ensureContainers()` if you skip
the loop in step 3 (free-tier shared throughput then does **not** apply, so prefer the loop).

## 5. Static Web App (PWA host, Free tier)

```sh
# SWA regions: westus2, centralus, eastus2, westeurope, eastasia
az staticwebapp create -g $RG -n $SWA -l eastasia --sku Free
SWA_TOKEN=$(az staticwebapp secrets list -g $RG -n $SWA --query properties.apiKey -o tsv)

VITE_API_BASE="https://$FUNC.azurewebsites.net/api" npm run build -w app
npx @azure/static-web-apps-cli deploy ./app/dist --deployment-token "$SWA_TOKEN" --env production
echo "https://$SWA.azurestaticapps.net"
```

Open it on the phone, *Add to Home Screen* (needed for Web Push on iOS), *First setup* with the
`SETUP_CODE`, then *Family → Devices* to register `cam-01` with the upload key from `secrets.h`.

## 6. Budget alert and cleanup

Portal → *Cost Management → Budgets → Add* (e.g. ₹200/month, alert at 80 %). To delete everything:
`az group delete -n $RG --yes`.

## Settings reference

| setting | used by | notes |
|---|---|---|
| `APP_MODE` | services.ts | `local` or `azure` (defaults to azure when a Cosmos string is set) |
| `JWT_SECRET`, `SETUP_CODE` | auth | ≥ 16 chars; setup code bootstraps the first owner |
| `APP_ORIGIN`, `PUBLIC_API_BASE` | CORS, local blob URLs | PUBLIC_API_BASE only matters in local mode |
| `COSMOS_*`, `STORAGE_*`, `BLOB_CONTAINER` | adapters | |
| `IOTHUB_SERVICE_CONNECTION_STRING` | C2D commands | policy `service` |
| `IOTHUB_EVENTHUB_CONNECTION`, `IOTHUB_EVENTHUB_NAME` | ingest trigger | Event Hub-compatible endpoint |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` | alerts, webhook | empty = Telegram off |
| `VAPID_*` | web push | empty = push off (app shows a notice) |
| `ALERT_MAX_REPEATS` | repeat timer | default 20 (10 minutes of reminders) |

Paid-tier items this design deliberately avoids: SWA Standard (linked backend), Cosmos provisioned
throughput above the free 1000 RU/s, IoT Hub S1, Application Insights beyond the free 5 GB/month
(sampling is enabled in `host.json`).
