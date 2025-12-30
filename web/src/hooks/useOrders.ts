import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ordersApi, type Order } from "@/lib/api";

interface OrderFilters {
  status?: string;
  limit?: number;
}

export function useOrders(filters: OrderFilters = {}) {
  const queryClient = useQueryClient();

  const { data, isLoading: loading, error, refetch } = useQuery<{ orders: Order[] }, Error>({
    queryKey: ["orders", filters],
    queryFn: ordersApi.getOrders,
  });

  // Filter client-side if needed (since we're using local data)
  let orders = data?.orders ?? null;
  if (orders && filters.status) {
    orders = orders.filter((o) => o.status === filters.status);
  }
  if (orders && filters.limit) {
    orders = orders.slice(0, filters.limit);
  }

  const acknowledgeMutation = useMutation({
    mutationFn: ordersApi.acknowledgeOrder,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
  });

  const acknowledgeOrder = async (orderId: string) => {
    await acknowledgeMutation.mutateAsync(orderId);
  };

  return {
    orders,
    loading,
    error: error?.message ?? null,
    refetch,
    acknowledgeOrder,
  };
}

export function useOrder(orderId: string | null) {
  const queryClient = useQueryClient();

  const { data: order, isLoading: loading, error, refetch } = useQuery<Order, Error>({
    queryKey: ["order", orderId],
    queryFn: () => ordersApi.getOrder(orderId!),
    enabled: !!orderId,
  });

  const acknowledgeMutation = useMutation({
    mutationFn: () => ordersApi.acknowledgeOrder(orderId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["order", orderId] });
    },
  });

  const acknowledge = async () => {
    if (orderId) {
      await acknowledgeMutation.mutateAsync();
    }
  };

  return {
    order: order ?? null,
    loading,
    error: error?.message ?? null,
    refetch,
    acknowledge,
  };
}
