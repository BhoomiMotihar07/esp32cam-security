// Small wrapper over ESP-IDF esp_http_client with the built-in root-CA bundle, so no PEM
// certificates live in the repo. Used for the SAS grant, the blob PUT and Telegram.
#pragma once
#include <Arduino.h>
#include "esp_http_client.h"

struct HttpResult {
  int status = 0;
  String body;   // response body (truncated to maxBody)
};

class HttpLite {
public:
  // GET with optional header; body captured.
  static HttpResult get(const String& url, const char* headerName = nullptr, const char* headerValue = nullptr, size_t maxBody = 2048);
  // Streams `len` bytes from `data` with the given content type. extra headers: name/value pairs.
  static HttpResult put(const String& url, const uint8_t* data, size_t len, const char* contentType,
                        const char* const* extraHeaders = nullptr, int extraCount = 0);
  // POST with an in-memory body (JSON).
  static HttpResult post(const String& url, const uint8_t* data, size_t len, const char* contentType);
  // Multipart POST with one text field set and one file part (Telegram sendPhoto).
  static HttpResult postMultipart(const String& url, const String& fields /* already formatted parts */,
                                  const char* fileField, const char* fileName, const uint8_t* file, size_t fileLen,
                                  const String& boundary);
private:
  static esp_http_client_handle_t open(const String& url, esp_http_client_method_t method, int timeoutMs);
  static HttpResult readResponse(esp_http_client_handle_t c, size_t maxBody);
};
