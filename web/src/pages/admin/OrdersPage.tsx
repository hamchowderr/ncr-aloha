import { useState } from "react";
import { Link } from "react-router-dom";
import { useOrders } from "@/hooks/useOrders";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { OrderStatus } from "@/lib/api";

const statusOptions: Array<{ value: OrderStatus | "all"; label: string }> = [
  { value: "all", label: "All Statuses" },
  { value: "OrderPlaced", label: "Order Placed" },
  { value: "OrderReceived", label: "Received" },
  { value: "InProgress", label: "In Progress" },
  { value: "ReadyForPickup", label: "Ready for Pickup" },
  { value: "OutForDelivery", label: "Out for Delivery" },
  { value: "Completed", label: "Completed" },
  { value: "Cancelled", label: "Cancelled" },
];

function getStatusVariant(status: string) {
  switch (status) {
    case "OrderPlaced":
    case "OrderReceived":
      return "default";
    case "InProgress":
      return "secondary";
    case "ReadyForPickup":
    case "OutForDelivery":
      return "outline";
    case "Completed":
      return "default";
    case "Cancelled":
      return "destructive";
    default:
      return "secondary";
  }
}

export function OrdersPage() {
  const [statusFilter, setStatusFilter] = useState<OrderStatus | "all">("all");
  const { orders, loading, error, refetch, acknowledgeOrder } = useOrders({
    status: statusFilter === "all" ? undefined : statusFilter,
    limit: 50,
  });

  const handleAcknowledge = async (orderId: string) => {
    try {
      await acknowledgeOrder(orderId);
    } catch (err) {
      console.error("Failed to acknowledge order:", err);
    }
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Orders</h1>
        <Button onClick={() => refetch()} variant="outline">
          <svg
            className="w-4 h-4 mr-2"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"
            />
          </svg>
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Order History</CardTitle>
            <Select
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v as OrderStatus | "all")}
            >
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                {statusOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {[...Array(10)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : error ? (
            <div className="text-center py-8">
              <p className="text-destructive mb-2">Failed to load orders</p>
              <p className="text-sm text-muted-foreground">{error}</p>
            </div>
          ) : orders && orders.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order ID</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell className="font-mono text-sm">
                      <Link
                        to={`/admin/orders/${order.id}`}
                        className="hover:underline text-primary"
                      >
                        {order.id.slice(0, 8)}...
                      </Link>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{order.customer.name}</div>
                      <div className="text-sm text-muted-foreground">
                        {order.customer.phone}
                      </div>
                    </TableCell>
                    <TableCell>
                      {order.orderLines.length} item(s)
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      ${order.totals?.find((t) => t.type === "Net")?.value.toFixed(2) ?? "0.00"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={getStatusVariant(order.status)}>
                        {order.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {order.fulfillment?.type || "-"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        {!order.acknowledged && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleAcknowledge(order.id)}
                          >
                            Acknowledge
                          </Button>
                        )}
                        <Link to={`/admin/orders/${order.id}`}>
                          <Button size="sm" variant="ghost">
                            View
                          </Button>
                        </Link>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-8">
              <p className="text-muted-foreground mb-2">No orders found</p>
              <p className="text-sm text-muted-foreground">
                {statusFilter !== "all"
                  ? "Try a different status filter"
                  : "Orders will appear here when customers place them"}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default OrdersPage;
