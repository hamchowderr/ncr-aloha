"""
Telnyx VOIP Server with Pipecat Flows for Allstar Wings & Ribs Voice Ordering

This server uses node-based conversation states for more predictable ordering flow:
- greeting -> order_collection -> order_confirmation -> customer_info -> completion

Features:
- Structured conversation flow with explicit state transitions
- Telnyx WebSocket transport for real phone calls
- Call metrics and transcript tracking
- Daily.co browser voice chat support

Usage:
  1. Start ngrok: ngrok http 8765
  2. Set PUBLIC_URL in .env
  3. Run: python server_telnyx_flows.py
  4. Update the TeXML app's voice_url to your ngrok URL + /texml
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
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import httpx

from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.vad_analyzer import VADParams
from pipecat.frames.frames import EndTaskFrame, TranscriptionFrame, TextFrame
from pipecat.processors.frame_processor import FrameProcessor, FrameDirection
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.serializers.telnyx import TelnyxFrameSerializer
from pipecat.services.cartesia.tts import CartesiaTTSService
from pipecat.services.deepgram.stt import DeepgramSTTService
from pipecat.services.openai.llm import OpenAILLMService
from pipecat.transports.websocket.fastapi import (
    FastAPIWebsocketParams,
    FastAPIWebsocketTransport,
)

# Try to import Pipecat Flows
try:
    from pipecat_flows import FlowManager, FlowArgs, NodeConfig
    FLOWS_AVAILABLE = True
except ImportError:
    FLOWS_AVAILABLE = False
    logger.warning("pipecat-ai-flows not available - install with: pip install pipecat-ai-flows")

from order_client import OrderClient, VoiceOrder, OrderItem, Customer

load_dotenv(override=True)

# Configure logging
logger.remove()
logger.add(sys.stderr, level="DEBUG")

# Get the public URL
PUBLIC_URL = os.getenv("PUBLIC_URL", "")

# Store active calls
active_calls = {}

# Store Daily.co sessions
daily_sessions = {}

# Bot process references
bot_processes = {}


# ============================================================================
# CONVERSATION FLOW NODES
# ============================================================================

ROLE_MESSAGE = {
    "role": "system",
    "content": """You are a friendly voice ordering assistant for Allstar Wings & Ribs restaurant in Richmond Hill.

Keep responses brief and conversational - this is a phone order.
Be warm and helpful, like a real restaurant employee taking orders.
Always confirm what you heard before moving on.
NEVER mention other restaurants. You are Allstar Wings & Ribs."""
}


def create_greeting_node() -> NodeConfig:
    """Initial greeting and order type collection."""
    return {
        "name": "greeting",
        "role_messages": [ROLE_MESSAGE],
        "task_messages": [
            {
                "role": "system",
                "content": """Greet the customer warmly. This is a pickup order.

Say: "Hi! Thanks for calling Allstar Wings and Ribs! What can I get for you today?"

Listen to what they want to order and use set_ready_to_order to proceed."""
            }
        ],
        "functions": [
            {
                "name": "set_ready_to_order",
                "description": "Customer is ready to order - proceed to take their order",
                "parameters": {
                    "type": "object",
                    "properties": {}
                }
            }
        ]
    }


def create_order_collection_node() -> NodeConfig:
    """Collect menu items from customer."""
    return {
        "name": "order_collection",
        "task_messages": [
            {
                "role": "system",
                "content": """Help the customer build their order.

MENU:
- Wings: Original Wings (bone-in breaded), Lord of the Wing (bone-in non-breaded), Boneless Bites
  Sizes: 1 lb ($15.99), 2 lb ($28.99), 3 lb ($40.99), 5 lb ($64.99)
  Flavors: Honey Garlic, BBQ, Hot, Mild, Salt & Pepper, Lemon Pepper, Jerk, Suicide, Cajun

- Ribs: Full Rack ($26.99), Half Rack ($16.99), Rib Tips ($14.99)
  Sauces: House BBQ, Honey Garlic, Jamaican Jerk

- Burgers: Classic Burger ($12.99), Bacon Cheese ($14.99), Mushroom Swiss ($14.99)

- Sides: Fries ($5.99), Onion Rings ($6.99), Coleslaw ($4.99), Caesar Salad ($8.99)

- Drinks: Pop/Soda ($2.99), Bottled Water ($2.49)

GUIDELINES:
- For wings: ALWAYS ask size (suggest 2 lb as popular) and flavor
- Confirm each item as they add it
- When they say "that's it" or similar, use complete_order to move on

Use add_item for each item. Use get_menu if they ask about prices."""
            }
        ],
        "functions": [
            {
                "name": "add_item",
                "description": "Add an item to the order",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "item_name": {
                            "type": "string",
                            "description": "Menu item name (e.g., 'Original Wings', 'Lord of the Wing', 'Boneless Bites', 'Full Rack Ribs')"
                        },
                        "quantity": {
                            "type": "integer",
                            "description": "Number of this item",
                            "default": 1
                        },
                        "size": {
                            "type": "string",
                            "description": "Size for wings (1 lb, 2 lb, 3 lb, 5 lb)"
                        },
                        "modifiers": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Flavors, sauces, or modifications"
                        }
                    },
                    "required": ["item_name"]
                }
            },
            {
                "name": "get_menu",
                "description": "Get full menu with prices if customer asks",
                "parameters": {"type": "object", "properties": {}}
            },
            {
                "name": "complete_order",
                "description": "Customer is done adding items - move to confirmation",
                "parameters": {"type": "object", "properties": {}}
            }
        ]
    }


def create_order_confirmation_node(items: list) -> NodeConfig:
    """Confirm the complete order with customer."""
    items_text = "\n".join([
        f"- {item.get('quantity', 1)}x {item.get('item_name')}" +
        (f" ({item.get('size')})" if item.get('size') else "") +
        (f" - {', '.join(item.get('modifiers', []))}" if item.get('modifiers') else "")
        for item in items
    ])

    return {
        "name": "order_confirmation",
        "task_messages": [
            {
                "role": "system",
                "content": f"""Read back the order and ask customer to confirm:

ORDER:
{items_text}

Say something like: "Let me read that back: [items]. Does that sound right?"

If they want to change something, use modify_order.
If they confirm, use confirm_order."""
            }
        ],
        "functions": [
            {
                "name": "modify_order",
                "description": "Go back to modify the order",
                "parameters": {"type": "object", "properties": {}}
            },
            {
                "name": "confirm_order",
                "description": "Customer confirmed - proceed to collect their info",
                "parameters": {"type": "object", "properties": {}}
            }
        ]
    }


def create_customer_info_node() -> NodeConfig:
    """Collect customer name and phone number."""
    return {
        "name": "customer_info",
        "task_messages": [
            {
                "role": "system",
                "content": """Collect the customer's name and phone number for the order.

Ask: "Can I get a name for the order?"
Then: "And your phone number?"

Read back the phone number to confirm it's correct.

When you have both name and phone, use set_customer_info to submit."""
            }
        ],
        "functions": [
            {
                "name": "set_customer_info",
                "description": "Record customer name and phone, then submit order",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "name": {
                            "type": "string",
                            "description": "Customer's name"
                        },
                        "phone": {
                            "type": "string",
                            "description": "Customer's phone number"
                        }
                    },
                    "required": ["name", "phone"]
                }
            }
        ]
    }


def create_completion_node(order_result: dict) -> NodeConfig:
    """Final confirmation and goodbye."""
    success = order_result.get("success", False)
    order_id = order_result.get("orderId", "")[:8] if order_result.get("orderId") else ""

    if success:
        message = f"""Order placed successfully! Order number: {order_id}

Thank the customer and tell them:
"Your order will be ready in about 15-20 minutes for pickup. Thanks for calling Allstar Wings!"

Then use end_call to finish."""
    else:
        errors = ", ".join(order_result.get("errors", ["Unknown error"]))
        message = f"""There was a problem with the order: {errors}

Apologize and offer to try again. If they want to cancel, use end_call."""

    return {
        "name": "completion",
        "task_messages": [
            {
                "role": "system",
                "content": message
            }
        ],
        "functions": [
            {
                "name": "end_call",
                "description": "End the call after saying goodbye",
                "parameters": {"type": "object", "properties": {}}
            }
        ]
    }


# ============================================================================
# CALL METRICS
# ============================================================================

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
        self.customer_name = None
        self.customer_phone = None
        self.transcript = []

    def add_transcript(self, role: str, content: str):
        """Add a transcript entry."""
        self.transcript.append({
            "role": role,
            "content": content,
            "timestamp": datetime.now().isoformat()
        })
        if role == "user":
            self.turn_count += 1

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
        if self.customer_name:
            logger.info(f"Customer: {self.customer_name}")

    async def submit_to_api(self, order_client: "OrderClient"):
        """Submit call metrics to the backend API."""
        try:
            duration = (self.end_time - self.start_time).total_seconds() if self.end_time else 0
            await order_client.submit_call_metrics({
                "sessionId": self.session_id,
                "fromNumber": self.from_number,
                "toNumber": self.to_number,
                "durationSeconds": duration,
                "turnCount": self.turn_count,
                "orderSubmitted": self.order_submitted,
                "orderId": self.order_id,
                "customerName": self.customer_name,
                "customerPhone": self.customer_phone,
                "transcript": self.transcript,
            })
            logger.info("Call metrics submitted to API")
        except Exception as e:
            logger.error(f"Failed to submit call metrics: {e}")


class TranscriptProcessor(FrameProcessor):
    """Captures transcription and LLM output for call transcript."""

    def __init__(self, metrics: CallMetrics):
        super().__init__()
        self.metrics = metrics

    async def process_frame(self, frame, direction):
        await super().process_frame(frame, direction)

        if isinstance(frame, TranscriptionFrame):
            if frame.text and frame.text.strip():
                self.metrics.add_transcript("user", frame.text)
                logger.debug(f"Transcript [user]: {frame.text}")

        if isinstance(frame, TextFrame):
            if frame.text and frame.text.strip():
                self.metrics.add_transcript("assistant", frame.text)
                logger.debug(f"Transcript [assistant]: {frame.text}")

        await self.push_frame(frame, direction)


# ============================================================================
# FLOW MANAGER WITH ORDER STATE
# ============================================================================

class TelnyxOrderFlowManager:
    """Manages conversation flow and order state for Telnyx calls."""

    def __init__(self, order_client: OrderClient, metrics: CallMetrics):
        self.order_client = order_client
        self.metrics = metrics
        self.flow_manager: Optional[FlowManager] = None
        self.task: Optional[PipelineTask] = None
        self.llm = None

        # Order state
        self.order_type = "pickup"
        self.items = []
        self.customer_name = ""
        self.customer_phone = ""
        self.order_result = None

    def set_task(self, task: PipelineTask, llm):
        """Set the pipeline task and LLM for ending calls."""
        self.task = task
        self.llm = llm

    async def initialize(self, flow_manager: FlowManager):
        """Initialize with FlowManager."""
        self.flow_manager = flow_manager
        flow_manager.state["order_manager"] = self

    async def handle_set_ready_to_order(self, args: FlowArgs) -> tuple:
        """Customer is ready to order."""
        logger.info("Customer ready to order")
        return "Great! What would you like?", create_order_collection_node()

    async def handle_add_item(self, args: FlowArgs) -> tuple:
        """Add item to order."""
        item = {
            "item_name": args.get("item_name", ""),
            "quantity": args.get("quantity", 1),
            "size": args.get("size"),
            "modifiers": args.get("modifiers", [])
        }
        self.items.append(item)

        item_desc = f"{item['quantity']}x {item['item_name']}"
        if item['size']:
            item_desc += f" ({item['size']})"
        if item['modifiers']:
            item_desc += f" with {', '.join(item['modifiers'])}"

        logger.info(f"Added item: {item_desc}")
        return f"Got it, {item_desc}. Anything else?", None  # Stay in same node

    async def handle_get_menu(self, args: FlowArgs) -> tuple:
        """Fetch and return menu."""
        try:
            menu = await self.order_client.get_menu()
            items_by_category = {}
            for item in menu.get("items", []):
                cat = item.get("category", "Other")
                if cat not in items_by_category:
                    items_by_category[cat] = []
                items_by_category[cat].append(item)

            result = ["Here's our menu:"]
            for category, items in items_by_category.items():
                result.append(f"\n{category}:")
                for item in items[:5]:
                    price = item.get("basePrice", 0)
                    result.append(f"  {item['name']}: ${price:.2f}")

            return "\n".join(result), None
        except Exception as e:
            logger.error(f"Failed to fetch menu: {e}")
            return "Sorry, I couldn't get the menu. What would you like to order?", None

    async def handle_complete_order(self, args: FlowArgs) -> tuple:
        """Move to order confirmation."""
        if not self.items:
            return "You haven't ordered anything yet. What would you like?", None

        return "Let me confirm your order.", create_order_confirmation_node(self.items)

    async def handle_modify_order(self, args: FlowArgs) -> tuple:
        """Go back to order collection."""
        return "No problem, what would you like to change?", create_order_collection_node()

    async def handle_confirm_order(self, args: FlowArgs) -> tuple:
        """Order confirmed, get customer info."""
        return "Perfect! Now I just need your name and phone number.", create_customer_info_node()

    async def handle_set_customer_info(self, args: FlowArgs) -> tuple:
        """Set customer info and submit order."""
        self.customer_name = args.get("name", "")
        self.customer_phone = args.get("phone", "")

        # Update metrics
        self.metrics.customer_name = self.customer_name
        self.metrics.customer_phone = self.customer_phone

        logger.info(f"Customer: {self.customer_name}, Phone: {self.customer_phone}")

        # Submit order
        try:
            order = VoiceOrder(
                orderType=self.order_type,
                items=[
                    OrderItem(
                        itemName=item["item_name"],
                        quantity=item.get("quantity", 1),
                        size=item.get("size"),
                        modifiers=item.get("modifiers", [])
                    )
                    for item in self.items
                ],
                customer=Customer(
                    name=self.customer_name,
                    phone=self.customer_phone
                )
            )

            result = await self.order_client.submit_order(order)
            self.order_result = {
                "success": result.success,
                "orderId": result.orderId,
                "errors": result.errors,
                "warnings": result.warnings
            }

            # Update metrics
            if result.success:
                self.metrics.order_submitted = True
                self.metrics.order_id = result.orderId

            logger.info(f"Order submitted: {self.order_result}")

        except Exception as e:
            logger.error(f"Order submission failed: {e}")
            self.order_result = {
                "success": False,
                "errors": [str(e)]
            }

        return "Submitting your order now...", create_completion_node(self.order_result)

    async def handle_end_call(self, args: FlowArgs) -> tuple:
        """Signal end of call."""
        logger.info("End call requested")
        self.metrics.end_time = datetime.now()
        self.metrics.log_summary()

        # Schedule task cancellation after a short delay for goodbye
        if self.task and self.llm:
            async def end_after_delay():
                await asyncio.sleep(3.0)
                await self.llm.push_frame(EndTaskFrame(), FrameDirection.UPSTREAM)
            asyncio.create_task(end_after_delay())

        return "Goodbye!", None


# ============================================================================
# DAILY.CO SUPPORT
# ============================================================================

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
                    "exp": int(datetime.now().timestamp()) + 3600,
                    "enable_chat": False,
                    "start_video_off": True,
                    "enable_recording": os.getenv("ENABLE_RECORDING", "false").lower() == "true",
                }
            },
        )
        response.raise_for_status()
        return response.json()


async def spawn_daily_bot(room_url: str, session_id: str):
    """Spawn a Daily.co bot process."""
    bot_script = "bot_flows.py"  # Use Flows version for Daily too
    script_path = os.path.join(os.path.dirname(__file__), bot_script)

    bot_env = os.environ.copy()
    bot_env["ORDER_API_URL"] = "http://backend:3000"

    try:
        process = subprocess.Popen(
            [sys.executable, script_path, room_url, "", session_id],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=bot_env,
        )
        bot_processes[session_id] = process
        logger.info(f"Spawned Daily Flows bot for session {session_id} (PID: {process.pid})")
        return process.pid
    except Exception as e:
        logger.error(f"Failed to spawn Daily bot: {e}")
        return None


# ============================================================================
# FASTAPI APPLICATION
# ============================================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler."""
    logger.info("Starting Telnyx Voice Server with Pipecat Flows...")
    logger.info(f"Flows available: {FLOWS_AVAILABLE}")
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

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {
        "status": "ok",
        "flows_enabled": FLOWS_AVAILABLE,
        "active_calls": len(active_calls)
    }


@app.post("/texml")
@app.get("/texml")
async def texml_handler(request: Request):
    """Handle incoming calls from Telnyx."""
    form_data = await request.form()
    from_number = form_data.get("From", "unknown")
    to_number = form_data.get("To", "unknown")
    call_sid = form_data.get("CallSid", "unknown")

    logger.info(f"Incoming call: {from_number} -> {to_number} (CallSid: {call_sid})")

    if PUBLIC_URL:
        ws_url = PUBLIC_URL.replace("https://", "wss://").replace("http://", "ws://")
        ws_url = f"{ws_url}/ws"
    else:
        ws_url = "wss://localhost:8765/ws"

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
    """Handle WebSocket connections from Telnyx with Pipecat Flows."""
    if not FLOWS_AVAILABLE:
        logger.error("pipecat-flows not installed! Cannot handle calls.")
        await websocket.close()
        return

    await websocket.accept()
    logger.info("WebSocket connection accepted")

    # Wait for Telnyx start message
    start_message = None
    try:
        for _ in range(5):
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

    # Extract call info
    stream_sid = start_message.get("stream_id", "unknown")
    start_data = start_message.get("start", {})
    call_sid = start_data.get("call_control_id", "unknown")

    custom_params = start_data.get("custom_parameters", {})
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

    # Create flow manager
    order_manager = TelnyxOrderFlowManager(order_client, metrics)

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
            model="gpt-4o-mini",
        )

        # Create FlowManager
        flow_manager = FlowManager(
            llm=llm,
            tts=tts,
        )

        # Register function handlers
        @flow_manager.function_handler("set_ready_to_order")
        async def handle_set_ready_to_order(args: FlowArgs):
            return await order_manager.handle_set_ready_to_order(args)

        @flow_manager.function_handler("add_item")
        async def handle_add_item(args: FlowArgs):
            return await order_manager.handle_add_item(args)

        @flow_manager.function_handler("get_menu")
        async def handle_get_menu(args: FlowArgs):
            return await order_manager.handle_get_menu(args)

        @flow_manager.function_handler("complete_order")
        async def handle_complete_order(args: FlowArgs):
            return await order_manager.handle_complete_order(args)

        @flow_manager.function_handler("modify_order")
        async def handle_modify_order(args: FlowArgs):
            return await order_manager.handle_modify_order(args)

        @flow_manager.function_handler("confirm_order")
        async def handle_confirm_order(args: FlowArgs):
            return await order_manager.handle_confirm_order(args)

        @flow_manager.function_handler("set_customer_info")
        async def handle_set_customer_info(args: FlowArgs):
            return await order_manager.handle_set_customer_info(args)

        @flow_manager.function_handler("end_call")
        async def handle_end_call(args: FlowArgs):
            return await order_manager.handle_end_call(args)

        # Create serializer
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

        # Create transcript processor
        transcript_processor = TranscriptProcessor(metrics)

        # Build pipeline with FlowManager
        pipeline = Pipeline([
            transport.input(),
            stt,
            transcript_processor,
            flow_manager.create_context_aggregator().user(),
            llm,
            tts,
            transport.output(),
            flow_manager.create_context_aggregator().assistant(),
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

        # Give order manager reference to task for ending calls
        order_manager.set_task(task, llm)

        @transport.event_handler("on_client_connected")
        async def on_client_connected(transport, client):
            logger.info("Client connected to Flows pipeline")
            # Initialize flow manager and start greeting
            await order_manager.initialize(flow_manager)
            await flow_manager.initialize(create_greeting_node())

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
        await metrics.submit_to_api(order_client)
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
    """Create a new Daily.co voice session for browser chat."""
    try:
        room = await create_daily_room()
        room_url = room.get("url")
        room_name = room.get("name")

        if not room_url:
            return {"error": "Failed to create room", "details": room}

        session_id = str(uuid.uuid4())
        bot_pid = await spawn_daily_bot(room_url, session_id)

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

    if session.get("bot_pid") and session_id in bot_processes:
        process = bot_processes[session_id]
        if process.poll() is not None:
            session["status"] = "completed"
            session["exit_code"] = process.returncode

    return session


@app.delete("/sessions/{session_id}")
async def end_session(session_id: str):
    """End a Daily.co voice session."""
    if session_id not in daily_sessions:
        return {"error": "Session not found"}

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
        "server_telnyx_flows:app",
        host="0.0.0.0",
        port=8765,
        reload=False,
        log_level="info",
    )
