# Pipecat Voice Ordering

Voice AI integration for Allstar Wings & Ribs ordering system.

## Architecture

```
[Phone/Browser] → [Daily.co WebRTC] → [Pipecat Pipeline] → [TypeScript API] → [NCR Aloha]
                                            ↓
                                   Deepgram STT
                                        ↓
                                   OpenAI GPT-4o-mini
                                        ↓
                                   ElevenLabs TTS
```

## Setup

1. Create a virtual environment:
```bash
cd pipecat
python -m venv venv
venv\Scripts\activate  # Windows
# source venv/bin/activate  # Mac/Linux
```

2. Install dependencies:
```bash
pip install -r requirements.txt
```

3. Copy `.env.example` to `.env` and fill in your API keys:
```bash
copy .env.example .env
```

Required API keys:
- **Daily.co** - Free tier at https://dashboard.daily.co
- **Deepgram** - Free tier at https://console.deepgram.com
- **OpenAI** - https://platform.openai.com
- **ElevenLabs** - Free tier at https://elevenlabs.io

## Running

### Windows: Text-Based Testing

Daily.co transport doesn't have Windows wheels, so use the text-based test script:

1. Make sure the TypeScript API is running:
```bash
cd .. && npm run server
```

2. Activate venv and run the test:
```bash
venv\Scripts\activate
python test_order.py
```

3. Chat with the assistant to simulate voice ordering!

### Linux/Mac: Full Voice Mode

#### Option 1: Manual Room

1. Make sure the TypeScript API is running:
```bash
cd .. && npm run server
```

2. Create a Daily room:
```bash
python create_room.py
```

3. Start the bot with the room URL:
```bash
python bot_flows.py https://your-domain.daily.co/room-name
```

4. Open the room URL in your browser and start talking!

#### Option 2: HTTP Server

1. Start the voice server:
```bash
python server.py
```

2. Create a session via API:
```bash
curl -X POST http://localhost:8765/sessions
```

3. Join the returned room URL and run the bot.

## Files

- `bot_flows.py` - Pipecat pipeline with structured conversation flow (requires Linux/Mac)
- `server_telnyx_flows.py` - Telnyx VOIP server with enforced workflow states
- `test_order.py` - Text-based test script for Windows development
- `order_assistant.py` - Order extraction logic with function calling
- `order_client.py` - HTTP client for the TypeScript order API
- `create_room.py` - Helper to create Daily.co rooms
- `server.py` - HTTP server for managing voice sessions

## How It Works

1. User joins a Daily.co room (via browser or phone dial-in)
2. Pipecat captures audio and sends it to Deepgram for transcription
3. Transcribed text goes to GPT-4o-mini with our ordering system prompt
4. When the LLM detects a complete order, it calls `submit_order` function
5. We forward the order to our TypeScript API (`POST /orders`)
6. TypeScript API submits to NCR Aloha POS
7. Confirmation is spoken back via ElevenLabs TTS

## Customization

### Change the voice
Edit `ELEVENLABS_VOICE_ID` in `.env`. Find voice IDs at:
https://api.elevenlabs.io/v1/voices

### Modify the assistant personality
Edit `SYSTEM_PROMPT` in `order_assistant.py`

### Add menu items
The assistant fetches the menu from the TypeScript API.
Update `src/data/allstar-menu.ts` to change available items.
