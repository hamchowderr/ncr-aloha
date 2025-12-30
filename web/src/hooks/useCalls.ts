import { useQuery } from "@tanstack/react-query";
import { callsApi, type CallsResponse, type CallMetrics } from "@/lib/api";

export function useCalls(limit?: number) {
  const { data, isLoading: loading, error, refetch } = useQuery<CallsResponse, Error>({
    queryKey: ["calls", limit],
    queryFn: () => callsApi.getCalls(limit),
  });

  return {
    calls: data?.calls ?? null,
    summary: data?.summary ?? null,
    loading,
    error: error?.message ?? null,
    refetch,
  };
}

export function useCall(sessionId: string | null) {
  const { data: call, isLoading: loading, error } = useQuery<CallMetrics, Error>({
    queryKey: ["call", sessionId],
    queryFn: () => callsApi.getCall(sessionId!),
    enabled: !!sessionId,
  });

  return {
    call: call ?? null,
    loading,
    error: error?.message ?? null,
  };
}
