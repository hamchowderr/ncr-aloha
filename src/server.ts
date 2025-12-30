import express from "express";
import cors from "cors";
import { OrderService } from "./services/order-service.js";
import { MenuMatcher } from "./services/menu-matcher.js";
import { allstarMenu } from "./data/allstar-menu.js";
import type { VoiceOrder } from "./models/menu.js";
import adminRoutes, { orderStore } from "./routes/admin.js";
import { requireApiKey } from "./middleware/api-key.js";

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

// Mount admin routes (protected by API key)
app.use("/admin", requireApiKey, adminRoutes);

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

const MAX_CALL_HISTORY = 100; // Keep last 100 calls

// Pre-populated with mock data for demo purposes
const callHistory: CallMetrics[] = [
  {
    sessionId: "CALL-001",
    startTime: new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString(),
    endTime: new Date(Date.now() - 72 * 60 * 60 * 1000 + 245000).toISOString(),
    durationSeconds: 245,
    turnCount: 18,
    interruptions: 2,
    orderSubmitted: true,
    orderId: "ORD-001",
    errors: [],
    customerName: "John Smith",
    customerPhone: "416-555-1234",
    transcript: [
      { role: "assistant", content: "Hi, thanks for calling All Star Wings and Ribs! I'm here to help you place an order. What can I get started for you today?", timestamp: "00:00" },
      { role: "user", content: "Hey, can I get some wings?", timestamp: "00:08" },
      { role: "assistant", content: "Absolutely! We have our famous Original Wings. What size would you like? We have 1 pound, 2 pounds, 3 pounds, or our 5 pound party pack.", timestamp: "00:12" },
      { role: "user", content: "I'll take 2 pounds please", timestamp: "00:22" },
      { role: "assistant", content: "Great choice! 2 pounds of wings. Now for the flavor - we have Honey Garlic, BBQ, Hot, Medium, Mild, Teriyaki, Salt & Pepper, Lemon Pepper, and more. What flavor would you like?", timestamp: "00:26" },
      { role: "user", content: "Honey garlic sounds good", timestamp: "00:38" },
      { role: "assistant", content: "Perfect! 2 pounds of Honey Garlic wings. Would you like to add anything else to your order?", timestamp: "00:42" },
      { role: "user", content: "Yeah can I also get some fries?", timestamp: "00:50" },
      { role: "assistant", content: "Of course! Would you like regular fries, sweet potato fries, or loaded fries?", timestamp: "00:54" },
      { role: "user", content: "Just regular fries, make it two orders", timestamp: "01:02" },
      { role: "assistant", content: "Got it - two orders of regular fries. Anything else?", timestamp: "01:08" },
      { role: "user", content: "No that's everything", timestamp: "01:14" },
      { role: "assistant", content: "Alright! So I have 2 pounds of Honey Garlic wings and two regular fries. Your total comes to $42.97 plus tax. Is this for pickup or delivery?", timestamp: "01:18" },
      { role: "user", content: "Pickup please", timestamp: "01:32" },
      { role: "assistant", content: "Perfect. Can I get a name for the order?", timestamp: "01:36" },
      { role: "user", content: "John Smith", timestamp: "01:42" },
      { role: "assistant", content: "Thanks John! Your order will be ready in about 20-25 minutes. Is there anything else I can help you with?", timestamp: "01:46" },
      { role: "user", content: "Nope that's it, thanks!", timestamp: "01:56" },
      { role: "assistant", content: "Great! Your order has been placed. See you soon, John!", timestamp: "02:00" },
    ],
  },
  {
    sessionId: "CALL-002",
    startTime: new Date(Date.now() - 68 * 60 * 60 * 1000).toISOString(),
    endTime: new Date(Date.now() - 68 * 60 * 60 * 1000 + 312000).toISOString(),
    durationSeconds: 312,
    turnCount: 24,
    interruptions: 1,
    orderSubmitted: true,
    orderId: "ORD-002",
    errors: [],
    customerName: "Sarah Johnson",
    customerPhone: "647-555-5678",
    transcript: [
      { role: "assistant", content: "Hi, thanks for calling All Star Wings and Ribs! I'm here to help you place an order. What can I get started for you today?", timestamp: "00:00" },
      { role: "user", content: "Hi! I'd like to order some ribs please.", timestamp: "00:08" },
      { role: "assistant", content: "Great choice! We have pork ribs and beef ribs. Which would you prefer?", timestamp: "00:12" },
      { role: "user", content: "Pork ribs, full rack please", timestamp: "00:18" },
      { role: "assistant", content: "Perfect! A full rack of pork ribs. What sauce would you like? We have BBQ, Honey Garlic, Cajun, or Dry Rub.", timestamp: "00:22" },
      { role: "user", content: "BBQ sauce", timestamp: "00:32" },
      { role: "assistant", content: "Excellent! Full rack of pork ribs with BBQ sauce. Would you like any sides with that?", timestamp: "00:36" },
      { role: "user", content: "What sides do you have?", timestamp: "00:44" },
      { role: "assistant", content: "We have fries, sweet potato fries, coleslaw, garden salad, Caesar salad, onion rings, and corn on the cob.", timestamp: "00:48" },
      { role: "user", content: "I'll take coleslaw and fries", timestamp: "01:02" },
      { role: "assistant", content: "Got it - coleslaw and fries. Anything else?", timestamp: "01:08" },
      { role: "user", content: "No, that's all", timestamp: "01:16" },
      { role: "assistant", content: "Alright! So I have a full rack of BBQ pork ribs with coleslaw and fries. Your total is $34.99 plus tax. Is this for pickup or delivery?", timestamp: "01:20" },
      { role: "user", content: "Pickup", timestamp: "01:34" },
      { role: "assistant", content: "Perfect. Can I get a name for the order?", timestamp: "01:38" },
      { role: "user", content: "Sarah Johnson", timestamp: "01:44" },
      { role: "assistant", content: "Thanks Sarah! Your order will be ready in about 25-30 minutes. See you soon!", timestamp: "01:48" },
    ],
  },
  {
    sessionId: "CALL-003",
    startTime: new Date(Date.now() - 64 * 60 * 60 * 1000).toISOString(),
    endTime: new Date(Date.now() - 64 * 60 * 60 * 1000 + 89000).toISOString(),
    durationSeconds: 89,
    turnCount: 6,
    interruptions: 0,
    orderSubmitted: false,
    errors: ["Customer hung up during order collection"],
    customerName: undefined,
    customerPhone: "905-555-0000",
    transcript: [
      { role: "assistant", content: "Hi, thanks for calling All Star Wings and Ribs! I'm here to help you place an order. What can I get started for you today?", timestamp: "00:00" },
      { role: "user", content: "Hi, um, do you guys have like a combo or something?", timestamp: "00:10" },
      { role: "assistant", content: "Yes! We have several combo options. Our Family Combo includes wings, ribs, fries, and coleslaw. We also have wing combos and rib combos. Would you like to hear more about any of these?", timestamp: "00:16" },
      { role: "user", content: "Hmm let me think... actually hold on", timestamp: "00:32" },
      { role: "assistant", content: "Take your time! I'm here when you're ready.", timestamp: "00:38" },
      { role: "user", content: "Actually you know what, I need to check with my family first. I'll call back.", timestamp: "00:52" },
      { role: "assistant", content: "No problem at all! Feel free to call back whenever you're ready. Have a great day!", timestamp: "01:00" },
    ],
  },
  {
    sessionId: "CALL-004",
    startTime: new Date(Date.now() - 60 * 60 * 60 * 1000).toISOString(),
    endTime: new Date(Date.now() - 60 * 60 * 60 * 1000 + 198000).toISOString(),
    durationSeconds: 198,
    turnCount: 14,
    interruptions: 3,
    orderSubmitted: true,
    orderId: "ORD-003",
    errors: [],
    customerName: "Mike Chen",
    customerPhone: "905-555-9012",
    transcript: [
      { role: "assistant", content: "Hi, thanks for calling All Star Wings and Ribs! I'm here to help you place an order. What can I get started for you today?", timestamp: "00:00" },
      { role: "user", content: "Yeah I want the Lord of the Wings", timestamp: "00:06" },
      { role: "assistant", content: "The Lord of the Wing! Great choice - that's our premium wing platter. What size would you like? 2 pounds or 3 pounds?", timestamp: "00:10" },
      { role: "user", content: "3 pounds", timestamp: "00:18" },
      { role: "assistant", content: "Perfect! You can choose up to two flavors for the 3 pound. What flavors would you like?", timestamp: "00:22" },
      { role: "user", content: "Hot and medium", timestamp: "00:30" },
      { role: "assistant", content: "Got it - half hot, half medium. Anything else with your order?", timestamp: "00:34" },
      { role: "user", content: "Nope that's it", timestamp: "00:42" },
      { role: "assistant", content: "Alright! Lord of the Wing 3 pounds with hot and medium. Your total is $45.99 plus tax. Pickup or delivery?", timestamp: "00:46" },
      { role: "user", content: "Pickup", timestamp: "00:56" },
      { role: "assistant", content: "Name for the order?", timestamp: "01:00" },
      { role: "user", content: "Mike Chen", timestamp: "01:06" },
      { role: "assistant", content: "Thanks Mike! Your wings will be ready in about 20 minutes.", timestamp: "01:10" },
      { role: "user", content: "Thanks!", timestamp: "01:18" },
    ],
  },
  {
    sessionId: "CALL-005",
    startTime: new Date(Date.now() - 56 * 60 * 60 * 1000).toISOString(),
    endTime: new Date(Date.now() - 56 * 60 * 60 * 1000 + 423000).toISOString(),
    durationSeconds: 423,
    turnCount: 32,
    interruptions: 5,
    orderSubmitted: true,
    orderId: "ORD-004",
    errors: [],
    customerName: "Emily Davis",
    customerPhone: "416-555-3456",
    transcript: [
      { role: "assistant", content: "Hi, thanks for calling All Star Wings and Ribs! I'm here to help you place an order. What can I get started for you today?", timestamp: "00:00" },
      { role: "user", content: "Hi, I'm ordering for a group. We need a lot of food.", timestamp: "00:10" },
      { role: "assistant", content: "Perfect! I can help with that. How many people are you feeding?", timestamp: "00:16" },
      { role: "user", content: "About 8 people", timestamp: "00:24" },
      { role: "assistant", content: "Great! For 8 people, I'd recommend our Family Combo or a mix of wings and ribs. What sounds good?", timestamp: "00:28" },
      { role: "user", content: "Let's do both wings and ribs", timestamp: "00:38" },
      { role: "assistant", content: "Sounds good! For wings, our 5 pound party pack is great for groups. And for ribs, maybe two full racks?", timestamp: "00:44" },
      { role: "user", content: "Yeah that works. Can we get different flavors on the wings?", timestamp: "00:56" },
      { role: "assistant", content: "Absolutely! The party pack can have up to two flavors. What would you like?", timestamp: "01:02" },
      { role: "user", content: "Honey garlic and BBQ", timestamp: "01:12" },
      { role: "assistant", content: "Perfect! And for the two racks of ribs, same sauce or different?", timestamp: "01:16" },
      { role: "user", content: "One BBQ and one honey garlic", timestamp: "01:26" },
      { role: "assistant", content: "Got it. Would you like any sides? Fries, coleslaw, salads?", timestamp: "01:32" },
      { role: "user", content: "Yeah, let's get 3 orders of fries and 2 coleslaws", timestamp: "01:42" },
      { role: "assistant", content: "Great! Anything else?", timestamp: "01:50" },
      { role: "user", content: "That should be good", timestamp: "01:58" },
      { role: "assistant", content: "Alright! So we have: 5lb party pack wings with honey garlic and BBQ, two full racks of ribs - one BBQ one honey garlic, 3 fries, and 2 coleslaws. Your total is $142.95 plus tax. Pickup or delivery?", timestamp: "02:04" },
      { role: "user", content: "Delivery please", timestamp: "02:24" },
      { role: "assistant", content: "Sure! What's the delivery address?", timestamp: "02:28" },
      { role: "user", content: "123 Main Street, unit 5", timestamp: "02:36" },
      { role: "assistant", content: "Got it. And a name for the order?", timestamp: "02:44" },
      { role: "user", content: "Emily Davis", timestamp: "02:50" },
      { role: "assistant", content: "Thanks Emily! Your order will be delivered in about 45-50 minutes. Enjoy your party!", timestamp: "02:56" },
    ],
  },
  {
    sessionId: "CALL-006",
    startTime: new Date(Date.now() - 52 * 60 * 60 * 1000).toISOString(),
    endTime: new Date(Date.now() - 52 * 60 * 60 * 1000 + 45000).toISOString(),
    durationSeconds: 45,
    turnCount: 3,
    interruptions: 0,
    orderSubmitted: false,
    errors: ["Call disconnected - network issue"],
    customerName: undefined,
    customerPhone: "647-555-1111",
    transcript: [
      { role: "assistant", content: "Hi, thanks for calling All Star Wings and Ribs! I'm here to help you place an order. What can I get started for you today?", timestamp: "00:00" },
      { role: "user", content: "Hi, can I get--", timestamp: "00:08" },
      { role: "assistant", content: "I'm sorry, I didn't catch that. Could you repeat your order?", timestamp: "00:14" },
    ],
  },
  {
    sessionId: "CALL-007",
    startTime: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
    endTime: new Date(Date.now() - 48 * 60 * 60 * 1000 + 276000).toISOString(),
    durationSeconds: 276,
    turnCount: 20,
    interruptions: 2,
    orderSubmitted: true,
    orderId: "ORD-005",
    errors: [],
    customerName: "Robert Wilson",
    customerPhone: "905-555-7890",
    transcript: [
      { role: "assistant", content: "Hi, thanks for calling All Star Wings and Ribs! I'm here to help you place an order. What can I get started for you today?", timestamp: "00:00" },
      { role: "user", content: "I want to order some burgers", timestamp: "00:08" },
      { role: "assistant", content: "Great! We have several burger options. Our Classic Burger, Bacon Cheeseburger, and Mushroom Swiss are popular choices. Which would you like?", timestamp: "00:14" },
      { role: "user", content: "The bacon cheeseburger sounds good", timestamp: "00:26" },
      { role: "assistant", content: "Excellent choice! Would you like to make it a combo with fries and a drink?", timestamp: "00:32" },
      { role: "user", content: "Yes please", timestamp: "00:40" },
      { role: "assistant", content: "What would you like to drink? We have Coke, Sprite, Ginger Ale, or Iced Tea.", timestamp: "00:44" },
      { role: "user", content: "Coke please", timestamp: "00:52" },
      { role: "assistant", content: "Perfect! Bacon Cheeseburger combo with fries and Coke. Anything else?", timestamp: "00:56" },
      { role: "user", content: "Can I add onion rings?", timestamp: "01:06" },
      { role: "assistant", content: "Of course! I'll add an order of onion rings. Anything else?", timestamp: "01:10" },
      { role: "user", content: "That's it", timestamp: "01:18" },
      { role: "assistant", content: "Great! Your total is $24.99 plus tax. Pickup or delivery?", timestamp: "01:22" },
      { role: "user", content: "Pickup", timestamp: "01:32" },
      { role: "assistant", content: "Name for the order?", timestamp: "01:36" },
      { role: "user", content: "Robert Wilson", timestamp: "01:42" },
      { role: "assistant", content: "Thanks Robert! Your order will be ready in about 15 minutes.", timestamp: "01:46" },
    ],
  },
  {
    sessionId: "CALL-008",
    startTime: new Date(Date.now() - 44 * 60 * 60 * 1000).toISOString(),
    endTime: new Date(Date.now() - 44 * 60 * 60 * 1000 + 167000).toISOString(),
    durationSeconds: 167,
    turnCount: 12,
    interruptions: 1,
    orderSubmitted: true,
    orderId: "ORD-006",
    errors: [],
    customerName: "Jennifer Brown",
    customerPhone: "416-555-2345",
    transcript: [
      { role: "assistant", content: "Hi, thanks for calling All Star Wings and Ribs! I'm here to help you place an order. What can I get started for you today?", timestamp: "00:00" },
      { role: "user", content: "Can I get a Caesar salad?", timestamp: "00:08" },
      { role: "assistant", content: "Absolutely! Would you like to add grilled chicken to your Caesar salad?", timestamp: "00:12" },
      { role: "user", content: "Yes, with chicken please", timestamp: "00:20" },
      { role: "assistant", content: "Perfect! Chicken Caesar salad. Anything else?", timestamp: "00:24" },
      { role: "user", content: "And a soup. What's the soup today?", timestamp: "00:32" },
      { role: "assistant", content: "Today's soup is Chicken Noodle. Would you like a bowl?", timestamp: "00:38" },
      { role: "user", content: "Yes please", timestamp: "00:46" },
      { role: "assistant", content: "Great! Chicken Caesar salad and Chicken Noodle soup. Your total is $21.98 plus tax. Pickup or delivery?", timestamp: "00:50" },
      { role: "user", content: "Pickup, name is Jennifer Brown", timestamp: "01:02" },
      { role: "assistant", content: "Thanks Jennifer! Your order will be ready in about 10 minutes.", timestamp: "01:08" },
    ],
  },
  {
    sessionId: "CALL-009",
    startTime: new Date(Date.now() - 40 * 60 * 60 * 1000).toISOString(),
    endTime: new Date(Date.now() - 40 * 60 * 60 * 1000 + 534000).toISOString(),
    durationSeconds: 534,
    turnCount: 42,
    interruptions: 8,
    orderSubmitted: true,
    orderId: "ORD-007",
    errors: [],
    customerName: "David Martinez",
    customerPhone: "647-555-8901",
    transcript: [
      { role: "assistant", content: "Hi, thanks for calling All Star Wings and Ribs! I'm here to help you place an order. What can I get started for you today?", timestamp: "00:00" },
      { role: "user", content: "Hi! I'm having a Super Bowl party and need to feed about 15 people. What do you recommend?", timestamp: "00:10" },
      { role: "assistant", content: "Exciting! For 15 people, I'd suggest a combination of our party packs. Maybe two 5-pound wing party packs and some ribs?", timestamp: "00:20" },
      { role: "user", content: "That sounds good. What flavors are popular?", timestamp: "00:34" },
      { role: "assistant", content: "Our most popular are Honey Garlic, BBQ, and Hot. For parties, mixing flavors works great!", timestamp: "00:40" },
      { role: "user", content: "Let's do one pack honey garlic and BBQ, and one pack hot and medium", timestamp: "00:54" },
      { role: "assistant", content: "Perfect variety! Now for ribs - how about two full racks?", timestamp: "01:04" },
      { role: "user", content: "Make it three racks", timestamp: "01:14" },
      { role: "assistant", content: "Three full racks! What sauces? BBQ, Honey Garlic, Cajun, or Dry Rub?", timestamp: "01:20" },
      { role: "user", content: "Two BBQ and one dry rub", timestamp: "01:32" },
      { role: "assistant", content: "Great choices! Would you like sides? We have fries, coleslaw, and salads.", timestamp: "01:38" },
      { role: "user", content: "Yeah, let's do 5 fries, 3 coleslaws, and a garden salad", timestamp: "01:50" },
      { role: "assistant", content: "Got it! Anything to drink?", timestamp: "02:00" },
      { role: "user", content: "Do you have pitchers?", timestamp: "02:08" },
      { role: "assistant", content: "We have 2-liter bottles - Coke, Sprite, and Ginger Ale.", timestamp: "02:14" },
      { role: "user", content: "Two Cokes and a Sprite", timestamp: "02:24" },
      { role: "assistant", content: "Perfect! Let me confirm: Two 5lb wing packs, three full racks of ribs, 5 fries, 3 coleslaws, garden salad, and three 2-liters. Your total is $298.94 plus tax. Delivery or pickup?", timestamp: "02:30" },
      { role: "user", content: "Delivery to 789 Oak Avenue", timestamp: "02:56" },
      { role: "assistant", content: "And what time is your party?", timestamp: "03:06" },
      { role: "user", content: "It starts at 6, so maybe 5:30?", timestamp: "03:14" },
      { role: "assistant", content: "We can schedule that. Name for the order?", timestamp: "03:22" },
      { role: "user", content: "David Martinez", timestamp: "03:30" },
      { role: "assistant", content: "Thanks David! Your order will be delivered around 5:30 PM. Enjoy the game!", timestamp: "03:36" },
    ],
  },
  {
    sessionId: "CALL-010",
    startTime: new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString(),
    endTime: new Date(Date.now() - 36 * 60 * 60 * 1000 + 78000).toISOString(),
    durationSeconds: 78,
    turnCount: 5,
    interruptions: 0,
    orderSubmitted: false,
    errors: ["Customer requested callback"],
    customerName: "Lisa Anderson",
    customerPhone: "905-555-4567",
    transcript: [
      { role: "assistant", content: "Hi, thanks for calling All Star Wings and Ribs! I'm here to help you place an order. What can I get started for you today?", timestamp: "00:00" },
      { role: "user", content: "Hi, I'm looking at your menu online. Do you have any specials today?", timestamp: "00:10" },
      { role: "assistant", content: "Yes! Today we have 20% off all wing orders over 2 pounds, and our lunch combos are available until 3 PM.", timestamp: "00:18" },
      { role: "user", content: "Oh nice! Actually, can you call me back in about 30 minutes? I need to check with my husband.", timestamp: "00:32" },
      { role: "assistant", content: "Of course! I'll make a note for a callback. Is this the best number to reach you?", timestamp: "00:42" },
      { role: "user", content: "Yes, this number is fine. Thanks!", timestamp: "00:52" },
      { role: "assistant", content: "You're welcome! We'll call you back in 30 minutes. Talk to you soon, Lisa!", timestamp: "00:58" },
    ],
  },
  {
    sessionId: "CALL-011",
    startTime: new Date(Date.now() - 32 * 60 * 60 * 1000).toISOString(),
    endTime: new Date(Date.now() - 32 * 60 * 60 * 1000 + 289000).toISOString(),
    durationSeconds: 289,
    turnCount: 22,
    interruptions: 3,
    orderSubmitted: true,
    orderId: "ORD-008",
    errors: [],
    customerName: "James Taylor",
    customerPhone: "416-555-6789",
    transcript: [
      { role: "assistant", content: "Hi, thanks for calling All Star Wings and Ribs! I'm here to help you place an order. What can I get started for you today?", timestamp: "00:00" },
      { role: "user", content: "Hey, I want some steaks", timestamp: "00:06" },
      { role: "assistant", content: "Great choice! We have 8oz Sirloin, 10oz New York Strip, and 12oz Ribeye. Which would you like?", timestamp: "00:12" },
      { role: "user", content: "The ribeye, make it two", timestamp: "00:22" },
      { role: "assistant", content: "Two 12oz Ribeyes! How would you like them cooked?", timestamp: "00:28" },
      { role: "user", content: "One medium rare, one medium", timestamp: "00:36" },
      { role: "assistant", content: "Perfect. Each steak comes with your choice of two sides. What would you like?", timestamp: "00:42" },
      { role: "user", content: "Baked potato and vegetables for both", timestamp: "00:54" },
      { role: "assistant", content: "Got it! Any appetizers to start?", timestamp: "01:02" },
      { role: "user", content: "Yeah, the mozzarella sticks", timestamp: "01:10" },
      { role: "assistant", content: "Excellent! Two ribeyes, baked potatoes, vegetables, and mozza sticks. Anything else?", timestamp: "01:16" },
      { role: "user", content: "That's it", timestamp: "01:26" },
      { role: "assistant", content: "Your total is $89.97 plus tax. Pickup or delivery?", timestamp: "01:30" },
      { role: "user", content: "Pickup in about an hour?", timestamp: "01:40" },
      { role: "assistant", content: "We can have that ready. Name for the order?", timestamp: "01:46" },
      { role: "user", content: "James Taylor", timestamp: "01:54" },
      { role: "assistant", content: "Thanks James! Your order will be ready at 7:30 PM.", timestamp: "02:00" },
    ],
  },
  {
    sessionId: "CALL-012",
    startTime: new Date(Date.now() - 28 * 60 * 60 * 1000).toISOString(),
    endTime: new Date(Date.now() - 28 * 60 * 60 * 1000 + 198000).toISOString(),
    durationSeconds: 198,
    turnCount: 15,
    interruptions: 1,
    orderSubmitted: true,
    orderId: "ORD-009",
    errors: [],
    customerName: "Amanda White",
    customerPhone: "647-555-0123",
    transcript: [
      { role: "assistant", content: "Hi, thanks for calling All Star Wings and Ribs! I'm here to help you place an order. What can I get started for you today?", timestamp: "00:00" },
      { role: "user", content: "Hi! Can I get the King of the Wing?", timestamp: "00:08" },
      { role: "assistant", content: "Absolutely! The King of the Wing - would you like the 1, 2, or 3 pound size?", timestamp: "00:14" },
      { role: "user", content: "1 pound please", timestamp: "00:22" },
      { role: "assistant", content: "And what flavor?", timestamp: "00:26" },
      { role: "user", content: "Teriyaki", timestamp: "00:32" },
      { role: "assistant", content: "Great! 1 pound King of the Wing with Teriyaki. Would you like anything else?", timestamp: "00:36" },
      { role: "user", content: "Sweet potato fries", timestamp: "00:46" },
      { role: "assistant", content: "Perfect choice! Anything else?", timestamp: "00:52" },
      { role: "user", content: "No, that's all", timestamp: "01:00" },
      { role: "assistant", content: "Alright! King of the Wing 1lb Teriyaki and sweet potato fries. Total is $24.98 plus tax. Pickup or delivery?", timestamp: "01:04" },
      { role: "user", content: "Pickup, name is Amanda White", timestamp: "01:18" },
      { role: "assistant", content: "Thanks Amanda! Ready in about 15 minutes.", timestamp: "01:24" },
    ],
  },
  {
    sessionId: "CALL-013",
    startTime: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    endTime: new Date(Date.now() - 24 * 60 * 60 * 1000 + 156000).toISOString(),
    durationSeconds: 156,
    turnCount: 11,
    interruptions: 0,
    orderSubmitted: true,
    orderId: "ORD-010",
    errors: [],
    customerName: "Kevin Lee",
    customerPhone: "905-555-2345",
    transcript: [
      { role: "assistant", content: "Hi, thanks for calling All Star Wings and Ribs! I'm here to help you place an order. What can I get started for you today?", timestamp: "00:00" },
      { role: "user", content: "Hey, can I get some fish and chips?", timestamp: "00:08" },
      { role: "assistant", content: "Sure! Our fish and chips comes with two pieces of beer-battered cod and fries. Would you like that?", timestamp: "00:14" },
      { role: "user", content: "Yeah, sounds good", timestamp: "00:24" },
      { role: "assistant", content: "Great! Anything else with your order?", timestamp: "00:28" },
      { role: "user", content: "Actually, add some onion rings too", timestamp: "00:36" },
      { role: "assistant", content: "Perfect! Fish and chips with a side of onion rings. Your total is $19.98 plus tax. Pickup or delivery?", timestamp: "00:42" },
      { role: "user", content: "Pickup please", timestamp: "00:54" },
      { role: "assistant", content: "Name for the order?", timestamp: "00:58" },
      { role: "user", content: "Kevin Lee", timestamp: "01:04" },
      { role: "assistant", content: "Thanks Kevin! Your order will be ready in about 15 minutes.", timestamp: "01:08" },
    ],
  },
  {
    sessionId: "CALL-014",
    startTime: new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString(),
    endTime: new Date(Date.now() - 20 * 60 * 60 * 1000 + 67000).toISOString(),
    durationSeconds: 67,
    turnCount: 4,
    interruptions: 0,
    orderSubmitted: false,
    errors: ["Wrong number - customer looking for different restaurant"],
    customerName: undefined,
    customerPhone: "416-555-9999",
    transcript: [
      { role: "assistant", content: "Hi, thanks for calling All Star Wings and Ribs! I'm here to help you place an order. What can I get started for you today?", timestamp: "00:00" },
      { role: "user", content: "Hi, is this Pizza Palace?", timestamp: "00:08" },
      { role: "assistant", content: "No, this is All Star Wings and Ribs. We specialize in wings, ribs, and American cuisine. Would you still like to place an order with us?", timestamp: "00:14" },
      { role: "user", content: "Oh sorry, wrong number. I was trying to order pizza.", timestamp: "00:28" },
      { role: "assistant", content: "No problem! Have a great day!", timestamp: "00:36" },
    ],
  },
  {
    sessionId: "CALL-015",
    startTime: new Date(Date.now() - 16 * 60 * 60 * 1000).toISOString(),
    endTime: new Date(Date.now() - 16 * 60 * 60 * 1000 + 345000).toISOString(),
    durationSeconds: 345,
    turnCount: 26,
    interruptions: 4,
    orderSubmitted: true,
    orderId: "ORD-013",
    errors: [],
    customerName: "Chris Robinson",
    customerPhone: "905-555-7788",
    transcript: [
      { role: "assistant", content: "Hi, thanks for calling All Star Wings and Ribs! I'm here to help you place an order. What can I get started for you today?", timestamp: "00:00" },
      { role: "user", content: "Hi, I want to order dinner for me and my wife", timestamp: "00:10" },
      { role: "assistant", content: "Perfect! What would you like?", timestamp: "00:16" },
      { role: "user", content: "I'll have a steak and she wants the salmon", timestamp: "00:24" },
      { role: "assistant", content: "Great choices! For the steak, we have 8oz Sirloin, 10oz New York Strip, and 12oz Ribeye. Which would you prefer?", timestamp: "00:30" },
      { role: "user", content: "The ribeye please", timestamp: "00:42" },
      { role: "assistant", content: "12oz Ribeye! How would you like it cooked?", timestamp: "00:46" },
      { role: "user", content: "Medium rare", timestamp: "00:54" },
      { role: "assistant", content: "Perfect. And for the Atlantic Salmon, it comes grilled with lemon butter sauce. Both come with choice of two sides.", timestamp: "01:00" },
      { role: "user", content: "For sides, we'll both have the garden salad and baked potato", timestamp: "01:14" },
      { role: "assistant", content: "Got it - two garden salads and two baked potatoes. Would you like any appetizers to start?", timestamp: "01:22" },
      { role: "user", content: "Yeah, the spinach dip", timestamp: "01:32" },
      { role: "assistant", content: "Excellent choice! Anything else?", timestamp: "01:38" },
      { role: "user", content: "That's everything", timestamp: "01:46" },
      { role: "assistant", content: "Alright! Ribeye medium rare, Atlantic Salmon, two salads, two baked potatoes, and spinach dip. Your total is $78.97 plus tax. Pickup or delivery?", timestamp: "01:52" },
      { role: "user", content: "Pickup", timestamp: "02:10" },
      { role: "assistant", content: "Name for the order?", timestamp: "02:14" },
      { role: "user", content: "Chris Robinson", timestamp: "02:20" },
      { role: "assistant", content: "Thanks Chris! Your order will be ready in about 25 minutes.", timestamp: "02:26" },
    ],
  },
  {
    sessionId: "CALL-016",
    startTime: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(),
    endTime: new Date(Date.now() - 12 * 60 * 60 * 1000 + 234000).toISOString(),
    durationSeconds: 234,
    turnCount: 18,
    interruptions: 2,
    orderSubmitted: true,
    orderId: "ORD-014",
    errors: [],
    customerName: "Stephanie Clark",
    customerPhone: "647-555-9900",
    transcript: [
      { role: "assistant", content: "Hi, thanks for calling All Star Wings and Ribs! I'm here to help you place an order. What can I get started for you today?", timestamp: "00:00" },
      { role: "user", content: "I'd like to place a delivery order", timestamp: "00:08" },
      { role: "assistant", content: "Sure! What would you like to order?", timestamp: "00:14" },
      { role: "user", content: "The Lord of the Wing, 2 pounds", timestamp: "00:22" },
      { role: "assistant", content: "Great! What flavor for your 2 pound Lord of the Wing?", timestamp: "00:28" },
      { role: "user", content: "Garlic parmesan please", timestamp: "00:36" },
      { role: "assistant", content: "Delicious choice! Anything else?", timestamp: "00:42" },
      { role: "user", content: "And mozzarella sticks", timestamp: "00:50" },
      { role: "assistant", content: "Got it! Lord of the Wing 2lb garlic parmesan and mozza sticks. Your total is $43.98 plus tax. What's your delivery address?", timestamp: "00:56" },
      { role: "user", content: "55 Queen Street, apartment 302", timestamp: "01:10" },
      { role: "assistant", content: "Got it. And your name?", timestamp: "01:20" },
      { role: "user", content: "Stephanie Clark", timestamp: "01:26" },
      { role: "assistant", content: "Thanks Stephanie! Your order will be delivered in about 35-40 minutes.", timestamp: "01:32" },
    ],
  },
  {
    sessionId: "CALL-017",
    startTime: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(),
    endTime: new Date(Date.now() - 8 * 60 * 60 * 1000 + 112000).toISOString(),
    durationSeconds: 112,
    turnCount: 8,
    interruptions: 1,
    orderSubmitted: false,
    errors: ["Customer changed mind - wanted to order online instead"],
    customerName: "Daniel King",
    customerPhone: "905-555-1122",
    transcript: [
      { role: "assistant", content: "Hi, thanks for calling All Star Wings and Ribs! I'm here to help you place an order. What can I get started for you today?", timestamp: "00:00" },
      { role: "user", content: "Hi, I want to order wings but I have a lot of customizations", timestamp: "00:10" },
      { role: "assistant", content: "No problem! I can help with that. What would you like?", timestamp: "00:16" },
      { role: "user", content: "Well, I want different sauces on each pound, and specific sides for each person...", timestamp: "00:24" },
      { role: "assistant", content: "Sure, let's go through it. How many pounds total?", timestamp: "00:36" },
      { role: "user", content: "Actually, you know what, this might be easier to do online where I can see everything. Do you have online ordering?", timestamp: "00:44" },
      { role: "assistant", content: "Yes! You can order at allstarwingsandribs.com. It shows all our options and you can customize everything there.", timestamp: "00:56" },
      { role: "user", content: "Perfect, I'll do that. Thanks!", timestamp: "01:08" },
      { role: "assistant", content: "You're welcome! Enjoy your order!", timestamp: "01:14" },
    ],
  },
  {
    sessionId: "CALL-018",
    startTime: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
    endTime: new Date(Date.now() - 4 * 60 * 60 * 1000 + 267000).toISOString(),
    durationSeconds: 267,
    turnCount: 20,
    interruptions: 2,
    orderSubmitted: true,
    orderId: "ORD-019",
    errors: [],
    customerName: "Michelle Scott",
    customerPhone: "416-555-3344",
    transcript: [
      { role: "assistant", content: "Hi, thanks for calling All Star Wings and Ribs! I'm here to help you place an order. What can I get started for you today?", timestamp: "00:00" },
      { role: "user", content: "I'd like a wrap please", timestamp: "00:08" },
      { role: "assistant", content: "We have several wrap options - Chicken Caesar, Buffalo Chicken, and Veggie. Which would you like?", timestamp: "00:14" },
      { role: "user", content: "Buffalo chicken sounds good", timestamp: "00:26" },
      { role: "assistant", content: "Great choice! Would you like it mild, medium, or hot?", timestamp: "00:32" },
      { role: "user", content: "Medium", timestamp: "00:40" },
      { role: "assistant", content: "Buffalo chicken wrap with medium sauce. Would you like to add a side?", timestamp: "00:44" },
      { role: "user", content: "What sides come with it?", timestamp: "00:54" },
      { role: "assistant", content: "The wrap comes with your choice of fries, side salad, or soup.", timestamp: "01:00" },
      { role: "user", content: "Fries please", timestamp: "01:10" },
      { role: "assistant", content: "Perfect! Anything else?", timestamp: "01:14" },
      { role: "user", content: "A chocolate brownie for dessert", timestamp: "01:22" },
      { role: "assistant", content: "Yum! Buffalo chicken wrap with fries and a chocolate brownie. Your total is $18.97 plus tax. Pickup or delivery?", timestamp: "01:28" },
      { role: "user", content: "Pickup", timestamp: "01:42" },
      { role: "assistant", content: "Name?", timestamp: "01:46" },
      { role: "user", content: "Michelle Scott", timestamp: "01:52" },
      { role: "assistant", content: "Thanks Michelle! Ready in about 12 minutes.", timestamp: "01:58" },
    ],
  },
  {
    sessionId: "CALL-019",
    startTime: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    endTime: new Date(Date.now() - 2 * 60 * 60 * 1000 + 189000).toISOString(),
    durationSeconds: 189,
    turnCount: 14,
    interruptions: 1,
    orderSubmitted: true,
    orderId: "ORD-022",
    errors: [],
    customerName: "Jessica Adams",
    customerPhone: "905-555-3456",
    transcript: [
      { role: "assistant", content: "Hi, thanks for calling All Star Wings and Ribs! I'm here to help you place an order. What can I get started for you today?", timestamp: "00:00" },
      { role: "user", content: "Can I get some desserts?", timestamp: "00:08" },
      { role: "assistant", content: "Absolutely! We have Chocolate Brownie, New York Cheesecake, Apple Pie, and Ice Cream. What would you like?", timestamp: "00:14" },
      { role: "user", content: "I'll take 4 brownies and 2 cheesecakes", timestamp: "00:26" },
      { role: "assistant", content: "Perfect for a party! 4 chocolate brownies and 2 NY cheesecakes. Anything else?", timestamp: "00:34" },
      { role: "user", content: "That's all, just the desserts", timestamp: "00:46" },
      { role: "assistant", content: "Got it! Your total is $49.94 plus tax. Pickup or delivery?", timestamp: "00:52" },
      { role: "user", content: "Pickup", timestamp: "01:02" },
      { role: "assistant", content: "Name for the order?", timestamp: "01:06" },
      { role: "user", content: "Jessica Adams", timestamp: "01:12" },
      { role: "assistant", content: "Thanks Jessica! Your desserts will be ready in about 5 minutes.", timestamp: "01:18" },
    ],
  },
  {
    sessionId: "CALL-020",
    startTime: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
    endTime: new Date(Date.now() - 45 * 60 * 1000 + 312000).toISOString(),
    durationSeconds: 312,
    turnCount: 24,
    interruptions: 3,
    orderSubmitted: true,
    orderId: "ORD-023",
    errors: [],
    customerName: "Ryan Nelson",
    customerPhone: "647-555-7890",
    transcript: [
      { role: "assistant", content: "Hi, thanks for calling All Star Wings and Ribs! I'm here to help you place an order. What can I get started for you today?", timestamp: "00:00" },
      { role: "user", content: "Hey! I want to order wings for a party, what's your biggest size?", timestamp: "00:08" },
      { role: "assistant", content: "Perfect timing! Our biggest size is the 5 pound party pack. It's great for groups and comes with your choice of up to two flavors. Would you like that?", timestamp: "00:14" },
      { role: "user", content: "Yeah that sounds perfect", timestamp: "00:26" },
      { role: "assistant", content: "Awesome! What flavor would you like for your 5 pound party pack? We have Honey Garlic, BBQ, Hot, Medium, Mild, Teriyaki, Salt & Pepper, Lemon Pepper, Garlic Parmesan, and more.", timestamp: "00:30" },
      { role: "user", content: "Can I do half and half?", timestamp: "00:44" },
      { role: "assistant", content: "Absolutely! What two flavors would you like?", timestamp: "00:48" },
      { role: "user", content: "Let's do hot and honey garlic", timestamp: "00:54" },
      { role: "assistant", content: "Great combo! Half hot, half honey garlic on the 5 pound party pack. Would you like anything else with that?", timestamp: "01:00" },
      { role: "user", content: "Do you have like dipping sauces?", timestamp: "01:12" },
      { role: "assistant", content: "Yes! We have ranch, blue cheese, and our house-made garlic dip. They're included with wing orders, but you can add extra for a small charge.", timestamp: "01:16" },
      { role: "user", content: "Cool, just the ones that come with it are fine", timestamp: "01:30" },
      { role: "assistant", content: "Perfect. Anything else for your order?", timestamp: "01:36" },
      { role: "user", content: "Nah I think that's good for now", timestamp: "01:42" },
      { role: "assistant", content: "Alright! So I have a 5 pound party pack with half hot and half honey garlic wings. Your total is $68.99 plus tax. Is this for pickup or delivery?", timestamp: "01:48" },
      { role: "user", content: "Delivery please", timestamp: "02:02" },
      { role: "assistant", content: "Great! Can I get your delivery address?", timestamp: "02:06" },
      { role: "user", content: "It's 45 King Street West", timestamp: "02:12" },
      { role: "assistant", content: "Got it. And can I get a name for the order?", timestamp: "02:20" },
      { role: "user", content: "Ryan Nelson", timestamp: "02:26" },
      { role: "assistant", content: "Thanks Ryan! And a phone number in case the driver needs to reach you?", timestamp: "02:30" },
      { role: "user", content: "647-555-7890", timestamp: "02:38" },
      { role: "assistant", content: "Perfect! Your order has been placed. Your 5 pound party pack will be delivered in about 35-45 minutes. Is there anything else I can help you with?", timestamp: "02:44" },
      { role: "user", content: "No that's everything, thanks!", timestamp: "02:58" },
      { role: "assistant", content: "Enjoy your party, Ryan! Thanks for calling All Star Wings and Ribs!", timestamp: "03:02" },
    ],
  },
]

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

    // Store order locally for admin dashboard
    if (result.order) {
      orderStore.unshift({
        id: result.orderId || `local-${Date.now()}`,
        status: result.order.status || "OrderPlaced",
        channel: result.order.channel || "PhoneIn",
        currency: result.order.currency || "CAD",
        customer: result.order.customer || { name: voiceOrder.customer.name, phone: voiceOrder.customer.phone },
        fulfillment: { type: voiceOrder.orderType === "pickup" ? "Pickup" : voiceOrder.orderType === "delivery" ? "Delivery" : "DineIn" },
        orderLines: result.order.orderLines?.map((line: { productId?: { type: string; value: string }; description?: string; quantity?: { value: number; unitOfMeasure: string }; unitPrice?: number; extendedAmount?: number }) => ({
          productId: line.productId || { type: "SKU", value: "unknown" },
          description: line.description || "",
          quantity: line.quantity || { value: 1, unitOfMeasure: "EA" },
          unitPrice: line.unitPrice || 0,
          extendedAmount: line.extendedAmount || 0,
        })) || [],
        totals: result.order.totals || [],
        taxes: (result.order.taxes || []).map((t: { amount: number; code: string; percentage?: number }) => ({
          amount: t.amount,
          code: t.code,
          percentage: t.percentage ?? 0,
        })),
        createdAt: new Date().toISOString(),
        acknowledged: false,
      });

      // Keep only last 100 orders
      if (orderStore.length > 100) {
        orderStore.pop();
      }
    }
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

app.listen(Number(PORT), "0.0.0.0", () => {
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

Admin Dashboard API:
  GET  /admin/sites              - List all sites
  GET  /admin/sites/:siteId      - Get site details
  GET  /admin/menu/items         - List catalog items
  GET  /admin/menu/items/:itemId - Get item details
  GET  /admin/orders             - List orders
  GET  /admin/orders/:orderId    - Get order details
  POST /admin/orders/:orderId/acknowledge - Acknowledge order

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
