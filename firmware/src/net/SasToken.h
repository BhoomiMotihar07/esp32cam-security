// IoT Hub shared-access signature, built by hand so every step is explainable:
//   sig = base64( HMAC-SHA256( base64decode(deviceKey), urlencode(resourceUri) + "\n" + expiry ) )
//   token = "SharedAccessSignature sr=<urlencode(resourceUri)>&sig=<urlencode(sig)>&se=<expiry>"
#pragma once
#include <Arduino.h>

String urlEncode(const String& s);
String buildSasToken(const String& resourceUri, const String& base64Key, uint32_t expiryEpoch);
