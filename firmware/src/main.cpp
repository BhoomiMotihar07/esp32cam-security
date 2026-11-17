// Entry point: everything lives in app/Controller. loop() is the vision task on core 1;
// NetworkTask runs on core 0.
#include <Arduino.h>
#include "app/Controller.h"

static Controller controller;

void setup() { controller.setup(); }
void loop() { controller.loop(); }
