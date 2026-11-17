// Photo flow: GET /upload-url (device key) -> short-lived write-only SAS -> PUT JPEG.
// The storage account key never reaches the device.
#pragma once
#include <Arduino.h>

class BlobUploader {
public:
  BlobUploader(const char* apiBase, const char* deviceId, const char* uploadKey)
      : apiBase_(apiBase), deviceId_(deviceId), uploadKey_(uploadKey) {}
  // On success fills blobName (e.g. "cam-01/1794637146-0.jpg") and returns true.
  bool upload(int seq, const uint8_t* jpeg, size_t len, String& blobName, uint32_t* uploadMs = nullptr);

private:
  const char* apiBase_;
  const char* deviceId_;
  const char* uploadKey_;
};
