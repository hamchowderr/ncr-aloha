# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

NCR Aloha Voice Ordering Integration - bridges voice AI (Pipecat) with NCR Aloha POS via BSP APIs. Enables voice-based food ordering via phone calls (Telnyx VOIP).

## Commands

### Backend (TypeScript/Express - port 3000)
```bash
npm install              # Install dependencies
npm run dev              # Development with hot reload
npm run server           # Start server once
npm run build            # Compile TypeScript
npm run test:api         # Test API endpoints
```

### Frontend (React/Vite - port 5173)
```bash
cd web
npm install
npm run dev              # Dev server
npm run build            # Production build to dist/
npm run lint             # ESLint
```

### Voice Bot (Python/Pipecat - port 8765)
```bash
cd pipecat
python -m venv venv && source venv/bin/activate  # Linux/Mac
# or: python -m venv venv && venv\Scripts\activate  # Windows
pip install -r requirements.txt
pip install 'pipecat-ai[daily,openai,deepgram,cartesia,silero]' pipecat-ai-flows

python test_order.py              # Text-based testing
python server_telnyx_flows.py     # Telnyx VOIP server
```

### Docker
```bash
docker compose up -d --build                                    # Start all
docker compose build pipecat && docker compose up -d pipecat    # Rebuild pipecat
docker logs ncr-pipecat -f                                      # View logs
docker logs ncr-backend -f
```

## Architecture

### Services
1. **Backend** (`src/`, port 3000): Express API - orders, menu, NCR integration
2. **Frontend** (`web/`, port 5173 dev): React menu UI with cart
3. **Voice Bot** (`pipecat/`, port 8765): Python Pipecat handling phone calls via Telnyx

### Voice Call Flow
```
Phone Call → Telnyx → WebSocket → Pipecat Bot → POST /orders → NCR API
                                      ↓
                           Deepgram STT → GPT-4o → Cartesia TTS
```

### Order Processing Pipeline
1. Voice AI produces a `VoiceOrder` (customer info, items with spoken names)
2. `MenuMatcher` fuzzy-matches spoken items to actual menu items
3. `OrderBuilder` converts to NCR `CreateOrderRequest` format
4. `OrderService.submitOrder()` sends to NCR API

### Conversation State Machine (Pipecat Flows)
```
greeting → order_collection → order_confirmation → customer_info → completion
```

### Key Files
**Backend:**
- `src/server.ts` - Express endpoints (/menu, /orders, /health, /calls)
- `src/routes/admin.ts` - Admin API routes (protected by X-API-Key header)
- `src/middleware/api-key.ts` - API key authentication middleware
- `src/auth/hmac.ts` - HMAC-SHA512 signing for NCR APIs
- `src/services/order-service.ts` - Order processing
- `src/services/menu-matcher.ts` - Fuzzy matching spoken items to menu
- `src/data/allstar-menu.ts` - Menu data

**Pipecat:**
- `pipecat/server_telnyx_flows.py` - Main Telnyx VOIP server with Flows state machine
- `pipecat/order_client.py` - HTTP client to TypeScript backend

**Frontend:**
- `web/src/router.tsx` - React Router configuration
- `web/src/App.tsx` - Customer-facing menu UI with cart
- `web/src/layouts/AdminLayout.tsx` - Admin dashboard layout
- `web/src/pages/admin/` - Admin pages (Dashboard, Sites, Orders, Menu)
- `web/src/hooks/useMenu.ts`, `useCart.ts`, `useOrders.ts`, `useSites.ts`

### API Routes

**Public:**
```
GET  /health              - Health check
GET  /menu                - Full menu
POST /orders              - Submit order
GET  /orders/:orderId     - Get order status
POST /calls               - Submit call metrics (from Pipecat)
GET  /calls               - Get call history with summary stats
```

**Admin (requires X-API-Key header):**
```
GET  /admin/sites              - List sites
GET  /admin/orders             - List orders
GET  /admin/orders/:orderId    - Get order details
POST /admin/orders/:orderId/acknowledge - Acknowledge order
PATCH /admin/orders/:orderId   - Update order status
POST/PUT/DELETE /admin/menu/*  - Menu CRUD operations
```

### Frontend Routes
- `/` - Customer menu UI with cart
- `/admin` - Admin dashboard
- `/admin/sites` - Site management
- `/admin/menu` - Menu management
- `/admin/orders` - Order list
- `/admin/orders/:orderId` - Order details

## Pipecat Flows API Pattern
```python
# FlowManager requires task and context_aggregator
context = OpenAILLMContext()
context_aggregator = llm.create_context_aggregator(context)
task = PipelineTask(pipeline, params=PipelineParams(...))
flow_manager = FlowManager(task=task, llm=llm, context_aggregator=context_aggregator, tts=tts)

# Handlers embedded in nodes via FlowsFunctionSchema
FlowsFunctionSchema(name="add_item", handler=async_handler, properties={...})
```

## Environment Variables

### Backend (.env.production for Docker)
```
NCR_API_GATEWAY, NCR_ORGANIZATION, NCR_SITE_ID, NCR_SHARED_KEY, NCR_SECRET_KEY
ADMIN_API_KEY  # Required for /admin/* routes in production
```

### Pipecat (pipecat/.env.production for Docker)
```
TELNYX_API_KEY, DEEPGRAM_API_KEY, OPENAI_API_KEY, CARTESIA_API_KEY, CARTESIA_VOICE_ID
ORDER_API_URL=http://backend:3000  # Use Docker service name
PUBLIC_URL=https://your-domain.com  # Required for Telnyx WebSocket URL
```

## Deployment

Production runs on VPS at `/var/www/ncr-aloha`:
- Nginx serves frontend static files from `web/dist/`
- Nginx proxies: `/menu`, `/health` → backend:3000; `/admin/*` → backend:3000; `/ws`, `/texml` → pipecat:8765
- Docker containers: `ncr-backend` (port 3000), `ncr-pipecat` (port 8765)

Deploy:
```bash
cd /var/www/ncr-aloha
git pull origin master
cd web && npm install && npm run build  # Rebuild frontend
docker compose build && docker compose up -d --force-recreate
```

## NCR API Authentication

All NCR API requests use HMAC-SHA512 signed headers:
- Signature input: `METHOD\nPATH\nCONTENT-TYPE\nCONTENT-MD5\nORGANIZATION`
- Signing key: `secretKey + ISO timestamp`
- Header: `Authorization: AccessKey {sharedKey}:{base64Signature}`
