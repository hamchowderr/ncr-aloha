# NCR Aloha Voice Ordering Integration

A TypeScript backend that bridges voice AI systems (Pipecat) with NCR Aloha POS via the BSP (Business Services Platform) APIs.

## Architecture

```
[Phone/Browser] → [Daily.co WebRTC] → [Pipecat] → [TypeScript API] → [NCR Aloha]
     or                  or
[Real Phone] → [Telnyx VOIP/SIP] →    ↓
                          Deepgram STT → GPT-4o → Cartesia TTS
```

### Container Architecture
- `ncr-backend` (port 3000): TypeScript Express API
- `ncr-pipecat` (port 8765): Python voice bot server

## Quick Start

### Backend (Express API on port 3000)
```bash
npm install
npm run dev          # Start with hot reload
npm run server       # Start server once
```

### Frontend (Vite + React on port 5173)
```bash
cd web
npm install
npm run dev
```

### Running Both Together
```bash
# Terminal 1
npm run server       # Backend on :3000

# Terminal 2
cd web && npm run dev  # Frontend on :5173
```

The frontend proxies `/api/*` requests to `localhost:3000`.

### Docker Deployment
```bash
# Standard deployment (free-form conversation)
docker compose up -d --build

# With Pipecat Flows (structured conversation)
USE_FLOWS=true docker compose up -d --build

# View logs
docker logs ncr-pipecat --tail 50 -f
docker logs ncr-backend --tail 50 -f
```

## Project Structure

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

## Order Flow

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

### Backend (`.env`)
```
NCR_API_GATEWAY=https://api.ncr.com
NCR_ORGANIZATION=<org-id>
NCR_SITE_ID=<site-id>
NCR_SHARED_KEY=<shared-key>
NCR_SECRET_KEY=<secret-key>
```

### Pipecat (`pipecat/.env`)
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
ORDER_API_URL=http://localhost:3000

# Production
PUBLIC_URL=https://your-domain.com  # Required for Telnyx WebSocket URL
```

## Pipecat Voice Integration

Python-based voice AI that connects to the TypeScript API.

### Bot Versions

| Bot | Transport | Conversation Style | File |
|-----|-----------|-------------------|------|
| Standard | Daily.co WebRTC | Free-form | `bot.py` |
| Flows | Daily.co WebRTC | Structured states | `bot_flows.py` |
| Telnyx | VOIP/SIP | Free-form | `server_telnyx.py` |
| Telnyx Flows | VOIP/SIP | Structured states | `server_telnyx_flows.py` |

### Setup

**Windows (text-based testing only):**
```bash
cd pipecat
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python test_order.py
```

**WSL/Linux/Mac (full voice mode):**
```bash
cd pipecat
source venv/bin/activate
pip install 'pipecat-ai[daily,openai,deepgram,cartesia,silero]' pipecat-ai-flows httpx python-dotenv pydantic
```

### Running

```bash
# Text-based testing (Windows)
python test_order.py

# Daily.co WebRTC bot
python create_room.py        # Get room URL
python bot.py <room_url>

# Telnyx VOIP (real phone calls)
python server_telnyx.py

# HTTP server for session management
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

### Features

| Feature | Description |
|---------|-------------|
| SmartTurnAnalyzer | AI-powered turn detection for natural pauses |
| Silero VAD | Optimized voice activity detection |
| Idle Detection | Auto-end calls after 5 min silence |
| Call Recording | Optional recording via Daily.co |
| Call Metrics | Track duration, turns, order success |

## NCR API Reference

### Endpoints Used
- `POST /order/3/orders/1` - Create order
- `GET /order/3/orders/1/{id}` - Get order
- `POST /order/3/orders/1/find` - Find orders
- `POST /catalog/v2/items` - Catalog operations

### Authentication
All NCR API requests require HMAC-SHA512 signed headers:
- HTTP method + URL path + content-type + organization
- Signed with: `secretKey + ISO timestamp`
- Header format: `Authorization: AccessKey {sharedKey}:{base64Signature}`

### Valid Enum Values
- **Channel**: `PhoneIn`, `Web`, `Mobile`, `WalkIn`, `DriveThru`, `CallCenter`, `Other`
- **Order Status**: `OrderPlaced`, `OrderReceived`, `InProgress`, `ReadyForPickup`, `Completed`, `Cancelled`
- **Total Type**: `TaxExcluded`, `TaxIncluded`, `Net`

## Telnyx Setup

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

## License

MIT
