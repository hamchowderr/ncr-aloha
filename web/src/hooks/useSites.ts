import { useQuery } from "@tanstack/react-query";
import { sitesApi, type Site } from "@/lib/api";

export function useSites() {
  const { data, isLoading: loading, error, refetch } = useQuery<{ sites: Site[] }, Error>({
    queryKey: ["sites"],
    queryFn: sitesApi.getSites,
  });

  return {
    sites: data?.sites ?? null,
    loading,
    error: error?.message ?? null,
    refetch,
  };
}

export function useSite(siteId: string | null) {
  const { data: site, isLoading: loading, error } = useQuery<Site, Error>({
    queryKey: ["site", siteId],
    queryFn: () => sitesApi.getSite(siteId!),
    enabled: !!siteId,
  });

  return {
    site: site ?? null,
    loading,
    error: error?.message ?? null,
  };
}
