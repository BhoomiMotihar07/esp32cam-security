// Owner-drawn zones in normalised coordinates, converted to pixel rectangles once per frame size.
#pragma once
#include <Arduino.h>

constexpr int MAX_ZONES = 8;

struct Zone {
  char id[16] = "";
  char name[24] = "";
  bool enabled = false;
  float x = 0, y = 0, w = 1, h = 1; // 0..1
};

struct PixelRect {
  int x0, y0, x1, y1; // half-open
  int area() const { return max(0, x1 - x0) * max(0, y1 - y0); }
};

inline PixelRect toPixels(const Zone& z, int width, int height) {
  PixelRect r;
  r.x0 = constrain(int(z.x * width), 0, width);
  r.y0 = constrain(int(z.y * height), 0, height);
  r.x1 = constrain(int((z.x + z.w) * width + 0.5f), r.x0, width);
  r.y1 = constrain(int((z.y + z.h) * height + 0.5f), r.y0, height);
  return r;
}
