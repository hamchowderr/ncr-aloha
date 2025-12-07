# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

NCR Aloha Voice Ordering Integration - A TypeScript backend that bridges voice AI systems (Pipecat) with NCR Aloha POS via the BSP (Business Services Platform) APIs.

## Development Commands

### Backend (Express API on port 3000)
```bash
npm install          # Install dependencies
npm run dev          # Start with hot reload (tsx watch)
npm run server       # Start server once
npm run test:api     # Run API integration test
npm run build        # Compile TypeScript to dist/
```

### Frontend (Vite + React on port 5173)
```bash
cd web
npm install          # Install dependencies
npm run dev          # Start Vite dev server
npm run build        # Production build
npm run lint         # Run ESLint
```

### Running Both Together
Terminal 1: `npm run server` (backend on :3000)
Terminal 2: `cd web && npm run dev` (frontend on :5173)

The frontend proxies `/api/*` requests to `localhost:3000`.

## Architecture

### Backend (`src/`)
```
src/
├── auth/hmac.ts        # HMAC-SHA512 authentication for NCR APIs
├── api/
│   ├── client.ts       # Base HTTP client with auto-auth
│   ├── orders.ts       # Order API endpoints
│   └── catalog.ts      # Catalog API endpoints
├── services/
│   ├── order-service.ts    # High-level order processing
│   ├── order-builder.ts    # Converts VoiceOrder → NCR Order
│   └── menu-matcher.ts     # Fuzzy matching spoken items to menu
├── models/
│   ├── order.ts        # NCR order types
│   ├── catalog.ts      # NCR catalog types
│   └── menu.ts         # VoiceOrder and Menu types
├── data/
│   └── allstar-menu.ts # Sample menu data
├── config/index.ts     # Environment configuration
├── server.ts           # Express server
└── index.ts            # Library exports
```

### Frontend (`web/src/`)
- React 19 + Vite + TypeScript
- Tailwind CSS v4 with shadcn/ui components
- Components: `MenuItemCard`, `ItemConfigDialog`, `Cart`
- Hooks: `useMenu`, `useCart`

## Key Concepts

### NCR Authentication
All NCR API requests require HMAC-SHA512 signed headers. The signature is built from:
- HTTP method + URL path + content-type + organization
- Signed with: `secretKey + ISO timestamp`
- Header format: `Authorization: AccessKey {sharedKey}:{base64Signature}`

### Order Flow
1. Voice AI produces a `VoiceOrder` (customer info, items with spoken names)
2. `MenuMatcher` fuzzy-matches spoken items to actual menu items
3. `OrderBuilder` converts to NCR `CreateOrderRequest` format
4. `OrderService.submitOrder()` sends to NCR API

### VoiceOrder Structure
```typescript
{
  orderType: "pickup" | "delivery",
  items: [{ itemName: string, quantity: number, size?: string, modifiers?: string[] }],
  customer: { name: string, phone: string }
}
```

## Environment Variables

Required in `.env`:
```
NCR_API_GATEWAY=https://api.ncr.com
NCR_ORGANIZATION=<org-id>
NCR_SITE_ID=<site-id>
NCR_SHARED_KEY=<shared-key>
NCR_SECRET_KEY=<secret-key>
```

## NCR API Endpoints Used

- `POST /order/3/orders/1` - Create order
- `GET /order/3/orders/1/{id}` - Get order
- `POST /order/3/orders/1/find` - Find orders
- `POST /catalog/v2/items` - Catalog operations

## Valid NCR Enum Values

- **Channel**: `PhoneIn`, `Web`, `Mobile`, `WalkIn`, `DriveThru`, `CallCenter`, `Other`
- **Order Status**: `OrderPlaced`, `OrderReceived`, `InProgress`, `ReadyForPickup`, `Completed`, `Cancelled`
- **Total Type**: `TaxExcluded`, `TaxIncluded`, `Net`

## Pipecat Voice Integration (`pipecat/`)

Python-based voice AI that connects to the TypeScript API.

### Architecture
```
[Phone/Browser] → [Daily.co WebRTC] → [Pipecat] → [TypeScript API] → [NCR Aloha]
     or                  or
[Real Phone] → [Telnyx VOIP/SIP] →    ↓
                          Deepgram STT → GPT-4o → Cartesia TTS
```

### Bot Versions

**Standard Bot (`bot.py`):**
- Daily.co WebRTC transport (browser-based)
- Free-form conversation with function calling
- GPT-4o with optimized voice prompt
- Cartesia TTS (sonic model, 16kHz)
- Silero VAD for voice activity detection
- Call metrics and observability

**Telnyx VOIP Bot (`bot_telnyx.py`):**
- Real phone calls via Telnyx SIP/VOIP
- WebSocket media streaming (8kHz audio)
- Same order logic as standard bot
- Requires: Telnyx account + phone number

**Flows Bot (`bot_flows.py`):**
- Structured conversation with explicit state transitions
- Node-based flow: greeting → order_collection → confirmation → customer_info → completion
- More predictable ordering experience
- Requires: `pip install pipecat-flows`

### Setup

**Windows (text-based testing only):**
```bash
cd pipecat
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python test_order.py         # Text-based conversation test
```

**WSL/Linux/Mac (full voice mode):**
```bash
cd pipecat
source venv-wsl/bin/activate  # In WSL
pip install 'pipecat-ai[daily,openai,deepgram,elevenlabs,silero]' pipecat-flows httpx python-dotenv pydantic
```

### Running

```bash
# Windows: Text-based testing
python test_order.py

# WSL/Linux/Mac: Standard bot with Daily.co WebRTC
python create_room.py        # Get room URL
python bot.py <room_url>     # Start the bot

# WSL/Linux/Mac: Telnyx VOIP bot (real phone calls)
python bot_telnyx.py         # Uses Pipecat runner, listens on port 8765

# WSL/Linux/Mac: Flows-based bot (structured conversation)
python bot_flows.py <room_url>

# HTTP server for session management (auto-spawns bots on Linux)
python server.py             # Runs on port 8765
```

### Server API

```bash
# Create session (standard bot)
curl -X POST http://localhost:8765/sessions

# Create session (Flows bot)
curl -X POST "http://localhost:8765/sessions?use_flows=true"

# Get session status
curl http://localhost:8765/sessions/{session_id}

# Health check
curl http://localhost:8765/health
```

### Platform Note
`daily-python` has no Windows wheels. Use WSL Ubuntu with `venv-wsl` for voice features, or use `test_order.py` for text-based testing on Windows.

### Files
- `bot.py` - Daily.co WebRTC bot with GPT-4o and Cartesia TTS
- `bot_telnyx.py` - Telnyx VOIP bot for real phone calls
- `bot_flows.py` - Pipecat Flows version with structured conversation states
- `order_assistant.py` - Order extraction with function calling (voice-optimized prompt)
- `order_client.py` - HTTP client for TypeScript API
- `create_room.py` - Daily.co room creation helper
- `server.py` - HTTP server with auto-spawn and session management

### Enhanced Features

| Feature | Description |
|---------|-------------|
| SmartTurnAnalyzer | AI-powered turn detection for natural pauses |
| Silero VAD | Optimized voice activity detection (0.2s start/stop) |
| Turn Tracking Observer | Monitor conversation turns and interruptions |
| Idle Detection | Auto-end calls after 5 min silence |
| Watchdog Timers | Detect stuck processors |
| Call Recording | Optional recording via Daily.co |
| Call Metrics | Track duration, turns, order success |

### Required API Keys (in `pipecat/.env`)
```
# Transport (choose one or both)
DAILY_API_KEY=          # WebRTC rooms (https://dashboard.daily.co)
TELNYX_API_KEY=         # VOIP/SIP telephony (https://portal.telnyx.com)

# AI Services
DEEPGRAM_API_KEY=       # Speech-to-text (https://console.deepgram.com)
OPENAI_API_KEY=         # LLM - GPT-4o (https://platform.openai.com)
CARTESIA_API_KEY=       # Text-to-speech (https://cartesia.ai)
CARTESIA_VOICE_ID=      # Voice ID for TTS

# Backend
ORDER_API_URL=http://localhost:3000  # TypeScript backend (use host.docker.internal from WSL)
```

### Telnyx Setup

1. Create account at https://portal.telnyx.com
2. Get API key from Settings → API Keys
3. Buy a phone number with Voice capability
4. Create TeXML Application:
   - Go to Voice → TeXML Apps
   - Create new app with this TeXML:
     ```xml
     <?xml version="1.0" encoding="UTF-8"?>
     <Response>
       <Connect>
         <Stream url="wss://your-server.com/ws" bidirectionalMode="rtp"></Stream>
       </Connect>
       <Pause length="40"/>
     </Response>
     ```
5. Assign TeXML app to your phone number
6. For local testing: use ngrok (`ngrok http 8765`) and update the TeXML URL
