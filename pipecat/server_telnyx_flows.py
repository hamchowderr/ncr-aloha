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

# Cached menu data - fetched once at startup
CACHED_MENU = None


async def fetch_and_cache_menu():
    """Fetch menu from API and cache it globally."""
    global CACHED_MENU
    order_api_url = os.getenv("ORDER_API_URL", "http://localhost:3000")

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(f"{order_api_url}/menu")
            response.raise_for_status()
            CACHED_MENU = response.json()
            logger.info(f"Menu cached successfully: {len(CACHED_MENU.get('items', []))} items, {len(CACHED_MENU.get('categories', []))} categories")
    except Exception as e:
        logger.error(f"Failed to fetch menu at startup: {e}")
        # Set a fallback menu structure
        CACHED_MENU = {
            "categories": ["Wings", "Ribs", "Burgers", "Fries", "Salads", "Hot Dogs", "Desserts"],
            "items": []
        }
        logger.warning("Using fallback menu categories")

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
    "content": """You are Sam, a friendly phone order-taker at Allstar Wings and Ribs in Richmond Hill.

# Voice Output Rules
You are on a phone call. Your responses are spoken aloud via text-to-speech:
- Plain text only. Never use markdown, asterisks, bullet points, or emojis.
- Keep responses to one or two sentences. Ask one question at a time.
- Spell out numbers naturally: say "two pounds" not "2 lbs".
- Use contractions and casual speech: "What'll it be?" not "What will it be?"

# Personality
- Warm, patient, and relaxed like talking to a regular customer.
- Acknowledge what the customer says before moving on.
- Use natural fillers occasionally: "let me see...", "alright...", "got it...".
- If they seem unsure, slow down and offer suggestions.

# Knowledge
- Wings come in one, two, three, or five pound sizes.
- Wing flavors: Honey Garlic, BBQ, Hot, Mild, Salt and Pepper, Lemon Pepper, Jerk, Suicide, Cajun.
- You also have ribs, burgers, appetizers, fries, salads, and hot dogs.

# Guardrails
- Never mention competitors or other restaurants.
- If asked something you dont know, say "Im not sure, let me focus on your order".
- Stay on topic. Gently redirect off-topic conversations back to the order."""
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

    def _get_menu_text(self) -> str:
        """Build menu text from cache for TTS."""
        global CACHED_MENU
        categories = CACHED_MENU.get("categories", []) if CACHED_MENU else []

        if categories:
            main_cats = [c for c in categories if c.lower() != "kids menu"]
            has_kids = any(c.lower() == "kids menu" for c in categories)
            if len(main_cats) > 1:
                cat_text = ", ".join(main_cats[:-1]) + ", and " + main_cats[-1]
            elif main_cats:
                cat_text = main_cats[0]
            else:
                cat_text = "wings, ribs, burgers"
            menu_text = f"We have {cat_text}."
            if has_kids:
                menu_text += " We also have a Kids Menu."
            menu_text += " Our wings are the specialty, they come in one, two, three, or five pound sizes. What sounds good to you?"
        else:
            menu_text = "We have wings, ribs, burgers, fries, salads, hot dogs, and desserts. We also have a Kids Menu. Our wings come in one, two, three, or five pound sizes. What sounds good?"

        return menu_text

    def create_greeting_node(self) -> NodeConfig:
        """Initial greeting node."""
        factory = self  # Capture reference for closure

        async def handle_ready_to_order(args: FlowArgs, flow_manager: FlowManager) -> tuple:
            logger.info("Customer ready to order")
            return ("Great! What would you like to order?", factory.create_order_collection_node())

        async def handle_get_menu(args: FlowArgs, flow_manager: FlowManager) -> tuple:
            """Transition to menu_info node which speaks menu via tts_say."""
            logger.info("Customer asked for menu - transitioning to menu_info node")
            return ("Let me tell you what we have.", factory.create_menu_info_node())

        return {
            "name": "greeting",
            "role_messages": [ROLE_MESSAGE],
            "task_messages": [{
                "role": "system",
                "content": """This is a pickup order. When get_menu is called, READ the full menu result to the customer word for word - do not summarize it."""
            }],
            "pre_actions": [
                {"type": "tts_say", "text": "Hi, thanks for calling Allstar Wings and Ribs! What can I get for you today?"}
            ],
            "functions": [
                FlowsFunctionSchema(
                    name="set_ready_to_order",
                    description="Call this when the customer mentions ANY food item they want to order, says they want to place an order, or tells you what they'd like. Trigger words: wings, ribs, burger, fries, order, hungry, want, get, have.",
                    handler=handle_ready_to_order,
                    properties={},
                    required=[],
                ),
                FlowsFunctionSchema(
                    name="get_menu",
                    description="Call this when the customer asks about the menu, what you have, what's available, or says they're not sure what to order. Say 'let me tell you what we have' before calling. Trigger words: menu, what do you have, options.",
                    handler=handle_get_menu,
                    properties={},
                    required=[],
                )
            ],
        }

    def create_menu_info_node(self) -> NodeConfig:
        """Menu information node - speaks menu via tts_say."""
        factory = self

        async def handle_ready_to_order(args: FlowArgs, flow_manager: FlowManager) -> tuple:
            logger.info("Customer ready to order after hearing menu")
            return ("Great! What would you like?", factory.create_order_collection_node())

        async def handle_repeat_menu(args: FlowArgs, flow_manager: FlowManager) -> tuple:
            return ("Sure, let me repeat that.", factory.create_menu_info_node())

        return {
            "name": "menu_info",
            "task_messages": [{
                "role": "system",
                "content": "You just told the customer about the menu. Wait for them to decide what to order."
            }],
            "pre_actions": [
                {"type": "tts_say", "text": self._get_menu_text()}  # GUARANTEED to be spoken
            ],
            "functions": [
                FlowsFunctionSchema(
                    name="set_ready_to_order",
                    description="Customer mentions a food item or says what they want",
                    handler=handle_ready_to_order,
                    properties={},
                    required=[],
                ),
                FlowsFunctionSchema(
                    name="repeat_menu",
                    description="Customer asks to hear the menu again",
                    handler=handle_repeat_menu,
                    properties={},
                    required=[],
                ),
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
            """Transition to menu_info node which speaks menu via tts_say."""
            logger.info("Customer asked for menu during ordering - transitioning to menu_info node")
            return ("Let me tell you what we have.", factory.create_menu_info_node())

        async def handle_complete_order(args: FlowArgs, flow_manager: FlowManager) -> tuple:
            if not factory.items:
                return ("You haven't ordered anything yet. What would you like?", None)
            return ("Let me confirm your order.", factory.create_order_confirmation_node())

        return {
            "name": "order_collection",
            "task_messages": [{
                "role": "system",
                "content": """Take the customers order. For wings, confirm size and flavor. After each item, ask "Anything else?" When they're done, move to confirmation."""
            }],
            "functions": [
                FlowsFunctionSchema(
                    name="add_item",
                    description="Call this EVERY TIME the customer orders a food item. Use for wings, ribs, burgers, fries, drinks, or any menu item. Extract the item name, quantity, size (for wings: one pound, two pounds, three pounds, or five pounds), and any flavor or modification.",
                    handler=handle_add_item,
                    properties={
                        "item_name": {
                            "type": "string",
                            "description": "The menu item being ordered: wings, ribs, burger, fries, etc."
                        },
                        "quantity": {
                            "type": "integer",
                            "description": "How many of this item. Default is 1."
                        },
                        "size": {
                            "type": "string",
                            "description": "Size for wings only. Must be: one pound, two pounds, three pounds, or five pounds."
                        },
                        "modifiers": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Flavors like honey garlic, BBQ, hot, mild, jerk, cajun, or other modifications."
                        }
                    },
                    required=["item_name"],
                ),
                FlowsFunctionSchema(
                    name="get_menu",
                    description="Call this when customer asks what's on the menu, asks about prices, or wants to know their options. Trigger: menu, prices, what do you have, options.",
                    handler=handle_get_menu,
                    properties={},
                    required=[],
                ),
                FlowsFunctionSchema(
                    name="complete_order",
                    description="Call this when the customer is DONE ordering and doesn't want anything else. Trigger phrases: that's it, that's all, no thanks, nothing else, I'm good, that's everything, no more.",
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
            "task_messages": [{
                "role": "system",
                "content": f"""Read back this order naturally and ask if it sounds right:
{items_text}"""
            }],
            "functions": [
                FlowsFunctionSchema(
                    name="modify_order",
                    description="Call this if the customer wants to CHANGE something, add more items, or remove something. Trigger: change, remove, add, actually, wait, no that's wrong, correction.",
                    handler=handle_modify_order,
                    properties={},
                    required=[],
                ),
                FlowsFunctionSchema(
                    name="confirm_order",
                    description="Call this when the customer CONFIRMS the order is correct. Trigger: yes, yeah, correct, that's right, sounds good, perfect, yep.",
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
            # Guard against duplicate submissions (LLM sometimes calls this twice)
            if factory.order_result is not None:
                logger.warning("Order already submitted, ignoring duplicate call")
                return ("Order already submitted.", None)

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
            "task_messages": [{
                "role": "system",
                "content": """Get the customers name first, then their phone number. Read back the phone number to confirm."""
            }],
            "functions": [
                FlowsFunctionSchema(
                    name="set_customer_info",
                    description="Call this ONLY after you have collected BOTH the customers name AND phone number. You must have asked for and received both pieces of information before calling this function.",
                    handler=handle_set_customer_info,
                    properties={
                        "name": {"type": "string", "description": "The customers first name for the order."},
                        "phone": {"type": "string", "description": "The customers phone number, formatted as digits like 4165551234."}
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
            message = f"""Order placed! Order number is {order_id}. Tell them it will be ready in fifteen to twenty minutes, thank them, and say goodbye."""
        else:
            errors = ", ".join(self.order_result.get("errors", ["Unknown error"])) if self.order_result else "Unknown error"
            message = f"""There was a problem: {errors}. Apologize briefly and end the call."""

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
            "task_messages": [{"role": "system", "content": message}],
            "functions": [
                FlowsFunctionSchema(
                    name="end_call",
                    description="Call this to hang up AFTER you have thanked the customer and said goodbye. This ends the phone call.",
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

        # Start async task to log subprocess output
        async def log_subprocess_output():
            """Monitor subprocess output in background."""
            import asyncio
            while process.poll() is None:
                # Read stdout/stderr without blocking
                if process.stdout:
                    try:
                        line = process.stdout.readline()
                        if line:
                            logger.info(f"[Bot {session_id}] {line.decode().strip()}")
                    except Exception:
                        pass
                if process.stderr:
                    try:
                        line = process.stderr.readline()
                        if line:
                            logger.error(f"[Bot {session_id}] {line.decode().strip()}")
                    except Exception:
                        pass
                await asyncio.sleep(0.1)

            # Log final exit code
            exit_code = process.poll()
            logger.info(f"[Bot {session_id}] Process exited with code {exit_code}")

            # Capture any remaining output
            if process.stdout:
                remaining = process.stdout.read()
                if remaining:
                    for line in remaining.decode().strip().split('\n'):
                        if line:
                            logger.info(f"[Bot {session_id}] {line}")
            if process.stderr:
                remaining = process.stderr.read()
                if remaining:
                    for line in remaining.decode().strip().split('\n'):
                        if line:
                            logger.error(f"[Bot {session_id}] {line}")

        asyncio.create_task(log_subprocess_output())

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

    # Fetch and cache menu data at startup
    logger.info("Fetching menu data...")
    await fetch_and_cache_menu()

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
        "active_calls": len(active_calls),
        "menu_cached": CACHED_MENU is not None,
        "menu_categories": len(CACHED_MENU.get("categories", [])) if CACHED_MENU else 0,
        "menu_items": len(CACHED_MENU.get("items", [])) if CACHED_MENU else 0,
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
            keywords=[
                # Menu items for better recognition
                "wings:2", "ribs:2", "burger:2", "burgers:2", "fries:2",
                "salad:2", "salads:2", "hot dog:2", "hot dogs:2",
                # Flavors
                "honey garlic:2", "BBQ:2", "lemon pepper:2", "jerk:2",
                "cajun:2", "mild:2", "hot:2", "suicide:2",
                # Sizes
                "one pound:2", "two pounds:2", "three pounds:2", "five pounds:2",
                # Common words
                "menu:3", "order:2", "pickup:2",
            ],
        )

        # Cartesia TTS with Sonic-3 for realistic voice
        from pipecat.services.cartesia.tts import CartesiaTTSService

        # Customer Support Lady voice - designed for phone conversations
        # Alternative voices:
        #   Customer Support Man: a167e0f3-df7e-4d52-a9c3-f949145efdab
        #   Helpful Woman: 156fb8d2-335b-4950-9cb3-a2d33befec77
        tts = CartesiaTTSService(
            api_key=os.getenv("CARTESIA_API_KEY"),
            voice_id=os.getenv("CARTESIA_VOICE_ID", "829ccd10-f8b3-43cd-b8a0-4aeaa81f3b30"),
            model="sonic-3",
            sample_rate=8000,
            params=CartesiaTTSService.InputParams(
                speed="slow",  # Slower for clarity on phone
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
        # tts is needed for pre_actions with type "tts_say"
        flow_manager = FlowManager(
            task=task,
            llm=llm,
            context_aggregator=context_aggregator,
            tts=tts,
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
