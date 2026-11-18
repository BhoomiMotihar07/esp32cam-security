// Copy to include/secrets.h (gitignored) and fill in. Never commit secrets.h.
#pragma once

#define WIFI_SSID        "your-wifi"
#define WIFI_PASSWORD    "your-password"

// Identity shared with the app: register the same id + upload key under Family → Devices.
#define DEVICE_ID        "cam-01"
#define DEVICE_UPLOAD_KEY "dev-upload-key-123"

// Azure IoT Hub (az iot hub device-identity show -n <hub> -d cam-01 --query authentication.symmetricKey.primaryKey)
// Leave AZURE_IOT_HUB_HOST empty to run without Azure: events then go straight to Telegram.
#define AZURE_IOT_HUB_HOST   "your-hub.azure-devices.net"
#define AZURE_DEVICE_KEY     "base64-primary-key"

// HTTPS device link instead of IoT Hub: set to 1 and leave AZURE_IOT_HUB_HOST empty. The camera
// sends heartbeats/events to API_BASE_URL and polls it for commands, authenticated with
// DEVICE_UPLOAD_KEY. API_BASE_URL is the Supabase deployment (https://<service>.onrender.com/api)
// or, on the bench, the laptop dev server (http://<laptop LAN IP>:7071/api).
#define USE_LOCAL_DEV_SERVER 0

// Functions API base, e.g. https://homesec-func.azurewebsites.net/api  (or http://<laptop-ip>:7071/api for the local dev server)
#define API_BASE_URL     "https://your-func.azurewebsites.net/api"

// Telegram direct fallback (optional; the backend normally sends alerts)
#define TELEGRAM_BOT_TOKEN ""
#define TELEGRAM_CHAT_ID   ""
