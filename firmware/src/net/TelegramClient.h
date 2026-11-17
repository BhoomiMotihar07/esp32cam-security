// Direct Telegram fallback (the backend normally sends alerts with buttons).
#pragma once
#include <Arduino.h>

class TelegramClient {
public:
  TelegramClient(const char* token, const char* chatId) : token_(token), chatId_(chatId) {}
  bool configured() const { return token_ && token_[0] && chatId_ && chatId_[0]; }
  bool sendMessage(const String& text);
  bool sendPhoto(const uint8_t* jpeg, size_t len, const String& caption);

private:
  static String jsonString(const String& s);
  const char* token_;
  const char* chatId_;
};
