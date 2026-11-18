#include "HttpLite.h"
#include "esp_crt_bundle.h"

esp_http_client_handle_t HttpLite::open(const String& url, esp_http_client_method_t method, int timeoutMs) {
  esp_http_client_config_t cfg = {};
  cfg.url = url.c_str();
  cfg.method = method;
  cfg.timeout_ms = timeoutMs;
  cfg.crt_bundle_attach = arduino_esp_crt_bundle_attach; // arduino-esp32 2.x name for esp_crt_bundle_attach (bundle compiled in) // Mozilla root bundle compiled into the IDF
  cfg.buffer_size = 2048;
  cfg.buffer_size_tx = 2048;
  return esp_http_client_init(&cfg);
}

HttpResult HttpLite::readResponse(esp_http_client_handle_t c, size_t maxBody) {
  HttpResult r;
  r.status = esp_http_client_get_status_code(c);
  char buf[512];
  while (true) {
    int n = esp_http_client_read(c, buf, sizeof(buf));
    if (n <= 0) break;
    if (r.body.length() < maxBody) r.body.concat(buf, min<size_t>(n, maxBody - r.body.length()));
  }
  return r;
}

HttpResult HttpLite::get(const String& url, const char* hName, const char* hValue, size_t maxBody) {
  HttpResult r;
  esp_http_client_handle_t c = open(url, HTTP_METHOD_GET, 10000);
  if (!c) return r;
  if (hName) esp_http_client_set_header(c, hName, hValue);
  if (esp_http_client_open(c, 0) == ESP_OK) {
    esp_http_client_fetch_headers(c);
    r = readResponse(c, maxBody);
  } else {
    log_w("GET open failed: %s", url.c_str());
  }
  esp_http_client_close(c);
  esp_http_client_cleanup(c);
  return r;
}

HttpResult HttpLite::put(const String& url, const uint8_t* data, size_t len, const char* contentType,
                         const char* const* extra, int extraCount) {
  HttpResult r;
  esp_http_client_handle_t c = open(url, HTTP_METHOD_PUT, 20000);
  if (!c) return r;
  esp_http_client_set_header(c, "Content-Type", contentType);
  for (int i = 0; i + 1 < extraCount * 2; i += 2) esp_http_client_set_header(c, extra[i], extra[i + 1]);
  if (esp_http_client_open(c, len) == ESP_OK) {
    size_t sent = 0;
    while (sent < len) {
      int n = esp_http_client_write(c, (const char*)data + sent, min<size_t>(4096, len - sent));
      if (n <= 0) break;
      sent += n;
    }
    esp_http_client_fetch_headers(c);
    r = readResponse(c, 512);
  } else {
    log_w("PUT open failed");
  }
  esp_http_client_close(c);
  esp_http_client_cleanup(c);
  return r;
}

HttpResult HttpLite::post(const String& url, const uint8_t* data, size_t len, const char* contentType,
                          const char* hName, const char* hValue) {
  HttpResult r;
  esp_http_client_handle_t c = open(url, HTTP_METHOD_POST, 15000);
  if (!c) return r;
  esp_http_client_set_header(c, "Content-Type", contentType);
  if (hName) esp_http_client_set_header(c, hName, hValue);
  if (esp_http_client_open(c, len) == ESP_OK) {
    esp_http_client_write(c, (const char*)data, len);
    esp_http_client_fetch_headers(c);
    r = readResponse(c, 512);
  }
  esp_http_client_close(c);
  esp_http_client_cleanup(c);
  return r;
}

HttpResult HttpLite::postMultipart(const String& url, const String& fields, const char* fileField, const char* fileName,
                                   const uint8_t* file, size_t fileLen, const String& boundary) {
  HttpResult r;
  String head = fields + "--" + boundary + "\r\nContent-Disposition: form-data; name=\"" + fileField + "\"; filename=\"" + fileName +
                "\"\r\nContent-Type: image/jpeg\r\n\r\n";
  String tail = "\r\n--" + boundary + "--\r\n";
  size_t total = head.length() + fileLen + tail.length();

  esp_http_client_handle_t c = open(url, HTTP_METHOD_POST, 20000);
  if (!c) return r;
  String ct = "multipart/form-data; boundary=" + boundary;
  esp_http_client_set_header(c, "Content-Type", ct.c_str());
  if (esp_http_client_open(c, total) == ESP_OK) {
    esp_http_client_write(c, head.c_str(), head.length());
    size_t sent = 0;
    while (sent < fileLen) {
      int n = esp_http_client_write(c, (const char*)file + sent, min<size_t>(4096, fileLen - sent));
      if (n <= 0) break;
      sent += n;
    }
    esp_http_client_write(c, tail.c_str(), tail.length());
    esp_http_client_fetch_headers(c);
    r = readResponse(c, 512);
  }
  esp_http_client_close(c);
  esp_http_client_cleanup(c);
  return r;
}
