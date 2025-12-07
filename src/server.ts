import express from "express";
import cors from "cors";
import { OrderService } from "./services/order-service.js";
import { MenuMatcher } from "./services/menu-matcher.js";
import { allstarMenu } from "./data/allstar-menu.js";
import type { VoiceOrder } from "./models/menu.js";

const app = express();
app.use(cors());
app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
  });
  next();
});

const orderService = new OrderService(allstarMenu);
const menuMatcher = new MenuMatcher(allstarMenu);

// ============================================================================
// Call Metrics Storage (in-memory for demo, use database in production)
// ============================================================================

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

const callHistory: CallMetrics[] = [];
const MAX_CALL_HISTORY = 100; // Keep last 100 calls

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", restaurant: allstarMenu.restaurantName });
});

// Get menu
app.get("/menu", (req, res) => {
  res.json({
    restaurant: allstarMenu.restaurantName,
    categories: allstarMenu.categories,
    items: allstarMenu.items.map((item) => ({
      id: item.id,
      name: item.name,
      category: item.category,
      basePrice: item.basePrice,
      sizes: item.sizes,
      available: item.available,
    })),
    modifierGroups: allstarMenu.modifierGroups,
  });
});

// Get items by category
app.get("/menu/:category", (req, res) => {
  const items = menuMatcher.getItemsByCategory(req.params.category);
  res.json({ category: req.params.category, items });
});

// Validate order (without submitting)
app.post("/orders/validate", (req, res) => {
  const voiceOrder = req.body as VoiceOrder;

  if (!voiceOrder.items || !voiceOrder.customer) {
    res.status(400).json({ error: "Missing required fields: items, customer" });
    return;
  }

  const result = orderService.validateOrder(voiceOrder);
  res.json(result);
});

// Submit order to NCR
app.post("/orders", async (req, res) => {
  const voiceOrder = req.body as VoiceOrder;

  console.log("\n📦 ORDER RECEIVED:");
  console.log(JSON.stringify(voiceOrder, null, 2));

  if (!voiceOrder.items || !voiceOrder.customer) {
    res.status(400).json({ error: "Missing required fields: items, customer" });
    return;
  }

  const result = await orderService.submitOrder(voiceOrder);

  if (result.success) {
    console.log(`✅ Order submitted successfully: ${result.orderId}`);
  } else {
    console.log(`❌ Order failed:`, result.errors);
  }

  if (result.success) {
    res.status(201).json({
      success: true,
      orderId: result.orderId,
      status: result.order?.status,
      warnings: result.warnings,
    });
  } else {
    res.status(400).json({
      success: false,
      errors: result.errors,
      warnings: result.warnings,
    });
  }
});

// Get order status
app.get("/orders/:orderId", async (req, res) => {
  const result = await orderService.getOrderStatus(req.params.orderId);

  if (result.found) {
    res.json({
      orderId: req.params.orderId,
      status: result.status,
      order: result.order,
    });
  } else {
    res.status(404).json({ error: result.error || "Order not found" });
  }
});

// ============================================================================
// Call Metrics Endpoints
// ============================================================================

// Submit call metrics (called by Pipecat bot when call ends)
app.post("/calls", (req, res) => {
  const metrics: CallMetrics = {
    sessionId: req.body.sessionId || req.body.session_id,
    startTime: req.body.startTime || req.body.start_time,
    endTime: req.body.endTime || req.body.end_time,
    durationSeconds: req.body.durationSeconds || req.body.duration_seconds || 0,
    turnCount: req.body.turnCount || req.body.turn_count || 0,
    interruptions: req.body.interruptions || 0,
    orderSubmitted: req.body.orderSubmitted || req.body.order_submitted || false,
    orderId: req.body.orderId || req.body.order_id,
    errors: req.body.errors || [],
    roomUrl: req.body.roomUrl || req.body.room_url,
    customerName: req.body.customerName || req.body.customer_name,
    customerPhone: req.body.customerPhone || req.body.customer_phone,
    transcript: req.body.transcript || [],
  };

  // Add to history (at beginning for most recent first)
  callHistory.unshift(metrics);

  // Trim to max size
  if (callHistory.length > MAX_CALL_HISTORY) {
    callHistory.pop();
  }

  console.log(`\n📞 CALL ENDED: ${metrics.sessionId}`);
  console.log(`   Duration: ${metrics.durationSeconds.toFixed(1)}s | Turns: ${metrics.turnCount} | Order: ${metrics.orderSubmitted ? "Yes" : "No"}`);

  res.status(201).json({ success: true, sessionId: metrics.sessionId });
});

// Get all call metrics
app.get("/calls", (req, res) => {
  const limit = parseInt(req.query.limit as string) || 20;
  const calls = callHistory.slice(0, limit);

  // Calculate summary stats
  const totalCalls = callHistory.length;
  const successfulOrders = callHistory.filter(c => c.orderSubmitted).length;
  const avgDuration = callHistory.length > 0
    ? callHistory.reduce((sum, c) => sum + c.durationSeconds, 0) / callHistory.length
    : 0;
  const avgTurns = callHistory.length > 0
    ? callHistory.reduce((sum, c) => sum + c.turnCount, 0) / callHistory.length
    : 0;

  res.json({
    summary: {
      totalCalls,
      successfulOrders,
      conversionRate: totalCalls > 0 ? ((successfulOrders / totalCalls) * 100).toFixed(1) + "%" : "0%",
      avgDurationSeconds: avgDuration.toFixed(1),
      avgTurns: avgTurns.toFixed(1),
    },
    calls,
  });
});

// Get single call by session ID
app.get("/calls/:sessionId", (req, res) => {
  const call = callHistory.find(c => c.sessionId === req.params.sessionId);

  if (call) {
    res.json(call);
  } else {
    res.status(404).json({ error: "Call not found" });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`
🍗 NCR Aloha Voice Ordering API

Server running at http://localhost:${PORT}

Web UI:    http://localhost:5173 (run: cd web && npm run dev)

Endpoints:
  GET  /health           - Health check
  GET  /menu             - Get full menu
  GET  /menu/:category   - Get items by category
  POST /orders/validate  - Validate order without submitting
  POST /orders           - Submit order to NCR
  GET  /orders/:orderId  - Get order status

Call Metrics:
  POST /calls            - Submit call metrics (from Pipecat bot)
  GET  /calls            - Get call history with summary stats
  GET  /calls/:sessionId - Get single call details

Example order POST body:
{
  "orderType": "pickup",
  "items": [
    { "itemName": "wings", "quantity": 1, "size": "2 pounds", "modifiers": ["honey garlic"] }
  ],
  "customer": { "name": "John", "phone": "416-555-1234" }
}
`);
});
