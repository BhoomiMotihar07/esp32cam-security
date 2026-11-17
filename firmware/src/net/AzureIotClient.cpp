#include "AzureIotClient.h"
#include "SasToken.h"
#include "../config.h"
#include "esp_crt_bundle.h"

void AzureIotClient::eventHandler(void* arg, esp_event_base_t, int32_t id, void* data) {
  auto* self = static_cast<AzureIotClient*>(arg);
  auto* ev = static_cast<esp_mqtt_event_handle_t>(data);
  switch (id) {
    case MQTT_EVENT_CONNECTED:
      self->connected_ = true;
      esp_mqtt_client_subscribe(self->client_, self->c2dTopic_.c_str(), 1);
      log_i("iothub connected");
      break;
    case MQTT_EVENT_DISCONNECTED:
      self->connected_ = false;
      log_w("iothub disconnected");
      break;
    case MQTT_EVENT_DATA:
      // C2D payloads are small JSON commands; esp-mqtt may split large ones, ours fit in one event.
      if (ev->topic_len > 0 && self->handler_ && ev->data_len > 0) self->handler_(ev->data, ev->data_len);
      break;
    case MQTT_EVENT_ERROR:
      log_w("iothub mqtt error type %d", ev->error_handle ? ev->error_handle->error_type : -1);
      break;
    default:
      break;
  }
}

void AzureIotClient::start() {
  uint32_t now = time(nullptr);
  tokenExpiry_ = now + SAS_TOKEN_TTL_S;
  String resource = String(host_) + "/devices/" + deviceId_;
  password_ = buildSasToken(resource, key_, tokenExpiry_);
  username_ = String(host_) + "/" + deviceId_ + "/?api-version=2021-04-12";
  uri_ = String("mqtts://") + host_ + ":8883";
  telemetryTopic_ = String("devices/") + deviceId_ + "/messages/events/";
  c2dTopic_ = String("devices/") + deviceId_ + "/messages/devicebound/#";

  esp_mqtt_client_config_t cfg = {};
  cfg.uri = uri_.c_str();
  cfg.client_id = deviceId_;
  cfg.username = username_.c_str();
  cfg.password = password_.c_str();
  cfg.crt_bundle_attach = arduino_esp_crt_bundle_attach; // arduino-esp32 2.x name for esp_crt_bundle_attach (bundle compiled in)
  cfg.keepalive = 60;
  cfg.disable_auto_reconnect = false;
  cfg.buffer_size = 2048;
  cfg.task_stack = 6144;
  client_ = esp_mqtt_client_init(&cfg);
  esp_mqtt_client_register_event(client_, MQTT_EVENT_ANY, eventHandler, this);
  esp_mqtt_client_start(client_);
  started_ = true;
}

void AzureIotClient::stop() {
  if (client_) { esp_mqtt_client_stop(client_); esp_mqtt_client_destroy(client_); client_ = nullptr; }
  started_ = false;
  connected_ = false;
}

void AzureIotClient::loop(bool wifiUp, bool timeValid) {
  if (!configured()) return;
  if (!wifiUp || !timeValid) { if (started_) stop(); return; } // SAS needs real time
  if (!started_) { start(); return; }
  // Renew the token an hour before expiry by reconnecting with a fresh password.
  if (time(nullptr) + 3600 > tokenExpiry_) { log_i("renewing SAS token"); stop(); }
}

bool AzureIotClient::publish(const char* json, size_t len) {
  if (!connected_) return false;
  int id = esp_mqtt_client_publish(client_, telemetryTopic_.c_str(), json, len, 1, 0);
  return id >= 0;
}
