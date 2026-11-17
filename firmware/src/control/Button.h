// Debounced push button to GND on an input with pull-up. Short press reported on release.
#pragma once
#include <Arduino.h>

class Button {
public:
  void begin(int pin) { pin_ = pin; pinMode(pin, INPUT_PULLUP); }
  // Returns true once per completed press.
  bool pressed(uint32_t nowMs) {
    bool down = digitalRead(pin_) == LOW;
    if (down != lastRaw_) { lastRaw_ = down; lastChange_ = nowMs; }
    if (nowMs - lastChange_ < 50) return false;        // bouncing
    if (down != stable_) {
      stable_ = down;
      if (!down) return true;                           // released after a stable press
    }
    return false;
  }

private:
  int pin_ = -1;
  bool lastRaw_ = false, stable_ = false;
  uint32_t lastChange_ = 0;
};
