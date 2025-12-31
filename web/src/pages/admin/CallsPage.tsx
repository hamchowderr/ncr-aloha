import { useState, useMemo } from "react";
import { useCalls } from "@/hooks/useCalls";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "react-router-dom";
import { CallDetailDialog } from "@/components/admin/CallDetailDialog";
import { CallsChart } from "@/components/admin/CallsChart";
import { Bar, BarChart, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { CallMetrics } from "@/lib/api";

const volumeChartConfig = {
  successful: {
    label: "Successful",
    color: "oklch(0.6 0.2 145)",
  },
  failed: {
    label: "No Order",
    color: "oklch(0.65 0.2 25)",
  },
} satisfies ChartConfig;

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 60) {
    return `${diffMins} min ago`;
  } else if (diffHours < 24) {
    return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
  } else if (diffDays < 7) {
    return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
  } else {
    return date.toLocaleDateString();
  }
}

export function CallsPage() {
  const { calls, summary, loading, error } = useCalls(50);
  const [selectedCall, setSelectedCall] = useState<CallMetrics | null>(null);

  // Aggregate calls by day for volume chart
  const volumeChartData = useMemo(() => {
    if (!calls) return [];

    const days: Record<string, { successful: number; failed: number }> = {};
    const now = new Date();

    // Initialize last 7 days
    for (let i = 6; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const key = date.toLocaleDateString("en-US", { weekday: "short" });
      days[key] = { successful: 0, failed: 0 };
    }

    // Count calls by day
    calls.forEach((call) => {
      const date = new Date(call.startTime);
      const key = date.toLocaleDateString("en-US", { weekday: "short" });
      if (key in days) {
        if (call.orderSubmitted) {
          days[key].successful++;
        } else {
          days[key].failed++;
        }
      }
    });

    return Object.entries(days).map(([day, counts]) => ({
      day,
      ...counts,
    }));
  }, [calls]);

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-destructive/10 text-destructive p-4 rounded-lg">
          Error loading calls: {error}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Voice Calls</h1>
        <p className="text-muted-foreground">
          Voice call history and performance metrics
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Calls
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold">{summary?.totalCalls ?? 0}</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Successful Orders
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold text-green-600">
                {summary?.successfulOrders ?? 0}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Conversion Rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold">{summary?.conversionRate ?? "0%"}</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Avg Duration
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold">
                {formatDuration(parseFloat(summary?.avgDurationSeconds ?? "0"))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Avg Turns
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold">
                {parseFloat(summary?.avgTurns ?? "0").toFixed(1)}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Call Volume</CardTitle>
            <CardDescription>Calls by day with success breakdown</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="h-[200px] flex items-center justify-center text-muted-foreground">
                Loading...
              </div>
            ) : (
              <ChartContainer config={volumeChartConfig} className="h-[200px] w-full">
                <BarChart data={volumeChartData} accessibilityLayer>
                  <XAxis
                    dataKey="day"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    allowDecimals={false}
                  />
                  <ChartTooltip
                    cursor={false}
                    content={<ChartTooltipContent />}
                  />
                  <Bar
                    dataKey="successful"
                    stackId="a"
                    fill="var(--color-successful)"
                    radius={[0, 0, 0, 0]}
                  />
                  <Bar
                    dataKey="failed"
                    stackId="a"
                    fill="var(--color-failed)"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>

        <CallsChart calls={calls} loading={loading} />
      </div>

      {/* Calls Table */}
      <Card>
        <CardHeader>
          <CardTitle>Call History</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : !calls || calls.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No voice calls yet
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Session</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Turns</TableHead>
                  <TableHead>Interruptions</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead>Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {calls.map((call) => (
                  <TableRow
                    key={call.sessionId}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => setSelectedCall(call)}
                  >
                    <TableCell className="font-mono text-sm">
                      {call.sessionId}
                    </TableCell>
                    <TableCell>
                      {call.customerName || (
                        <span className="text-muted-foreground">Unknown</span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {call.customerPhone || "-"}
                    </TableCell>
                    <TableCell>{formatDuration(call.durationSeconds)}</TableCell>
                    <TableCell>{call.turnCount}</TableCell>
                    <TableCell>
                      {call.interruptions > 0 ? (
                        <span className="text-orange-600">{call.interruptions}</span>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {call.orderSubmitted ? (
                        <div className="flex items-center gap-2">
                          <Badge variant="default" className="bg-green-600">
                            Order Placed
                          </Badge>
                          {call.orderId && (
                            <Link
                              to={`/admin/orders/${call.orderId}`}
                              className="text-xs text-blue-600 hover:underline"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {call.orderId}
                            </Link>
                          )}
                        </div>
                      ) : (
                        <div>
                          <Badge variant="secondary">No Order</Badge>
                          {call.errors.length > 0 && (
                            <p className="text-xs text-muted-foreground mt-1 max-w-[200px] truncate">
                              {call.errors[0]}
                            </p>
                          )}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {formatDate(call.startTime)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Call Detail Dialog */}
      <CallDetailDialog
        open={!!selectedCall}
        onClose={() => setSelectedCall(null)}
        call={selectedCall}
      />
    </div>
  );
}
