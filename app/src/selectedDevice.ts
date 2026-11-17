/** The device the screens act on. Households usually have one; the selector appears when there are more. */
import { useEffect, useState } from "react";
import type { DeviceView } from "@esp32cam/shared";

const KEY = "homesec.device";

export function useSelectedDevice(devices: DeviceView[] | undefined): [DeviceView | undefined, (id: string) => void] {
  const [id, setId] = useState<string | null>(() => localStorage.getItem(KEY));
  useEffect(() => {
    if (devices?.length && !devices.some((d) => d.deviceId === id)) setId(devices[0]!.deviceId);
  }, [devices, id]);
  const select = (next: string) => { localStorage.setItem(KEY, next); setId(next); };
  return [devices?.find((d) => d.deviceId === id), select];
}
