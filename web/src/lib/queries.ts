import { QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError, api, errorMessage } from "@/lib/api";
import type {
  AnalyticsRange,
  AnalyticsSummary,
  AnalyticsTimeseries,
  AnalyticsTop,
  CertificateSummary,
  HostDetail,
  HostFlags,
  HostListItem,
  SystemInfo,
  UpstreamPool,
} from "@/lib/types";

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        refetchOnWindowFocus: true,
        retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
      },
      mutations: { retry: false },
    },
  });
}

export const queryKeys = {
  hosts: ["hosts"] as const,
  host: (id: number) => ["hosts", id] as const,
  hostConfig: (id: number) => ["hosts", id, "config"] as const,
  pools: ["upstream-pools"] as const,
  certificates: ["certificates"] as const,
  systemInfo: ["system", "info"] as const,
  analytics: (kind: string, range: AnalyticsRange, hostId?: number, extra?: string) =>
    ["analytics", kind, range, hostId ?? "all", extra ?? ""] as const,
};

export const useHosts = () => useQuery({ queryKey: queryKeys.hosts, queryFn: () => api<HostListItem[]>("/hosts") });

export const useHost = (id: number) =>
  useQuery({ queryKey: queryKeys.host(id), queryFn: () => api<HostDetail>(`/hosts/${id}`), enabled: Number.isInteger(id) && id > 0 });

export const useHostConfig = (id: number) =>
  useQuery({ queryKey: queryKeys.hostConfig(id), queryFn: () => api<{ config: string }>(`/hosts/${id}/config`) });

export const usePools = () => useQuery({ queryKey: queryKeys.pools, queryFn: () => api<UpstreamPool[]>("/upstream-pools") });

export const useCertificates = () =>
  useQuery({ queryKey: queryKeys.certificates, queryFn: () => api<CertificateSummary[]>("/certificates") });

export const useSystemInfo = () => useQuery({ queryKey: queryKeys.systemInfo, queryFn: () => api<SystemInfo>("/system/info") });

const ANALYTICS_REFRESH_MS = 30_000;

export const useAnalyticsSummary = (range: AnalyticsRange, hostId?: number) =>
  useQuery({
    queryKey: queryKeys.analytics("summary", range, hostId),
    queryFn: () => api<AnalyticsSummary>("/analytics/summary", { query: { range, hostId } }),
    refetchInterval: ANALYTICS_REFRESH_MS,
  });

export const useAnalyticsTimeseries = (range: AnalyticsRange, hostId?: number) =>
  useQuery({
    queryKey: queryKeys.analytics("timeseries", range, hostId),
    queryFn: () => api<AnalyticsTimeseries>("/analytics/timeseries", { query: { range, hostId } }),
    refetchInterval: ANALYTICS_REFRESH_MS,
  });

export const useAnalyticsTop = (range: AnalyticsRange, kind: "IP" | "PATH", hostId?: number) =>
  useQuery({
    queryKey: queryKeys.analytics("top", range, hostId, kind),
    queryFn: () => api<AnalyticsTop>("/analytics/top", { query: { range, hostId, kind, limit: 10 } }),
    refetchInterval: ANALYTICS_REFRESH_MS,
  });

/** Quick on/off switches (PATCH /hosts/:id/toggles) with optimistic updates. */
export function useHostToggle(id: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<HostFlags>) => api<HostDetail>(`/hosts/${id}/toggles`, { method: "PATCH", body: patch }),
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.hosts });
      const previousHost = queryClient.getQueryData<HostDetail>(queryKeys.host(id));
      const previousList = queryClient.getQueryData<HostListItem[]>(queryKeys.hosts);
      if (previousHost) queryClient.setQueryData(queryKeys.host(id), { ...previousHost, ...patch });
      if (previousList) {
        queryClient.setQueryData(
          queryKeys.hosts,
          previousList.map((host) => (host.id === id ? { ...host, ...patch } : host)),
        );
      }
      return { previousHost, previousList };
    },
    onError: (error, _patch, context) => {
      if (context?.previousHost) queryClient.setQueryData(queryKeys.host(id), context.previousHost);
      if (context?.previousList) queryClient.setQueryData(queryKeys.hosts, context.previousList);
      toast.error(errorMessage(error));
    },
    onSuccess: (host) => {
      queryClient.setQueryData(queryKeys.host(id), host);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.hosts });
      void queryClient.invalidateQueries({ queryKey: queryKeys.systemInfo });
    },
  });
}
