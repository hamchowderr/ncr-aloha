"""
Pipecat voice ordering bot using Pipecat Flows for structured conversations.

This version uses node-based conversation states for more predictable ordering flow:
- greeting → order_collection → order_confirmation → customer_info → completion

Features:
- Structured conversation flow with explicit state transitions
- SmartTurnAnalyzer for natural turn detection
- Comprehensive error handling and recovery
- Call metrics and observability

NOTE: Requires pipecat-flows package: pip install pipecat-flows
"""

import os
import asyncio
import logging
from datetime import datetime
from typing import Optional
from dotenv import load_dotenv

from pipecat.frames.frames import EndFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.services.deepgram import DeepgramSTTService
from pipecat.services.elevenlabs import ElevenLabsTTSService
from pipecat.services.openai import OpenAILLMService
from pipecat.transports.daily.transport import DailyParams, DailyTransport
from pipecat.audio.vad.vad_analyzer import VADParams
from pipecat.audio.vad.silero import SileroVADAnalyzer

# Try to import Pipecat Flows
try:
    from pipecat_flows import FlowManager, FlowArgs, NodeConfig
    FLOWS_AVAILABLE = True
except ImportError:
    FLOWS_AVAILABLE = False
    logging.warning("pipecat-ai-flows not available - install with: pip install pipecat-ai-flows")

# Try to import smart turn analyzer
try:
    from pipecat.audio.turn.smart_turn import LocalSmartTurnAnalyzerV3
    SMART_TURN_AVAILABLE = True
except ImportError:
    SMART_TURN_AVAILABLE = False

from order_client import OrderClient, VoiceOrder, OrderItem, Customer

load_dotenv()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("voice-bot-flows")


# ============================================================================
# CONVERSATION FLOW NODES
# ============================================================================

ROLE_MESSAGE = {
    "role": "system",
    "content": """You are a friendly voice ordering assistant for Allstar Wings & Ribs restaurant in Richmond Hill.

CRITICAL VOICE RULES:
- NEVER use markdown formatting (no asterisks, no bold, no headers)
- Keep responses conversational and brief - this is a phone call
- Speak naturally like a real person taking a phone order
- Wing sizes are in POUNDS (1, 2, 3, or 5 pounds) - NOT ounces
- NEVER mention other restaurants. You are Allstar Wings & Ribs.
- Use the get_menu function when customers ask about menu items or prices"""
}


def create_greeting_node() -> NodeConfig:
    """Initial greeting and order type collection."""
    return {
        "name": "greeting",
        "role_messages": [ROLE_MESSAGE],
        "task_messages": [
            {
                "role": "system",
                "content": """This is a pickup order. The customer just called.

IMMEDIATELY say: "Hi! Thanks for calling Allstar Wings and Ribs! What can I get for you today?"

If they ask about the menu, use get_menu to fetch it.
If they ask about flavors, tell them: Honey Garlic, BBQ, Hot, Mild, Salt and Pepper, Lemon Pepper, Jerk, Suicide, and Cajun.
If they ask about sizes, wings come in: 1 pound, 2 pounds, 3 pounds, or 5 pounds.

When they say what they want to order, use set_order_type to proceed."""
            }
        ],
        "pre_actions": [
            {"type": "tts_say", "text": "Hi! Thanks for calling Allstar Wings and Ribs! What can I get for you today?"}
        ],
        "functions": [
            {
                "name": "set_order_type",
                "description": "Customer is ready to order or mentions what they want",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "order_type": {
                            "type": "string",
                            "enum": ["pickup", "delivery"],
                            "description": "Whether customer wants pickup or delivery"
                        }
                    },
                    "required": ["order_type"]
                }
            },
            {
                "name": "get_menu",
                "description": "Get the full menu with items and prices. Use when customer asks about menu or prices.",
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
        "role_messages": [ROLE_MESSAGE],
        "task_messages": [
            {
                "role": "system",
                "content": """Help the customer build their order. Use get_menu if they ask about menu items or prices.

ORDERING GUIDELINES:
- For wings: Ask what SIZE in pounds (1, 2, 3, or 5 pounds) and what FLAVOR they want
- Wing flavors: Honey Garlic, BBQ, Hot, Mild, Salt and Pepper, Lemon Pepper, Jerk, Suicide, Cajun
- Confirm each item back naturally after adding
- When they say "that's it", "that's all", or "no" to "anything else?", use complete_order_collection

IMPORTANT: Speak naturally, no markdown or special formatting."""
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
                            "description": "Menu item name"
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
                "description": "Get full menu with items and prices. Use when customer asks about menu or prices.",
                "parameters": {
                    "type": "object",
                    "properties": {}
                }
            },
            {
                "name": "complete_order_collection",
                "description": "Move to order confirmation when customer is done adding items",
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

Say something like: "Let me read that back to you: [order items]. Does that sound right?"

If they want to change something, use modify_order.
If they confirm, use confirm_order to proceed to collecting their information."""
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
                "description": "Customer confirmed the order - proceed to collect their info",
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

Ask for their name first, then their phone number.
Read back the phone number to confirm.

When you have both, use set_customer_info to record them."""
            }
        ],
        "functions": [
            {
                "name": "set_customer_info",
                "description": "Record customer name and phone",
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
        message = f"""The order has been placed successfully! Order number: {order_id}

Thank the customer and give them an estimated time:
- Pickup: about 15-20 minutes
- Delivery: about 30-45 minutes

Then say goodbye warmly."""
    else:
        errors = ", ".join(order_result.get("errors", ["Unknown error"]))
        message = f"""There was a problem with the order: {errors}

Apologize to the customer and offer to try again or suggest they call back."""

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
# FLOW MANAGER WITH ORDER STATE
# ============================================================================

class OrderFlowManager:
    """Manages conversation flow and order state."""

    def __init__(self, order_client: OrderClient):
        self.order_client = order_client
        self.flow_manager: Optional[FlowManager] = None

        # Order state
        self.order_type = "pickup"
        self.items = []
        self.customer_name = ""
        self.customer_phone = ""
        self.order_result = None

    async def initialize(self, flow_manager: FlowManager):
        """Initialize with FlowManager and start greeting."""
        self.flow_manager = flow_manager

        # Store reference to this manager in flow state
        flow_manager.state["order_manager"] = self

    async def handle_set_order_type(self, args: FlowArgs) -> tuple:
        """Handle order type selection."""
        self.order_type = args.get("order_type", "pickup")
        logger.info(f"Order type set to: {self.order_type}")
        return f"Got it, this will be for {self.order_type}.", create_order_collection_node()

    async def handle_add_item(self, args: FlowArgs) -> tuple:
        """Add item to order."""
        item = {
            "item_name": args.get("item_name", ""),
            "quantity": args.get("quantity", 1),
            "size": args.get("size"),
            "modifiers": args.get("modifiers", [])
        }
        self.items.append(item)

        # Format confirmation
        item_desc = f"{item['quantity']}x {item['item_name']}"
        if item['size']:
            item_desc += f" ({item['size']})"
        if item['modifiers']:
            item_desc += f" with {', '.join(item['modifiers'])}"

        logger.info(f"Added item: {item_desc}")
        return f"Added {item_desc} to your order. What else can I get you?", None  # Stay in same node

    async def handle_get_menu(self, args: FlowArgs) -> tuple:
        """Fetch and return menu."""
        try:
            menu = await self.order_client.get_menu()
            # Format for voice
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
            return "Sorry, I couldn't fetch the menu right now. What would you like to order?", None

    async def handle_complete_order_collection(self, args: FlowArgs) -> tuple:
        """Move to order confirmation."""
        if not self.items:
            return "You haven't added any items yet. What would you like to order?", None

        return "Let me confirm your order.", create_order_confirmation_node(self.items)

    async def handle_modify_order(self, args: FlowArgs) -> tuple:
        """Go back to order collection."""
        return "No problem, what would you like to change?", create_order_collection_node()

    async def handle_confirm_order(self, args: FlowArgs) -> tuple:
        """Order confirmed, get customer info."""
        return "Great! Now I just need your name and phone number.", create_customer_info_node()

    async def handle_set_customer_info(self, args: FlowArgs) -> tuple:
        """Set customer info and submit order."""
        self.customer_name = args.get("name", "")
        self.customer_phone = args.get("phone", "")

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
        return "END_CALL", None


# ============================================================================
# MAIN BOT
# ============================================================================

async def main(room_url: str, token: str = None, session_id: str = None):
    """Run the voice ordering bot with Pipecat Flows."""

    if not FLOWS_AVAILABLE:
        logger.error("pipecat-flows not installed. Run: pip install pipecat-flows")
        return

    session_id = session_id or datetime.now().strftime("%Y%m%d_%H%M%S")
    logger.info(f"Starting Flows bot for session {session_id}")

    # Initialize order client
    order_client = OrderClient(
        base_url=os.getenv("ORDER_API_URL", "http://localhost:3000")
    )
    order_manager = OrderFlowManager(order_client)

    # Configure VAD
    vad_params = VADParams(
        start_secs=0.2,
        stop_secs=0.2 if SMART_TURN_AVAILABLE else 0.8,
        confidence=0.7,
        min_volume=0.6,
    )
    vad_analyzer = SileroVADAnalyzer(params=vad_params)

    # Smart turn detection
    turn_analyzer = None
    if SMART_TURN_AVAILABLE:
        try:
            turn_analyzer = LocalSmartTurnAnalyzerV3()
            logger.info("SmartTurnAnalyzer enabled")
        except Exception as e:
            logger.warning(f"SmartTurnAnalyzer not available: {e}")

    # Daily.co transport
    transport = DailyTransport(
        room_url,
        token,
        "Allstar Voice Assistant",
        DailyParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            transcription_enabled=False,
            vad_enabled=True,
            vad_analyzer=vad_analyzer,
            turn_analyzer=turn_analyzer,
        ),
    )

    # Services
    stt = DeepgramSTTService(
        api_key=os.getenv("DEEPGRAM_API_KEY"),
        model="nova-2",
        language="en-US",
    )

    llm = OpenAILLMService(
        api_key=os.getenv("OPENAI_API_KEY"),
        model="gpt-4o-mini",
    )

    tts = ElevenLabsTTSService(
        api_key=os.getenv("ELEVENLABS_API_KEY"),
        voice_id=os.getenv("ELEVENLABS_VOICE_ID", "21m00Tcm4TlvDq8ikWAM"),
        model="eleven_turbo_v2",
    )

    # Create FlowManager
    flow_manager = FlowManager(
        llm=llm,
        tts=tts,
    )

    # Register function handlers
    @flow_manager.function_handler("set_order_type")
    async def handle_set_order_type(args: FlowArgs):
        return await order_manager.handle_set_order_type(args)

    @flow_manager.function_handler("add_item")
    async def handle_add_item(args: FlowArgs):
        return await order_manager.handle_add_item(args)

    @flow_manager.function_handler("get_menu")
    async def handle_get_menu(args: FlowArgs):
        return await order_manager.handle_get_menu(args)

    @flow_manager.function_handler("complete_order_collection")
    async def handle_complete_order_collection(args: FlowArgs):
        return await order_manager.handle_complete_order_collection(args)

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
        result = await order_manager.handle_end_call(args)
        # Queue end frame
        await task.queue_frames([EndFrame()])
        return result

    # Build pipeline
    pipeline = Pipeline([
        transport.input(),
        stt,
        flow_manager.create_context_aggregator().user(),
        llm,
        tts,
        transport.output(),
        flow_manager.create_context_aggregator().assistant(),
    ])

    task = PipelineTask(
        pipeline,
        PipelineParams(
            allow_interruptions=True,
            enable_metrics=True,
            idle_timeout_secs=300,
            cancel_on_idle_timeout=True,
        ),
    )

    # Start with greeting when participant joins
    @transport.event_handler("on_participant_joined")
    async def on_participant_joined(transport, participant):
        if participant.get("info", {}).get("isLocal"):
            return

        logger.info(f"Participant joined: {participant.get('id', 'unknown')}")

        # Initialize flow manager and start greeting
        await order_manager.initialize(flow_manager)
        await flow_manager.initialize(create_greeting_node())

    @transport.event_handler("on_participant_left")
    async def on_participant_left(transport, participant, reason):
        logger.info(f"Participant left: {reason}")
        await task.queue_frames([EndFrame()])
        await order_client.close()

    # Run pipeline
    runner = PipelineRunner()
    try:
        await runner.run(task)
    finally:
        await order_client.close()


if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Usage: python bot_flows.py <daily_room_url> [token] [session_id]")
        print("\nThis version uses Pipecat Flows for structured conversations.")
        print("Requires: pip install pipecat-flows")
        sys.exit(1)

    room_url = sys.argv[1]
    token = sys.argv[2] if len(sys.argv) > 2 else None
    session_id = sys.argv[3] if len(sys.argv) > 3 else None

    asyncio.run(main(room_url, token, session_id))
