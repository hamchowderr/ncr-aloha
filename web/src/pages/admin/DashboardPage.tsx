import { Link } from "react-router-dom";
import {
  UtensilsCrossed,
  Building2,
  ShoppingBag,
  Phone,
  TrendingUp,
  DollarSign,
  Clock,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { useSites } from "@/hooks/useSites";
import { useOrders } from "@/hooks/useOrders";
import { useCalls } from "@/hooks/useCalls";
import { useAdminMenu } from "@/hooks/useAdminMenu";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { OrdersChart } from "@/components/admin/OrdersChart";
import { CallsChart } from "@/components/admin/CallsChart";

export function DashboardPage() {
  const { sites } = useSites();
  const { orders, loading: ordersLoading } = useOrders();
  const { summary: callSummary, calls, loading: callsLoading } = useCalls();
  const { items: menuItems, loading: menuLoading } = useAdminMenu();

  // Calculate stats
  const totalOrders = orders?.length ?? 0;
  const pendingOrders = orders?.filter(
    (o) => o.status === "OrderPlaced" || o.status === "OrderReceived"
  ).length ?? 0;
  const totalRevenue = orders?.reduce((sum, o) => {
    const total = o.totals?.find((t) => t.type === "Net");
    return sum + (total?.value ?? 0);
  }, 0) ?? 0;

  // Calculate average order value
  const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

  return (
    <div className="p-6 space-y-6">
      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Revenue
            </CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {ordersLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <>
                <div className="text-2xl font-bold">${totalRevenue.toFixed(2)}</div>
                <p className="text-xs text-muted-foreground">
                  From {totalOrders} orders
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Orders
            </CardTitle>
            <ShoppingBag className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {ordersLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <>
                <div className="text-2xl font-bold">{totalOrders}</div>
                {pendingOrders > 0 ? (
                  <p className="text-xs text-orange-500">
                    {pendingOrders} pending
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Avg ${avgOrderValue.toFixed(2)}/order
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Voice Calls
            </CardTitle>
            <Phone className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {callsLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <>
                <div className="text-2xl font-bold">
                  {callSummary?.totalCalls ?? 0}
                </div>
                {callSummary && (
                  <div className="flex items-center gap-1 text-xs">
                    <TrendingUp className="h-3 w-3 text-green-500" />
                    <span className="text-green-500">{callSummary.conversionRate}</span>
                    <span className="text-muted-foreground">conversion</span>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Menu Items
            </CardTitle>
            <UtensilsCrossed className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {menuLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <>
                <div className="text-2xl font-bold">{menuItems?.length ?? 0}</div>
                <p className="text-xs text-muted-foreground">
                  {sites?.length ?? 0} active site{(sites?.length ?? 0) !== 1 ? "s" : ""}
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <OrdersChart orders={orders} loading={ordersLoading} />
        <CallsChart calls={calls} loading={callsLoading} />
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Link to="/admin/sites">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
            <CardHeader className="flex flex-row items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <Building2 className="h-5 w-5 text-primary" />
              </div>
              <div>
                <CardTitle className="text-base">Manage Sites</CardTitle>
                <CardDescription>View restaurant locations</CardDescription>
              </div>
            </CardHeader>
          </Card>
        </Link>

        <Link to="/admin/menu">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
            <CardHeader className="flex flex-row items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <UtensilsCrossed className="h-5 w-5 text-primary" />
              </div>
              <div>
                <CardTitle className="text-base">View Menu</CardTitle>
                <CardDescription>Browse {menuItems?.length ?? 0} items</CardDescription>
              </div>
            </CardHeader>
          </Card>
        </Link>

        <Link to="/admin/orders">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
            <CardHeader className="flex flex-row items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <ShoppingBag className="h-5 w-5 text-primary" />
              </div>
              <div>
                <CardTitle className="text-base">View Orders</CardTitle>
                <CardDescription>Track customer orders</CardDescription>
              </div>
            </CardHeader>
          </Card>
        </Link>
      </div>

      {/* Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Orders */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Recent Orders</CardTitle>
              <CardDescription>Latest 5 orders</CardDescription>
            </div>
            <Link to="/admin/orders" className="text-sm text-primary hover:underline">
              View all
            </Link>
          </CardHeader>
          <CardContent>
            {ordersLoading ? (
              <div className="space-y-2">
                {[...Array(3)].map((_, i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            ) : orders && orders.length > 0 ? (
              <div className="space-y-2">
                {orders.slice(0, 5).map((order) => (
                  <Link
                    key={order.id}
                    to={`/admin/orders/${order.id}`}
                    className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10">
                        <ShoppingBag className="h-4 w-4 text-primary" />
                      </div>
                      <div>
                        <div className="font-medium">{order.customer.name}</div>
                        <div className="text-sm text-muted-foreground">
                          {order.orderLines.length} item(s)
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-medium">
                        ${order.totals?.find((t) => t.type === "Net")?.value.toFixed(2) ?? "0.00"}
                      </div>
                      <Badge variant="outline" className="text-xs">
                        {order.status}
                      </Badge>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <ShoppingBag className="h-10 w-10 text-muted-foreground mb-2" />
                <p className="text-muted-foreground">
                  No orders yet
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Calls */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Recent Voice Calls</CardTitle>
              <CardDescription>Latest 5 calls</CardDescription>
            </div>
            <Link to="/admin/calls" className="text-sm text-primary hover:underline">
              View all
            </Link>
          </CardHeader>
          <CardContent>
            {callsLoading ? (
              <div className="space-y-2">
                {[...Array(3)].map((_, i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            ) : calls && calls.length > 0 ? (
              <div className="space-y-2">
                {calls.slice(0, 5).map((call) => (
                  <div
                    key={call.sessionId}
                    className="flex items-center justify-between p-3 rounded-lg border"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`flex h-9 w-9 items-center justify-center rounded-full ${
                        call.orderSubmitted ? "bg-green-500/10" : "bg-muted"
                      }`}>
                        <Phone className={`h-4 w-4 ${
                          call.orderSubmitted ? "text-green-500" : "text-muted-foreground"
                        }`} />
                      </div>
                      <div>
                        <div className="font-medium">
                          {call.customerName || "Unknown Caller"}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {call.customerPhone || call.sessionId.slice(0, 8)}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="flex items-center gap-1 text-sm text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {Math.floor(call.durationSeconds / 60)}:{String(Math.floor(call.durationSeconds % 60)).padStart(2, "0")}
                      </div>
                      <Badge
                        variant={call.orderSubmitted ? "default" : "secondary"}
                        className={`text-xs ${call.orderSubmitted ? "bg-green-600" : ""}`}
                      >
                        {call.orderSubmitted ? "Ordered" : "No Order"}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <Phone className="h-10 w-10 text-muted-foreground mb-2" />
                <p className="text-muted-foreground">
                  No voice calls yet
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default DashboardPage;
