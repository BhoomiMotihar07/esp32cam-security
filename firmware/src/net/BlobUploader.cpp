#include "BlobUploader.h"
#include <ArduinoJson.h>
#include "HttpLite.h"

bool BlobUploader::upload(int seq, const uint8_t* jpeg, size_t len, String& blobName, uint32_t* uploadMs) {
  uint32_t t0 = millis();
  String grantUrl = String(apiBase_) + "/upload-url?deviceId=" + deviceId_ + "&seq=" + String(seq);
  HttpResult grant = HttpLite::get(grantUrl, "x-device-key", uploadKey_);
  if (grant.status != 200) {
    log_w("upload-url failed: %d %s", grant.status, grant.body.c_str());
    return false;
  }
  JsonDocument doc;
  if (deserializeJson(doc, grant.body) || !doc["url"].is<const char*>()) {
    log_w("upload-url bad json");
    return false;
  }
  String url = doc["url"].as<const char*>();
  blobName = doc["blob"].as<const char*>();

  // x-ms-blob-type is mandatory for Azure block blobs; the local dev server ignores it.
  const char* headers[] = { "x-ms-blob-type", "BlockBlob" };
  HttpResult put = HttpLite::put(url, jpeg, len, "image/jpeg", headers, 1);
  if (put.status < 200 || put.status >= 300) {
    log_w("blob PUT failed: %d %s", put.status, put.body.c_str());
    return false;
  }
  if (uploadMs) *uploadMs = millis() - t0;
  log_i("upload: %s %u bytes in %lu ms", blobName.c_str(), len, millis() - t0);
  return true;
}
