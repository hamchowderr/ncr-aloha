import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type CallState = "idle" | "connecting" | "connected" | "error";

export function VoiceChat() {
  const [callState, setCallState] = useState<CallState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const callFrameRef = useRef<unknown>(null);
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Get the pipecat API URL for voice sessions
  const pipecatUrl = import.meta.env.DEV
    ? "http://localhost:8765"
    : "https://ncr-aloha.tylanmiller.tech";

  // Cleanup function
  const cleanup = useCallback(() => {
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }
    if (callFrameRef.current) {
      try {
        const frame = callFrameRef.current as { leave: () => void; destroy: () => void };
        frame.leave();
        frame.destroy();
      } catch (e) {
        console.error("Error cleaning up call frame:", e);
      }
      callFrameRef.current = null;
    }
    setDuration(0);
  }, []);

  // Start a voice session
  const startCall = async () => {
    setCallState("connecting");
    setError(null);
    setIsDialogOpen(true);

    try {
      // Create a Daily.co session via the pipecat server
      const response = await fetch(`${pipecatUrl}/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) {
        throw new Error("Failed to create voice session");
      }

      const data = await response.json();

      if (data.error) {
        throw new Error(data.error);
      }

      setSessionId(data.session_id);
      setRoomUrl(data.room_url);

      // Load Daily.co SDK dynamically
      const DailyIframe = await import("@daily-co/daily-js").then(
        (m) => m.default
      );

      // Create the call frame
      const callFrame = DailyIframe.createFrame({
        iframeStyle: {
          position: "fixed",
          top: "0",
          left: "0",
          width: "100%",
          height: "100%",
          border: "0",
          zIndex: "9999",
        },
        showLeaveButton: true,
        showFullscreenButton: false,
      });

      callFrameRef.current = callFrame;

      // Set up event handlers
      callFrame.on("joined-meeting", () => {
        setCallState("connected");
        // Start duration timer
        durationIntervalRef.current = setInterval(() => {
          setDuration((d) => d + 1);
        }, 1000);
      });

      callFrame.on("left-meeting", () => {
        setCallState("idle");
        cleanup();
        setIsDialogOpen(false);
      });

      callFrame.on("error", (e: any) => {
        console.error("Daily.co error:", e);
        setError(e.errorMsg || "Connection error");
        setCallState("error");
      });

      // Join the room
      await callFrame.join({
        url: data.room_url,
        startAudioOff: false,
        startVideoOff: true,
      });
    } catch (e) {
      console.error("Error starting call:", e);
      setError(e instanceof Error ? e.message : "Failed to start call");
      setCallState("error");
    }
  };

  // End the call
  const endCall = useCallback(async () => {
    cleanup();

    // Notify the server to end the session
    if (sessionId) {
      try {
        await fetch(`${pipecatUrl}/sessions/${sessionId}`, {
          method: "DELETE",
        });
      } catch (e) {
        console.error("Error ending session:", e);
      }
    }

    setCallState("idle");
    setSessionId(null);
    setRoomUrl(null);
    setIsDialogOpen(false);
  }, [sessionId, pipecatUrl, cleanup]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  // Format duration as MM:SS
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <>
      {/* Floating Call Button */}
      <div className="fixed bottom-6 right-6 z-50">
        {callState === "idle" ? (
          <Button
            onClick={startCall}
            size="lg"
            className="rounded-full w-16 h-16 shadow-lg bg-green-600 hover:bg-green-700"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
            </svg>
          </Button>
        ) : callState === "connecting" ? (
          <Button
            disabled
            size="lg"
            className="rounded-full w-16 h-16 shadow-lg bg-yellow-600"
          >
            <svg
              className="animate-spin"
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
              <path d="M12 2a10 10 0 0 1 10 10" strokeOpacity="1" />
            </svg>
          </Button>
        ) : (
          <Button
            onClick={endCall}
            size="lg"
            className="rounded-full w-16 h-16 shadow-lg bg-red-600 hover:bg-red-700"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67m-2.67-3.34a19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91" />
              <line x1="23" y1="1" x2="1" y2="23" />
            </svg>
          </Button>
        )}
      </div>

      {/* Call Status Card (when connected) */}
      {callState === "connected" && (
        <div className="fixed bottom-24 right-6 z-50">
          <Card className="w-48 shadow-lg">
            <CardContent className="p-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-green-600 flex items-center gap-1">
                    <span className="w-2 h-2 bg-green-600 rounded-full animate-pulse"></span>
                    Connected
                  </div>
                  <div className="text-lg font-mono">{formatDuration(duration)}</div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={endCall}
                  className="text-red-600 hover:text-red-700 hover:bg-red-50"
                >
                  End
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Error Dialog */}
      <Dialog open={callState === "error"} onOpenChange={() => setCallState("idle")}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Connection Error</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-destructive">{error}</p>
            <p className="text-sm text-muted-foreground mt-2">
              Please try again or call our phone number instead.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setCallState("idle")}>
              Close
            </Button>
            <Button onClick={startCall}>Retry</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
