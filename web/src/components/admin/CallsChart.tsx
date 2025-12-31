import { useMemo } from "react";
import { Pie, PieChart, Cell, Label } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { CallMetrics } from "@/lib/api";

interface CallsChartProps {
  calls: CallMetrics[] | null;
  loading?: boolean;
}

const chartConfig = {
  successful: {
    label: "Successful",
    color: "oklch(0.6 0.2 145)",
  },
  failed: {
    label: "No Order",
    color: "oklch(0.65 0.2 25)",
  },
} satisfies ChartConfig;

export function CallsChart({ calls, loading }: CallsChartProps) {
  const chartData = useMemo(() => {
    if (!calls) return [];

    const successful = calls.filter((c) => c.orderSubmitted).length;
    const failed = calls.length - successful;

    return [
      { name: "successful", value: successful, fill: "var(--color-successful)" },
      { name: "failed", value: failed, fill: "var(--color-failed)" },
    ];
  }, [calls]);

  const totalCalls = calls?.length ?? 0;
  const successRate = totalCalls > 0
    ? Math.round((chartData[0]?.value ?? 0) / totalCalls * 100)
    : 0;

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Call Success Rate</CardTitle>
          <CardDescription>Orders completed vs. no order</CardDescription>
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
        <CardTitle>Call Success Rate</CardTitle>
        <CardDescription>Orders completed vs. no order</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="h-[200px] w-full">
          <PieChart>
            <ChartTooltip
              cursor={false}
              content={<ChartTooltipContent hideLabel />}
            />
            <Pie
              data={chartData}
              dataKey="value"
              nameKey="name"
              innerRadius={60}
              outerRadius={80}
              strokeWidth={2}
            >
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.fill} />
              ))}
              <Label
                content={({ viewBox }) => {
                  if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                    return (
                      <text
                        x={viewBox.cx}
                        y={viewBox.cy}
                        textAnchor="middle"
                        dominantBaseline="middle"
                      >
                        <tspan
                          x={viewBox.cx}
                          y={viewBox.cy}
                          className="fill-foreground text-3xl font-bold"
                        >
                          {successRate}%
                        </tspan>
                        <tspan
                          x={viewBox.cx}
                          y={(viewBox.cy || 0) + 24}
                          className="fill-muted-foreground text-sm"
                        >
                          Success
                        </tspan>
                      </text>
                    );
                  }
                }}
              />
            </Pie>
          </PieChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
