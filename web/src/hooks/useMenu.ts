import { useQuery } from "@tanstack/react-query";
import { menuApi, type Menu } from "@/lib/api";

export function useMenu() {
  const { data: menu, isLoading: loading, error } = useQuery<Menu, Error>({
    queryKey: ["menu"],
    queryFn: menuApi.getMenu,
  });

  return {
    menu: menu ?? null,
    loading,
    error: error?.message ?? null,
  };
}
