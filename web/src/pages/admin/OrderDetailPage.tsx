import { useParams, Link } from "react-router-dom";
import { useOrder } from "@/hooks/useOrders";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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

export function OrderDetailPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const { order, loading, error, acknowledge } = useOrder(orderId || null);

  const handleAcknowledge = async () => {
    try {
      await acknowledge();
    } catch (err) {
      console.error("Failed to acknowledge order:", err);
    }
  };

  if (loading) {
    return (
      <div className="p-6">
        <Skeleton className="h-8 w-48 mb-6" />
        <div className="grid gap-6">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="p-6">
        <div className="text-center py-8">
          <p className="text-destructive mb-2">Failed to load order</p>
          <p className="text-sm text-muted-foreground">{error || "Order not found"}</p>
          <Link to="/admin/orders">
            <Button className="mt-4" variant="outline">
              Back to Orders
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const subtotal = order.totals?.find((t) => t.type === "TaxExcluded")?.value ?? 0;
  const total = order.totals?.find((t) => t.type === "Net")?.value ?? 0;

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Link to="/admin/orders">
            <Button variant="ghost" size="icon">
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"
                />
              </svg>
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">Order Details</h1>
            <p className="text-sm text-muted-foreground font-mono">{order.id}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={getStatusVariant(order.status)} className="text-sm">
            {order.status}
          </Badge>
          {!order.acknowledged && (
            <Button onClick={handleAcknowledge}>Acknowledge Order</Button>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Order Info */}
        <div className="lg:col-span-2 space-y-6">
          {/* Customer Info */}
          <Card>
            <CardHeader>
              <CardTitle>Customer Information</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-sm text-muted-foreground">Name</div>
                  <div className="font-medium">{order.customer.name}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Phone</div>
                  <div className="font-medium">{order.customer.phone}</div>
                </div>
                {order.customer.email && (
                  <div>
                    <div className="text-sm text-muted-foreground">Email</div>
                    <div className="font-medium">{order.customer.email}</div>
                  </div>
                )}
                <div>
                  <div className="text-sm text-muted-foreground">Order Type</div>
                  <div className="font-medium">{order.fulfillment?.type || "N/A"}</div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Order Items */}
          <Card>
            <CardHeader>
              <CardTitle>Order Items</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead className="text-center">Qty</TableHead>
                    <TableHead className="text-right">Unit Price</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {order.orderLines.map((line, i) => (
                    <TableRow key={i}>
                      <TableCell>
                        <div className="font-medium">
                          {line.description || line.productId.value}
                        </div>
                        {line.notes && line.notes.length > 0 && (
                          <div className="text-sm text-muted-foreground">
                            {line.notes.map((n) => n.value).join(", ")}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {line.quantity.value}
                      </TableCell>
                      <TableCell className="text-right">
                        ${line.unitPrice.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        ${line.extendedAmount.toFixed(2)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        {/* Order Summary */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Order Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span>${subtotal.toFixed(2)}</span>
              </div>
              {order.taxes?.map((t, i) => (
                <div key={i} className="flex justify-between">
                  <span className="text-muted-foreground">
                    {t.code} ({t.percentage}%)
                  </span>
                  <span>${t.amount.toFixed(2)}</span>
                </div>
              ))}
              <Separator />
              <div className="flex justify-between text-lg font-bold">
                <span>Total</span>
                <span>${total.toFixed(2)}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Order Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <div className="text-sm text-muted-foreground">Channel</div>
                <div className="font-medium">{order.channel || "N/A"}</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Currency</div>
                <div className="font-medium">{order.currency || "CAD"}</div>
              </div>
              {order.createdAt && (
                <div>
                  <div className="text-sm text-muted-foreground">Created</div>
                  <div className="font-medium">
                    {new Date(order.createdAt).toLocaleString()}
                  </div>
                </div>
              )}
              {order.comments && (
                <div>
                  <div className="text-sm text-muted-foreground">Comments</div>
                  <div className="font-medium">{order.comments}</div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default OrderDetailPage;
