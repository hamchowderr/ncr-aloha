import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Link } from "react-router-dom";
import type { CallMetrics } from "@/lib/api";

interface CallDetailDialogProps {
  open: boolean;
  onClose: () => void;
  call: CallMetrics | null;
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function formatDateTime(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleString();
}

export function CallDetailDialog({ open, onClose, call }: CallDetailDialogProps) {
  if (!call) return null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <span>Call Details</span>
            <span className="font-mono text-sm text-muted-foreground">
              {call.sessionId}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 flex-1 overflow-hidden flex flex-col">
          {/* Call Info */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Customer:</span>{" "}
              <span className="font-medium">
                {call.customerName || "Unknown"}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Phone:</span>{" "}
              <span className="font-mono">{call.customerPhone || "-"}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Started:</span>{" "}
              <span>{formatDateTime(call.startTime)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Duration:</span>{" "}
              <span className="font-medium">
                {formatDuration(call.durationSeconds)}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Turns:</span>{" "}
              <span>{call.turnCount}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Interruptions:</span>{" "}
              <span className={call.interruptions > 3 ? "text-orange-600" : ""}>
                {call.interruptions}
              </span>
            </div>
          </div>

          {/* Result */}
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">Result:</span>
            {call.orderSubmitted ? (
              <div className="flex items-center gap-2">
                <Badge variant="default" className="bg-green-600">
                  Order Placed
                </Badge>
                {call.orderId && (
                  <Link
                    to={`/admin/orders/${call.orderId}`}
                    className="text-sm text-blue-600 hover:underline"
                    onClick={onClose}
                  >
                    View Order {call.orderId}
                  </Link>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                <Badge variant="secondary">No Order</Badge>
                {call.errors.length > 0 && (
                  <p className="text-sm text-muted-foreground">
                    {call.errors.join(", ")}
                  </p>
                )}
              </div>
            )}
          </div>

          <Separator />

          {/* Transcript */}
          <div className="flex-1 min-h-0">
            <h3 className="font-medium mb-2">Conversation Transcript</h3>
            {call.transcript && call.transcript.length > 0 ? (
              <div className="h-[350px] overflow-y-auto pr-2">
                <div className="space-y-3 pb-4">
                  {call.transcript.map((entry, index) => (
                    <div
                      key={index}
                      className={`flex gap-3 ${
                        entry.role === "user" ? "justify-end" : "justify-start"
                      }`}
                    >
                      <div
                        className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                          entry.role === "user"
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted"
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-xs opacity-75">
                            {entry.role === "user" ? "Customer" : "AI Assistant"}
                          </span>
                          <span className="text-xs opacity-50 font-mono">
                            {entry.timestamp}
                          </span>
                        </div>
                        <p>{entry.content}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="h-[100px] flex items-center justify-center text-muted-foreground">
                No transcript available for this call
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
