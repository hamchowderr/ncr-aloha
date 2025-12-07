import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

interface TranscriptEntry {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

interface CallMetrics {
  sessionId: string;
  startTime: string;
  endTime: string;
  durationSeconds: number;
  turnCount: number;
  interruptions: number;
  orderSubmitted: boolean;
  orderId?: string;
  errors: string[];
  roomUrl?: string;
  customerName?: string;
  customerPhone?: string;
  transcript?: TranscriptEntry[];
}

interface CallsResponse {
  summary: {
    totalCalls: number;
    successfulOrders: number;
    conversionRate: string;
    avgDurationSeconds: string;
    avgTurns: string;
  };
  calls: CallMetrics[];
}

export function CallsPage() {
  const [data, setData] = useState<CallsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCall, setSelectedCall] = useState<CallMetrics | null>(null);

  const fetchCalls = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/calls?limit=50");
      if (!response.ok) throw new Error("Failed to fetch calls");
      const result = await response.json();
      setData(result);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCalls();
    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchCalls, 30000);
    return () => clearInterval(interval);
  }, []);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  };

  const formatTime = (isoString: string) => {
    return new Date(isoString).toLocaleString();
  };

  if (loading && !data) {
    return (
      <div className="p-6">
        <div className="text-center text-muted-foreground">Loading calls...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="text-center text-destructive">Error: {error}</div>
        <div className="text-center mt-4">
          <Button onClick={fetchCalls}>Retry</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">Voice Call Analytics</h2>
        <Button onClick={fetchCalls} variant="outline" size="sm">
          Refresh
        </Button>
      </div>

      {/* Summary Cards */}
      {data?.summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total Calls
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{data.summary.totalCalls}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Successful Orders
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">
                {data.summary.successfulOrders}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Conversion Rate
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{data.summary.conversionRate}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Avg Duration
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {formatDuration(parseFloat(data.summary.avgDurationSeconds))}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Avg Turns
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{data.summary.avgTurns}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Calls Table */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Calls</CardTitle>
        </CardHeader>
        <CardContent>
          {!data?.calls?.length ? (
            <div className="text-center text-muted-foreground py-8">
              No calls recorded yet. Voice calls will appear here when customers use the voice ordering system.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-2 font-medium">Time</th>
                    <th className="text-left p-2 font-medium">Customer</th>
                    <th className="text-left p-2 font-medium">Duration</th>
                    <th className="text-left p-2 font-medium">Turns</th>
                    <th className="text-left p-2 font-medium">Status</th>
                    <th className="text-left p-2 font-medium">Order ID</th>
                    <th className="text-left p-2 font-medium">Transcript</th>
                  </tr>
                </thead>
                <tbody>
                  {data.calls.map((call) => (
                    <tr
                      key={call.sessionId}
                      className="border-b hover:bg-muted/50 cursor-pointer"
                      onClick={() => setSelectedCall(call)}
                    >
                      <td className="p-2 text-sm">
                        {formatTime(call.startTime)}
                      </td>
                      <td className="p-2">
                        <div className="text-sm font-medium">
                          {call.customerName || "Unknown"}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {call.customerPhone || "-"}
                        </div>
                      </td>
                      <td className="p-2 text-sm">
                        {formatDuration(call.durationSeconds)}
                      </td>
                      <td className="p-2 text-sm">
                        {call.turnCount}
                        {call.interruptions > 0 && (
                          <span className="text-muted-foreground ml-1">
                            ({call.interruptions} int)
                          </span>
                        )}
                      </td>
                      <td className="p-2">
                        {call.orderSubmitted ? (
                          <Badge variant="default" className="bg-green-600">
                            Order Placed
                          </Badge>
                        ) : call.errors.length > 0 ? (
                          <Badge variant="destructive">Error</Badge>
                        ) : (
                          <Badge variant="secondary">No Order</Badge>
                        )}
                      </td>
                      <td className="p-2 text-sm font-mono">
                        {call.orderId ? call.orderId.slice(0, 8) : "-"}
                      </td>
                      <td className="p-2 text-sm">
                        {call.transcript && call.transcript.length > 0 ? (
                          <Badge variant="outline">{call.transcript.length} msgs</Badge>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Transcript Dialog */}
      <Dialog open={!!selectedCall} onOpenChange={() => setSelectedCall(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>
              Call Transcript - {selectedCall?.customerName || "Unknown Customer"}
            </DialogTitle>
          </DialogHeader>
          <div className="text-sm text-muted-foreground mb-4">
            {selectedCall && formatTime(selectedCall.startTime)} | {selectedCall && formatDuration(selectedCall.durationSeconds)} | {selectedCall?.turnCount} turns
          </div>
          <ScrollArea className="h-[50vh] pr-4">
            {selectedCall?.transcript && selectedCall.transcript.length > 0 ? (
              <div className="space-y-4">
                {selectedCall.transcript.map((entry, index) => (
                  <div
                    key={index}
                    className={`flex ${entry.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[80%] rounded-lg px-4 py-2 ${
                        entry.role === "user"
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted"
                      }`}
                    >
                      <div className="text-xs opacity-70 mb-1">
                        {entry.role === "user" ? "Customer" : "Assistant"}
                      </div>
                      <div className="text-sm">{entry.content}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center text-muted-foreground py-8">
                No transcript available for this call.
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
