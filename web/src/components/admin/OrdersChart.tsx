import { useMemo } from "react";
import { Bar, BarChart, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { Order } from "@/lib/api";

interface OrdersChartProps {
  orders: Order[] | null;
  loading?: boolean;
}

const chartConfig = {
  orders: {
    label: "Orders",
    color: "hsl(var(--chart-1))",
  },
} satisfies ChartConfig;

export function OrdersChart({ orders, loading }: OrdersChartProps) {
  const chartData = useMemo(() => {
    if (!orders) return [];

    // Get last 7 days
    const days: Record<string, number> = {};
    const now = new Date();

    for (let i = 6; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const key = date.toLocaleDateString("en-US", { weekday: "short" });
      days[key] = 0;
    }

    // Count orders by day
    orders.forEach((order) => {
      if (order.createdAt) {
        const date = new Date(order.createdAt);
        const key = date.toLocaleDateString("en-US", { weekday: "short" });
        if (key in days) {
          days[key]++;
        }
      }
    });

    return Object.entries(days).map(([day, count]) => ({
      day,
      orders: count,
    }));
  }, [orders]);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Orders This Week</CardTitle>
          <CardDescription>Daily order volume</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[200px] flex items-center justify-center text-muted-foreground">
            Loading...
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Orders This Week</CardTitle>
        <CardDescription>Daily order volume for the last 7 days</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="h-[200px] w-full">
          <BarChart data={chartData} accessibilityLayer>
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
              content={<ChartTooltipContent hideLabel />}
            />
            <Bar
              dataKey="orders"
              fill="var(--color-orders)"
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
