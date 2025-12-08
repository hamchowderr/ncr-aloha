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
    from pipecat_flows import FlowManager, FlowArgs, FlowsFunctionSchema, NodeConfig
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
# CONVERSATION FLOW NODES - Using new pipecat-flows API with FlowsFunctionSchema
# ============================================================================

ROLE_MESSAGE = {
    "role": "system",
    "content": """You are a friendly, relaxed voice ordering assistant for Allstar Wings & Ribs restaurant in Richmond Hill.

CONVERSATION STYLE:
- Speak naturally and warmly, like chatting with a regular customer
- Use short, simple sentences. Pause between thoughts.
- Don't rush. Take your time. Be patient.
- Say "um" or "let me see" occasionally to sound human
- Respond to what the customer says before moving on
- If they seem confused, slow down and clarify

CRITICAL RULES:
- NEVER use markdown formatting (no asterisks, no bold, no lists)
- Wing sizes are in POUNDS (1, 2, 3, or 5 pounds)
- NEVER mention other restaurants
- Use get_menu tool when customers ask about items or prices

EXAMPLE NATURAL RESPONSES:
- "Got it... two pounds of wings, honey garlic. Anything else?"
- "Sure thing! And what flavor would you like on those?"
- "Alright, let me make sure I have this right..."
- "No problem! Take your time."""
}


# ============================================================================
# NODE FACTORY CLASS - Creates nodes with embedded handlers
# ============================================================================

class FlowNodeFactory:
    """Creates flow nodes with proper handlers for the new pipecat-flows API."""

    def __init__(self, order_client: OrderClient, metrics: "CallMetrics"):
        self.order_client = order_client
        self.metrics = metrics
        self.items = []
        self.customer_name = ""
        self.customer_phone = ""
        self.order_result = None
        self.flow_manager = None
        self.task = None
        self.llm = None

    def set_refs(self, flow_manager, task, llm):
        """Set references needed for ending calls."""
        self.flow_manager = flow_manager
        self.task = task
        self.llm = llm

    def create_greeting_node(self) -> NodeConfig:
        """Initial greeting node."""
        factory = self  # Capture reference for closure

        async def handle_ready_to_order(args: FlowArgs, flow_manager: FlowManager) -> tuple:
            logger.info("Customer ready to order")
            return ("Great! What would you like to order?", factory.create_order_collection_node())

        async def handle_get_menu(args: FlowArgs, flow_manager: FlowManager) -> tuple:
            """Fetch menu from API and return formatted for voice."""
            try:
                menu = await factory.order_client.get_menu()
                items_by_category = {}
                for item in menu.get("items", []):
                    cat = item.get("category", "Other")
                    if cat not in items_by_category:
                        items_by_category[cat] = []
                    items_by_category[cat].append(item)

                # Format for voice - no markdown!
                result = ["Here's what we have:"]
                for category, items in items_by_category.items():
                    result.append(f"For {category}:")
                    item_names = [item['name'] for item in items[:5]]
                    result.append(", ".join(item_names) + ".")

                return (" ".join(result) + " What sounds good to you?", None)
            except Exception as e:
                logger.error(f"Failed to fetch menu: {e}")
                # Fallback to basic menu info
                return ("We have wings, ribs, burgers, appetizers, fries, salads, hot dogs, and more. Our wings are our specialty - they come in one pound, two pounds, three pounds, or five pounds with lots of flavor options. What would you like?", None)

        return {
            "name": "greeting",
            "role_messages": [ROLE_MESSAGE],
            "task_messages": [{
                "role": "system",
                "content": """The customer just called. This is a pickup order.

WAIT for the greeting to finish, then listen to what they say.

If they ask about the menu, use get_menu to fetch it.
If they ask about flavors, tell them: Honey Garlic, BBQ, Hot, Mild, Salt and Pepper, Lemon Pepper, Jerk, Suicide, and Cajun.
If they ask about sizes, wings come in: 1 pound, 2 pounds, 3 pounds, or 5 pounds.

When they say what they want to order, use set_ready_to_order to proceed.

Remember: Be patient, don't rush them."""
            }],
            "pre_actions": [
                {"type": "tts_say", "text": "Hi there! Thanks for calling Allstar Wings and Ribs. What can I get for you?"}
            ],
            "functions": [
                FlowsFunctionSchema(
                    name="set_ready_to_order",
                    description="Customer mentions what they want to order or is ready to order",
                    handler=handle_ready_to_order,
                    properties={},
                    required=[],
                ),
                FlowsFunctionSchema(
                    name="get_menu",
                    description="Get the full menu with items and prices. Use when customer asks what's on the menu or asks about prices.",
                    handler=handle_get_menu,
                    properties={},
                    required=[],
                )
            ],
        }

    def create_order_collection_node(self) -> NodeConfig:
        """Order collection node."""
        factory = self  # Capture reference for closure

        async def handle_add_item(args: FlowArgs, flow_manager: FlowManager) -> tuple:
            item = {
                "item_name": args.get("item_name", ""),
                "quantity": args.get("quantity", 1),
                "size": args.get("size"),
                "modifiers": args.get("modifiers", [])
            }
            factory.items.append(item)

            # Build natural voice response
            item_desc = f"{item['quantity']} {item['item_name']}"
            if item['size']:
                item_desc += f", {item['size']}"
            if item['modifiers']:
                item_desc += f" with {', '.join(item['modifiers'])}"

            logger.info(f"Added item: {item_desc}")
            return (f"Got it, {item_desc}. Anything else?", None)  # Stay in same node

        async def handle_get_menu(args: FlowArgs, flow_manager: FlowManager) -> tuple:
            """Fetch menu from API and return formatted for voice."""
            try:
                menu = await factory.order_client.get_menu()
                items_by_category = {}
                for item in menu.get("items", []):
                    cat = item.get("category", "Other")
                    if cat not in items_by_category:
                        items_by_category[cat] = []
                    items_by_category[cat].append(item)

                # Format for voice - no markdown!
                result = ["Here's what we have:"]
                for category, items in items_by_category.items():
                    result.append(f"For {category}:")
                    item_names = [item['name'] for item in items[:5]]
                    result.append(", ".join(item_names) + ".")

                return (" ".join(result) + " What would you like?", None)
            except Exception as e:
                logger.error(f"Failed to fetch menu: {e}")
                return ("We have wings, ribs, burgers, appetizers, fries, salads, hot dogs, and more. What would you like?", None)

        async def handle_complete_order(args: FlowArgs, flow_manager: FlowManager) -> tuple:
            if not factory.items:
                return ("You haven't ordered anything yet. What would you like?", None)
            return ("Let me confirm your order.", factory.create_order_confirmation_node())

        return {
            "name": "order_collection",
            "role_messages": [ROLE_MESSAGE],
            "task_messages": [{
                "role": "system",
                "content": """Help the customer build their order. Use get_menu if they ask about menu items or prices.

ORDERING GUIDELINES:
- For wings: Ask what SIZE in pounds (1, 2, 3, or 5 pounds) and what FLAVOR they want
- Wing flavors: Honey Garlic, BBQ, Hot, Mild, Salt and Pepper, Lemon Pepper, Jerk, Suicide, Cajun
- Confirm each item back naturally after adding
- When they say "that's it", "that's all", or "no" to "anything else?", use complete_order

IMPORTANT: Speak naturally, no markdown or special formatting."""
            }],
            "functions": [
                FlowsFunctionSchema(
                    name="add_item",
                    description="Add an item to the order",
                    handler=handle_add_item,
                    properties={
                        "item_name": {
                            "type": "string",
                            "description": "Menu item name"
                        },
                        "quantity": {
                            "type": "integer",
                            "description": "Number of this item"
                        },
                        "size": {
                            "type": "string",
                            "description": "Size for wings (1 lb, 2 lb, 3 lb, 5 lb)"
                        },
                        "modifiers": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Flavors or modifications"
                        }
                    },
                    required=["item_name"],
                ),
                FlowsFunctionSchema(
                    name="get_menu",
                    description="Get full menu with items and prices. Use when customer asks about menu or prices.",
                    handler=handle_get_menu,
                    properties={},
                    required=[],
                ),
                FlowsFunctionSchema(
                    name="complete_order",
                    description="Customer is done adding items",
                    handler=handle_complete_order,
                    properties={},
                    required=[],
                )
            ],
        }

    def create_order_confirmation_node(self) -> NodeConfig:
        """Order confirmation node."""
        factory = self  # Capture reference for closure
        items_text = "\n".join([
            f"- {item.get('quantity', 1)}x {item.get('item_name')}" +
            (f" ({item.get('size')})" if item.get('size') else "") +
            (f" - {', '.join(item.get('modifiers', []))}" if item.get('modifiers') else "")
            for item in self.items
        ])

        async def handle_modify_order(args: FlowArgs, flow_manager: FlowManager) -> tuple:
            return ("No problem, what would you like to change?", factory.create_order_collection_node())

        async def handle_confirm_order(args: FlowArgs, flow_manager: FlowManager) -> tuple:
            return ("Perfect! Now I just need your name and phone number.", factory.create_customer_info_node())

        return {
            "name": "order_confirmation",
            "role_messages": [ROLE_MESSAGE],
            "task_messages": [{
                "role": "system",
                "content": f"""Read back the order and ask customer to confirm:

ORDER:
{items_text}

Say something like: "Let me read that back: [items]. Does that sound right?"

If they want to change something, use modify_order.
If they confirm, use confirm_order."""
            }],
            "functions": [
                FlowsFunctionSchema(
                    name="modify_order",
                    description="Go back to modify the order",
                    handler=handle_modify_order,
                    properties={},
                    required=[],
                ),
                FlowsFunctionSchema(
                    name="confirm_order",
                    description="Customer confirmed order",
                    handler=handle_confirm_order,
                    properties={},
                    required=[],
                )
            ],
        }

    def create_customer_info_node(self) -> NodeConfig:
        """Customer info collection node."""
        factory = self  # Capture reference for closure

        async def handle_set_customer_info(args: FlowArgs, flow_manager: FlowManager) -> tuple:
            factory.customer_name = args.get("name", "")
            factory.customer_phone = args.get("phone", "")

            # Update metrics
            factory.metrics.customer_name = factory.customer_name
            factory.metrics.customer_phone = factory.customer_phone

            logger.info(f"Customer: {factory.customer_name}, Phone: {factory.customer_phone}")

            # Submit order
            try:
                order = VoiceOrder(
                    orderType="pickup",
                    items=[
                        OrderItem(
                            itemName=item["item_name"],
                            quantity=item.get("quantity", 1),
                            size=item.get("size"),
                            modifiers=item.get("modifiers", [])
                        )
                        for item in factory.items
                    ],
                    customer=Customer(
                        name=factory.customer_name,
                        phone=factory.customer_phone
                    )
                )

                result = await factory.order_client.submit_order(order)
                factory.order_result = {
                    "success": result.success,
                    "orderId": result.orderId,
                    "errors": result.errors
                }

                if result.success:
                    factory.metrics.order_submitted = True
                    factory.metrics.order_id = result.orderId

                logger.info(f"Order submitted: {factory.order_result}")

            except Exception as e:
                logger.error(f"Order submission failed: {e}")
                factory.order_result = {"success": False, "errors": [str(e)]}

            return ("Submitting your order now...", factory.create_completion_node())

        return {
            "name": "customer_info",
            "role_messages": [ROLE_MESSAGE],
            "task_messages": [{
                "role": "system",
                "content": """Collect the customer's name and phone number for the order.

Ask: "Can I get a name for the order?"
Then: "And what's your phone number?"

Read back the phone number to confirm it's correct.

When you have both name and phone, use set_customer_info to submit."""
            }],
            "functions": [
                FlowsFunctionSchema(
                    name="set_customer_info",
                    description="Record customer name and phone, submit order",
                    handler=handle_set_customer_info,
                    properties={
                        "name": {"type": "string", "description": "Customer's name"},
                        "phone": {"type": "string", "description": "Customer's phone number"}
                    },
                    required=["name", "phone"],
                )
            ],
        }

    def create_completion_node(self) -> NodeConfig:
        """Completion node."""
        factory = self  # Capture reference for closure
        success = self.order_result.get("success", False) if self.order_result else False
        order_id = self.order_result.get("orderId", "")[:8] if self.order_result and self.order_result.get("orderId") else ""

        if success:
            message = f"""Order placed successfully! Order number: {order_id}

Thank the customer and tell them:
"Your order will be ready in about 15-20 minutes for pickup. Thanks for calling Allstar Wings!"

Then use end_call to finish."""
        else:
            errors = ", ".join(self.order_result.get("errors", ["Unknown error"])) if self.order_result else "Unknown error"
            message = f"""There was a problem with the order: {errors}

Apologize and offer to try again. If they want to cancel, use end_call."""

        async def handle_end_call(args: FlowArgs, flow_manager: FlowManager) -> tuple:
            logger.info("End call requested")
            factory.metrics.end_time = datetime.now()
            factory.metrics.log_summary()

            # Schedule task end after goodbye
            if factory.task and factory.llm:
                async def end_after_delay():
                    await asyncio.sleep(3.0)
                    await factory.llm.push_frame(EndTaskFrame(), FrameDirection.UPSTREAM)
                asyncio.create_task(end_after_delay())

            return ("Goodbye!", None)

        return {
            "name": "completion",
            "role_messages": [ROLE_MESSAGE],
            "task_messages": [{"role": "system", "content": message}],
            "functions": [
                FlowsFunctionSchema(
                    name="end_call",
                    description="End the call after saying goodbye",
                    handler=handle_end_call,
                    properties={},
                    required=[],
                )
            ],
        }


# Keep old functions for backward compatibility but they won't be used
def create_greeting_node() -> NodeConfig:
    """Deprecated - use FlowNodeFactory instead."""
    pass


def create_order_collection_node() -> NodeConfig:
    """Deprecated - use FlowNodeFactory instead."""
    pass


def create_order_confirmation_node(items: list) -> NodeConfig:
    """Deprecated - use FlowNodeFactory instead."""
    pass


def create_customer_info_node() -> NodeConfig:
    """Deprecated - use FlowNodeFactory instead."""
    pass


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

    # Create node factory (new API with FlowsFunctionSchema)
    node_factory = FlowNodeFactory(order_client, metrics)

    try:
        # Initialize services
        stt = DeepgramSTTService(
            api_key=os.getenv("DEEPGRAM_API_KEY"),
            model="nova-2-phonecall",
            language="en-US",
        )

        # Import Cartesia params for voice control
        from pipecat.services.cartesia.tts import CartesiaTTSService

        tts = CartesiaTTSService(
            api_key=os.getenv("CARTESIA_API_KEY"),
            voice_id=os.getenv("CARTESIA_VOICE_ID", "79a125e8-cd45-4c13-8a67-188112f4dd22"),
            model="sonic-2024-10-19",  # Use sonic model with speed control
            sample_rate=8000,
            params=CartesiaTTSService.InputParams(
                speed="slow",  # Slower, more natural pacing
            ),
        )

        llm = OpenAILLMService(
            api_key=os.getenv("OPENAI_API_KEY"),
            model="gpt-4o-mini",
        )

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
                        confidence=0.6,      # Slightly more sensitive to speech
                        start_secs=0.3,      # Wait a bit longer before starting to listen
                        stop_secs=1.2,       # Wait longer before assuming user finished (was 0.8)
                        min_volume=0.5,      # More sensitive to quieter speech
                    )
                ),
                serializer=serializer,
            ),
        )

        # Create transcript processor
        transcript_processor = TranscriptProcessor(metrics)

        # Create context aggregator for FlowManager (new API)
        from pipecat.processors.aggregators.openai_llm_context import OpenAILLMContext
        context = OpenAILLMContext()
        context_aggregator = llm.create_context_aggregator(context)

        # Build pipeline first (needed for FlowManager)
        pipeline = Pipeline([
            transport.input(),
            stt,
            transcript_processor,
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

        # Create FlowManager with new API (requires task and context_aggregator)
        # Handlers are embedded in nodes via FlowsFunctionSchema
        flow_manager = FlowManager(
            task=task,
            llm=llm,
            context_aggregator=context_aggregator,
        )

        # Give node factory references for ending calls
        node_factory.set_refs(flow_manager, task, llm)

        @transport.event_handler("on_client_connected")
        async def on_client_connected(transport, client):
            logger.info("Client connected to Flows pipeline")
            # Initialize flow manager with greeting node (handlers embedded in node)
            await flow_manager.initialize(node_factory.create_greeting_node())

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
