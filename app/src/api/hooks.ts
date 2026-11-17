/** React Query hooks over the API. Polling intervals are the app's "live" mechanism. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DeviceConfig, DeviceView, EventType, EventView, InviteView, MemberView, PhotoUrl, TelegramLinkView } from "@esp32cam/shared";
import { del, get, patch, post, put } from "./client";

export const DEVICE_POLL_MS = 3000;
export const EVENTS_POLL_MS = 5000;

export interface ConfigResponse { config: DeviceConfig; updatedAt: number; updatedBy: string; appliedVersion?: number }
export interface HouseholdResponse { household: { id: string; name: string }; members: MemberView[]; invites: InviteView[]; telegramLinks: TelegramLinkView[] }
export interface SnapshotResponse { blob: string | null; url?: string; expiresAt?: number; ts?: number }

export const useDevices = () => useQuery({ queryKey: ["devices"], queryFn: () => get<DeviceView[]>("devices"), refetchInterval: DEVICE_POLL_MS });
export const useDevice = (id: string | undefined) =>
  useQuery({ queryKey: ["device", id], queryFn: () => get<DeviceView>(`devices/${id}`), enabled: !!id, refetchInterval: DEVICE_POLL_MS });
export const useEvents = (id: string | undefined, type?: EventType) =>
  useQuery({
    queryKey: ["events", id, type ?? "all"],
    queryFn: () => get<EventView[]>(`devices/${id}/events?limit=100${type ? `&type=${type}` : ""}`),
    enabled: !!id,
    refetchInterval: EVENTS_POLL_MS,
  });
export const useConfig = (id: string | undefined) => useQuery({ queryKey: ["config", id], queryFn: () => get<ConfigResponse>(`devices/${id}/config`), enabled: !!id });
export const useHousehold = () => useQuery({ queryKey: ["household"], queryFn: () => get<HouseholdResponse>("household") });
export const useSnapshot = (id: string | undefined) => useQuery({ queryKey: ["snapshot", id], queryFn: () => get<SnapshotResponse>(`devices/${id}/snapshot`), enabled: !!id });
export const usePhotoUrl = (blob: string | undefined) =>
  useQuery({ queryKey: ["photo", blob], queryFn: () => get<PhotoUrl>(`photos/url?blob=${encodeURIComponent(blob!)}`), enabled: !!blob, staleTime: 10 * 60_000 });

export function useSendCommand(deviceId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (cmd: "arm" | "disarm" | "snapshot" | "ping") => post<{ sent: boolean }>(`devices/${deviceId}/commands`, { cmd }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["device", deviceId] }),
  });
}

export function useAcknowledge(deviceId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (eventId: string) => post<EventView>(`devices/${deviceId}/events/${eventId}/ack`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["events", deviceId] }),
  });
}

export function useSaveConfig(deviceId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: DeviceConfig) => put<ConfigResponse>(`devices/${deviceId}/config`, config),
    onSuccess: (data) => qc.setQueryData(["config", deviceId], data),
  });
}

export function useClaimDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { deviceId: string; name: string; uploadKey: string }) => post<DeviceView>("devices", body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["devices"] }),
  });
}

export function useHouseholdMutations() {
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: ["household"] });
  return {
    invite: useMutation({ mutationFn: (role: "member" | "viewer") => post<InviteView>("household/invites", { role }), onSuccess: refresh }),
    setRole: useMutation({ mutationFn: (v: { userId: string; role: string }) => patch<MemberView>(`household/members/${v.userId}`, { role: v.role }), onSuccess: refresh }),
    remove: useMutation({ mutationFn: (userId: string) => del<void>(`household/members/${userId}`), onSuccess: refresh }),
    linkCode: useMutation({ mutationFn: () => post<{ code: string; expiresAt: number }>("telegram/link-code") }),
    unlinkTelegram: useMutation({ mutationFn: (chatId: string) => del<void>(`telegram/links/${chatId}`), onSuccess: refresh }),
  };
}
