#include "TelegramClient.h"
#include "HttpLite.h"

static const char* BOUNDARY = "homesecBoundary7e3";

static String field(const char* name, const String& value) {
  return String("--") + BOUNDARY + "\r\nContent-Disposition: form-data; name=\"" + name + "\"\r\n\r\n" + value + "\r\n";
}

bool TelegramClient::sendMessage(const String& text) {
  if (!configured()) return false;
  String url = String("https://api.telegram.org/bot") + token_ + "/sendMessage";
  String body = String("{\"chat_id\":\"") + chatId_ + "\",\"text\":" + jsonString(text) + "}";
  HttpResult r = HttpLite::post(url, (const uint8_t*)body.c_str(), body.length(), "application/json");
  if (r.status != 200) log_w("telegram sendMessage: %d %s", r.status, r.body.c_str());
  return r.status == 200;
}

bool TelegramClient::sendPhoto(const uint8_t* jpeg, size_t len, const String& caption) {
  if (!configured()) return false;
  String url = String("https://api.telegram.org/bot") + token_ + "/sendPhoto";
  String fields = field("chat_id", chatId_) + field("caption", caption);
  HttpResult r = HttpLite::postMultipart(url, fields, "photo", "evidence.jpg", jpeg, len, BOUNDARY);
  if (r.status != 200) log_w("telegram sendPhoto: %d %s", r.status, r.body.c_str());
  return r.status == 200;
}

String TelegramClient::jsonString(const String& s) {
  String out = "\"";
  for (size_t i = 0; i < s.length(); i++) {
    char c = s[i];
    if (c == '"' || c == '\\') { out += '\\'; out += c; }
    else if (c == '\n') out += "\\n";
    else out += c;
  }
  return out + "\"";
}
