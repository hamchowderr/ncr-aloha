"""
Telnyx VOIP Server for Allstar Wings & Ribs Voice Ordering

This server:
1. Serves TeXML to Telnyx when a call comes in
2. Accepts WebSocket connections for real-time audio streaming
3. Runs the Pipecat bot for each call
4. Creates Daily.co rooms for browser-based voice chat

Usage:
  1. Start ngrok: ngrok http 8765
  2. Update TEXML_APP_ID with your Telnyx TeXML app ID
  3. Run: python server_telnyx.py
  4. Update the TeXML app's voice_url to your ngrok URL + /texml
  5. Assign a phone number to the TeXML app
  6. Call the number!
"""

import os
import sys
import asyncio
import uuid
import subprocess
from datetime import datetime
from contextlib import asynccontextmanager
from typing import Optional

from dotenv import load_dotenv
from loguru import logger
from fastapi import FastAPI, WebSocket, Request, Response
from fastapi.responses import PlainTextResponse
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import httpx

from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.vad_analyzer import VADParams
from pipecat.frames.frames import LLMMessagesUpdateFrame, EndTaskFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.aggregators.openai_llm_context import OpenAILLMContext
from pipecat.processors.frame_processor import FrameDirection
from pipecat.serializers.telnyx import TelnyxFrameSerializer
from pipecat.services.cartesia.tts import CartesiaTTSService
from pipecat.services.deepgram.stt import DeepgramSTTService
from pipecat.services.openai.llm import OpenAILLMService
from pipecat.services.llm_service import FunctionCallParams
from pipecat.transports.websocket.fastapi import (
    FastAPIWebsocketParams,
    FastAPIWebsocketTransport,
)

from order_assistant import SYSTEM_PROMPT, ORDER_FUNCTIONS, OrderAssistant
from order_client import OrderClient

load_dotenv(override=True)

# Configure logging
logger.remove()
logger.add(sys.stderr, level="DEBUG")

# Get the public URL (set this after starting ngrok)
PUBLIC_URL = os.getenv("PUBLIC_URL", "")

# Store active calls
active_calls = {}

# Store Daily.co sessions
daily_sessions = {}

# Bot process references
bot_processes = {}


async def create_daily_room() -> dict:
    """Create a Daily.co room for browser voice chat."""
    api_key = os.getenv("DAILY_API_KEY")

    if not api_key:
        raise ValueError("DAILY_API_KEY not set in environment")

    async with httpx.AsyncClient() as client:
        response = await client.post(
            "https://api.daily.co/v1/rooms",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "properties": {
                    "exp": 3600,  # 1 hour expiry
                    "enable_chat": False,
                    "start_video_off": True,
                    "enable_recording": os.getenv("ENABLE_RECORDING", "false").lower() == "true",
                }
            },
        )
        response.raise_for_status()
        return response.json()


async def spawn_daily_bot(room_url: str, session_id: str):
    """Spawn a Daily.co bot process for the given room."""
    bot_script = "bot.py"
    script_path = os.path.join(os.path.dirname(__file__), bot_script)

    # Create environment for subprocess
    # Use Docker service name since subprocess runs inside same container
    bot_env = os.environ.copy()
    bot_env["ORDER_API_URL"] = "http://backend:3000"

    try:
        # Spawn bot as subprocess with correct environment
        process = subprocess.Popen(
            [sys.executable, script_path, room_url, "", session_id],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=bot_env,
        )
        bot_processes[session_id] = process
        logger.info(f"Spawned Daily bot for session {session_id} (PID: {process.pid}) with ORDER_API_URL=http://backend:3000")
        return process.pid
    except Exception as e:
        logger.error(f"Failed to spawn Daily bot: {e}")
        return None


class CallMetrics:
    """Track call metrics for observability."""
    def __init__(self, session_id: str, from_number: str, to_number: str):
        self.session_id = session_id
        self.from_number = from_number
        self.to_number = to_number
        self.start_time = datetime.now()
        self.end_time = None
        self.turn_count = 0
        self.order_submitted = False
        self.order_id = None

    def log_summary(self):
        duration = (self.end_time - self.start_time).total_seconds() if self.end_time else 0
        logger.info(f"=== Call Summary ===")
        logger.info(f"Session: {self.session_id}")
        logger.info(f"From: {self.from_number} -> To: {self.to_number}")
        logger.info(f"Duration: {duration:.1f}s")
        logger.info(f"Turns: {self.turn_count}")
        logger.info(f"Order: {'Yes' if self.order_submitted else 'No'}")
        if self.order_id:
            logger.info(f"Order ID: {self.order_id}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler."""
    logger.info("Starting Telnyx Voice Server...")
    logger.info(f"Listening on port 8765")
    if PUBLIC_URL:
        logger.info(f"Public URL: {PUBLIC_URL}")
        logger.info(f"TeXML endpoint: {PUBLIC_URL}/texml")
        logger.info(f"WebSocket endpoint: {PUBLIC_URL}/ws")
    else:
        logger.warning("PUBLIC_URL not set. Run ngrok and set PUBLIC_URL env var.")
    yield
    logger.info("Shutting down...")


app = FastAPI(lifespan=lifespan)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for voice chat
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {"status": "ok", "active_calls": len(active_calls)}


@app.post("/texml")
@app.get("/texml")
async def texml_handler(request: Request):
    """
    Handle incoming calls from Telnyx.
    Returns TeXML that tells Telnyx to open a WebSocket stream.
    """
    # Parse form data from Telnyx
    form_data = await request.form()
    from_number = form_data.get("From", "unknown")
    to_number = form_data.get("To", "unknown")
    call_sid = form_data.get("CallSid", "unknown")

    logger.info(f"Incoming call: {from_number} -> {to_number} (CallSid: {call_sid})")

    # Determine WebSocket URL
    if PUBLIC_URL:
        ws_url = PUBLIC_URL.replace("https://", "wss://").replace("http://", "ws://")
        ws_url = f"{ws_url}/ws"
    else:
        ws_url = "wss://localhost:8765/ws"

    # Return TeXML that opens a WebSocket stream
    texml = f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="{ws_url}" bidirectionalMode="rtp">
      <Parameter name="from" value="{from_number}"/>
      <Parameter name="to" value="{to_number}"/>
      <Parameter name="call_sid" value="{call_sid}"/>
    </Stream>
  </Connect>
  <Pause length="60"/>
</Response>"""

    logger.debug(f"Returning TeXML:\n{texml}")

    return Response(content=texml, media_type="application/xml")


@app.websocket("/ws")
async def websocket_handler(websocket: WebSocket):
    """Handle WebSocket connections from Telnyx for audio streaming."""
    await websocket.accept()

    logger.info("WebSocket connection accepted")

    # Telnyx sends 'connected' first, then 'start'
    start_message = None
    try:
        for _ in range(5):  # Try up to 5 messages to find 'start'
            msg = await asyncio.wait_for(websocket.receive_json(), timeout=10.0)
            logger.debug(f"Received message: {msg}")
            event = msg.get("event", "")
            if event == "connected":
                logger.info("Telnyx WebSocket connected")
                continue
            elif event == "start":
                start_message = msg
                break
            else:
                logger.debug(f"Ignoring event: {event}")
    except asyncio.TimeoutError:
        logger.error("Timeout waiting for start message")
        await websocket.close()
        return
    except Exception as e:
        logger.error(f"Error receiving start message: {e}")
        await websocket.close()
        return

    if not start_message:
        logger.error("Never received 'start' event")
        await websocket.close()
        return

    # Extract from Telnyx message format
    stream_sid = start_message.get("stream_id", "unknown")
    start_data = start_message.get("start", {})
    call_sid = start_data.get("call_control_id", "unknown")

    # Get custom parameters (lowercase in Telnyx)
    custom_params = start_data.get("custom_parameters", {})
    # Also check direct fields in start_data as fallback
    from_number = custom_params.get("from") or start_data.get("from", "unknown")
    to_number = custom_params.get("to") or start_data.get("to", "unknown")

    logger.info(f"Stream started: {stream_sid}")
    logger.info(f"Call: {from_number} -> {to_number}")

    session_id = datetime.now().strftime("%Y%m%d_%H%M%S")
    metrics = CallMetrics(session_id, from_number, to_number)
    active_calls[stream_sid] = metrics

    # Initialize order client
    order_api_url = os.getenv("ORDER_API_URL", "http://host.docker.internal:3000")
    order_client = OrderClient(order_api_url)
    order_assistant = OrderAssistant(order_client)

    try:
        # Initialize services
        stt = DeepgramSTTService(
            api_key=os.getenv("DEEPGRAM_API_KEY"),
            model="nova-2-phonecall",
            language="en-US",
        )

        tts = CartesiaTTSService(
            api_key=os.getenv("CARTESIA_API_KEY"),
            voice_id=os.getenv("CARTESIA_VOICE_ID", "79a125e8-cd45-4c13-8a67-188112f4dd22"),
            model="sonic-english",
            sample_rate=8000,
        )

        llm = OpenAILLMService(
            api_key=os.getenv("OPENAI_API_KEY"),
            model="gpt-4o",  # Better instruction following than Groq Llama
        )

        # Register function handlers using FunctionCallParams pattern
        async def handle_get_menu(params: FunctionCallParams):
            logger.info(f"Function call: {params.function_name}")
            result = await order_assistant.handle_function_call("get_menu", {})
            await params.result_callback(result)

        async def handle_add_item(params: FunctionCallParams):
            logger.info(f"Function call: {params.function_name} with {params.arguments}")
            result = await order_assistant.handle_function_call("add_item", params.arguments)
            await params.result_callback(result)

        async def handle_remove_item(params: FunctionCallParams):
            logger.info(f"Function call: {params.function_name} with {params.arguments}")
            result = await order_assistant.handle_function_call("remove_item", params.arguments)
            await params.result_callback(result)

        async def handle_get_order_summary(params: FunctionCallParams):
            logger.info(f"Function call: {params.function_name}")
            result = await order_assistant.handle_function_call("get_order_summary", {})
            await params.result_callback(result)

        async def handle_submit_order(params: FunctionCallParams):
            logger.info(f"Function call: {params.function_name} with {params.arguments}")
            result = await order_assistant.handle_function_call("submit_order", params.arguments)
            if "ORDER_SUCCESS" in result:
                metrics.order_submitted = True
                if order_assistant.last_order_result:
                    metrics.order_id = order_assistant.last_order_result.orderId
            await params.result_callback(result)

        async def handle_end_call(params: FunctionCallParams):
            logger.info("End call requested")
            metrics.end_time = datetime.now()
            metrics.log_summary()
            await params.result_callback("Ending call now.")
            await llm.push_frame(EndTaskFrame(), FrameDirection.UPSTREAM)

        # Register all functions with the LLM
        llm.register_function("get_menu", handle_get_menu)
        llm.register_function("add_item", handle_add_item)
        llm.register_function("remove_item", handle_remove_item)
        llm.register_function("get_order_summary", handle_get_order_summary)
        llm.register_function("submit_order", handle_submit_order)
        llm.register_function("end_call", handle_end_call)

        # Create serializer - Telnyx uses PCMU (G.711 µ-law) encoding
        serializer = TelnyxFrameSerializer(
            stream_id=stream_sid,
            outbound_encoding="PCMU",
            inbound_encoding="PCMU",
            call_control_id=call_sid,
            api_key=os.getenv("TELNYX_API_KEY"),
        )

        # Create transport
        transport = FastAPIWebsocketTransport(
            websocket=websocket,
            params=FastAPIWebsocketParams(
                audio_in_enabled=True,
                audio_out_enabled=True,
                add_wav_header=False,
                vad_analyzer=SileroVADAnalyzer(
                    params=VADParams(
                        confidence=0.7,
                        start_secs=0.2,
                        stop_secs=0.8,
                        min_volume=0.6,
                    )
                ),
                serializer=serializer,
            ),
        )

        # Set up context
        messages = [{"role": "system", "content": SYSTEM_PROMPT}]
        context = OpenAILLMContext(messages, ORDER_FUNCTIONS)
        context_aggregator = llm.create_context_aggregator(context)

        # Build pipeline
        pipeline = Pipeline([
            transport.input(),
            stt,
            context_aggregator.user(),
            llm,
            tts,
            transport.output(),
            context_aggregator.assistant(),
        ])

        task = PipelineTask(
            pipeline,
            params=PipelineParams(
                audio_in_sample_rate=8000,
                audio_out_sample_rate=8000,
                allow_interruptions=True,
                enable_metrics=True,
            ),
        )

        @transport.event_handler("on_client_connected")
        async def on_client_connected(transport, client):
            logger.info("Client connected to pipeline")
            # Add greeting prompt and trigger LLM response
            greeting_message = {
                "role": "user",
                "content": "[Customer just answered the phone. Give a friendly, natural greeting.]"
            }
            await task.queue_frames([LLMMessagesUpdateFrame(messages=[greeting_message], run_llm=True)])

        @transport.event_handler("on_client_disconnected")
        async def on_client_disconnected(transport, client):
            logger.info("Client disconnected")
            metrics.end_time = datetime.now()
            await task.cancel()

        # Run the pipeline
        runner = PipelineRunner(handle_sigint=False)
        await runner.run(task)

    except Exception as e:
        logger.error(f"Error in call handling: {e}")
        import traceback
        traceback.print_exc()
    finally:
        metrics.end_time = datetime.now()
        metrics.log_summary()
        await order_client.close()
        if stream_sid in active_calls:
            del active_calls[stream_sid]
        logger.info(f"Call ended: {stream_sid}")


@app.get("/calls")
async def list_calls():
    """List active calls."""
    return {
        "active_calls": [
            {
                "stream_id": sid,
                "from": m.from_number,
                "to": m.to_number,
                "duration": (datetime.now() - m.start_time).total_seconds(),
            }
            for sid, m in active_calls.items()
        ]
    }


# ==========================================
# Daily.co Browser Voice Chat Endpoints
# ==========================================

@app.post("/sessions")
async def create_session(request: Request):
    """
    Create a new Daily.co voice session for browser chat.

    Returns room URL that the client can use to join the voice call.
    """
    try:
        # Create Daily.co room
        room = await create_daily_room()
        room_url = room.get("url")
        room_name = room.get("name")

        if not room_url:
            return {"error": "Failed to create room", "details": room}

        session_id = str(uuid.uuid4())

        # Spawn bot for this room
        bot_pid = await spawn_daily_bot(room_url, session_id)

        # Track session
        daily_sessions[session_id] = {
            "session_id": session_id,
            "room_url": room_url,
            "room_name": room_name,
            "status": "bot_running" if bot_pid else "waiting_for_bot",
            "bot_pid": bot_pid,
            "created_at": datetime.now().isoformat(),
        }

        logger.info(f"Daily session created: {session_id} (room: {room_name})")

        return {
            "session_id": session_id,
            "room_url": room_url,
            "room_name": room_name,
            "status": daily_sessions[session_id]["status"],
        }

    except httpx.HTTPStatusError as e:
        logger.error(f"Daily API error: {e}")
        return {"error": "Failed to create Daily.co room", "details": str(e)}
    except Exception as e:
        logger.error(f"Session creation error: {e}")
        return {"error": str(e)}


@app.get("/sessions/{session_id}")
async def get_session(session_id: str):
    """Get the status of a Daily.co voice session."""
    if session_id not in daily_sessions:
        return {"error": "Session not found"}

    session = daily_sessions[session_id]

    # Check if bot process is still running
    if session.get("bot_pid") and session_id in bot_processes:
        process = bot_processes[session_id]
        if process.poll() is not None:
            # Process has exited
            session["status"] = "completed"
            session["exit_code"] = process.returncode

    return session


@app.delete("/sessions/{session_id}")
async def end_session(session_id: str):
    """End a Daily.co voice session and terminate the bot."""
    if session_id not in daily_sessions:
        return {"error": "Session not found"}

    # Terminate bot process if running
    if session_id in bot_processes:
        process = bot_processes[session_id]
        if process.poll() is None:
            process.terminate()
            logger.info(f"Terminated Daily bot for session {session_id}")

    daily_sessions[session_id]["status"] = "ended"

    return {
        "session_id": session_id,
        "status": "ended"
    }


@app.get("/sessions")
async def list_sessions():
    """List all Daily.co voice sessions."""
    return {"sessions": list(daily_sessions.values())}


if __name__ == "__main__":
    uvicorn.run(
        "server_telnyx:app",
        host="0.0.0.0",
        port=8765,
        reload=False,
        log_level="info",
    )
