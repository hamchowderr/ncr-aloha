"""
Pipecat voice ordering bot using Pipecat Flows for structured conversations.

This version uses node-based conversation states for more predictable ordering flow:
- greeting → order_collection → order_confirmation → customer_info → completion

Features:
- Structured conversation flow with explicit state transitions
- SmartTurnAnalyzer for natural turn detection
- Comprehensive error handling and recovery
- Call metrics and observability

NOTE: Requires pipecat-flows package: pip install pipecat-ai-flows
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
from pipecat.services.deepgram.stt import DeepgramSTTService
from pipecat.services.elevenlabs.tts import ElevenLabsTTSService
from pipecat.services.openai.llm import OpenAILLMService
from pipecat.processors.aggregators.openai_llm_context import OpenAILLMContext
from pipecat.transports.daily.transport import DailyParams, DailyTransport
from pipecat.audio.vad.vad_analyzer import VADParams
from pipecat.audio.vad.silero import SileroVADAnalyzer

# Try to import Pipecat Flows
try:
    from pipecat_flows import FlowManager, FlowArgs, NodeConfig, FlowsFunctionSchema
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
- Use get_menu function when customers ask about items or prices

EXAMPLE NATURAL RESPONSES:
- "Got it... two pounds of wings, honey garlic. Anything else?"
- "Sure thing! And what flavor would you like on those?"
- "Alright, let me make sure I have this right..."
- "No problem! Take your time."""
}


# ============================================================================
# NODE FACTORY CLASS - Creates nodes with embedded handlers (new API)
# ============================================================================

class FlowNodeFactory:
    """Creates flow nodes with proper handlers for the new pipecat-flows API."""

    def __init__(self, order_client: OrderClient):
        self.order_client = order_client
        self.items = []
        self.customer_name = ""
        self.customer_phone = ""
        self.order_result = None
        self.flow_manager = None
        self.task = None

    def set_refs(self, flow_manager, task):
        """Set references needed for ending calls."""
        self.flow_manager = flow_manager
        self.task = task

    def create_greeting_node(self) -> NodeConfig:
        """Initial greeting node."""
        factory = self  # Capture reference for closure

        async def handle_ready_to_order(args: FlowArgs, flow_manager: FlowManager) -> tuple:
            logger.info("Customer ready to order")
            return ("Great! What would you like to order?", factory.create_order_collection_node())

        async def handle_get_menu(args: FlowArgs, flow_manager: FlowManager) -> tuple:
            """Fetch menu and return it."""
            try:
                menu = await factory.order_client.get_menu()
                categories = menu.get("categories", [])
                if categories:
                    cat_text = ", ".join(categories[:-1]) + ", and " + categories[-1] if len(categories) > 1 else categories[0]
                    menu_text = f"We have {cat_text}. Our wings are the specialty, they come in one, two, three, or five pound sizes. What sounds good to you?"
                else:
                    menu_text = "We have wings, ribs, burgers, fries, salads, and desserts. Our wings come in one, two, three, or five pound sizes. What sounds good?"
                return (menu_text, None)
            except Exception as e:
                logger.error(f"Failed to fetch menu: {e}")
                return ("We have wings, ribs, burgers, and more. Our wings come in one, two, three, or five pound sizes. What sounds good?", None)

        return {
            "name": "greeting",
            "role_messages": [ROLE_MESSAGE],
            "task_messages": [{
                "role": "system",
                "content": """This is a pickup order. Listen to what the customer wants.
If they ask about the menu, use get_menu.
When they mention what they want to order, use set_ready_to_order."""
            }],
            "pre_actions": [
                {"type": "tts_say", "text": "Hi there! Thanks for calling Allstar Wings and Ribs. What can I get for you?"}
            ],
            "functions": [
                FlowsFunctionSchema(
                    name="set_ready_to_order",
                    description="Customer mentions a food item they want to order or says they're ready to order",
                    handler=handle_ready_to_order,
                    properties={},
                    required=[],
                ),
                FlowsFunctionSchema(
                    name="get_menu",
                    description="Customer asks about the menu, what you have, or prices",
                    handler=handle_get_menu,
                    properties={},
                    required=[],
                )
            ],
        }

    def create_order_collection_node(self) -> NodeConfig:
        """Order collection node."""
        factory = self

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
            try:
                menu = await factory.order_client.get_menu()
                categories = menu.get("categories", [])
                if categories:
                    cat_text = ", ".join(categories[:-1]) + ", and " + categories[-1] if len(categories) > 1 else categories[0]
                    menu_text = f"We have {cat_text}. Our wings come in one, two, three, or five pound sizes."
                else:
                    menu_text = "We have wings, ribs, burgers, fries, salads, and desserts."
                return (menu_text, None)
            except Exception as e:
                logger.error(f"Failed to fetch menu: {e}")
                return ("We have wings, ribs, burgers, and more.", None)

        async def handle_complete_order(args: FlowArgs, flow_manager: FlowManager) -> tuple:
            if not factory.items:
                return ("You haven't ordered anything yet. What would you like?", None)
            return ("Let me confirm your order.", factory.create_order_confirmation_node())

        return {
            "name": "order_collection",
            "task_messages": [{
                "role": "system",
                "content": """Take the customer's order. For wings, confirm size and flavor.
After each item, ask "Anything else?"
When they're done ordering, use complete_order."""
            }],
            "functions": [
                FlowsFunctionSchema(
                    name="add_item",
                    description="Add an item to the order",
                    handler=handle_add_item,
                    properties={
                        "item_name": {"type": "string", "description": "Menu item name"},
                        "quantity": {"type": "integer", "description": "Number of items", "default": 1},
                        "size": {"type": "string", "description": "Size (e.g., 1 lb, 2 lb for wings)"},
                        "modifiers": {"type": "array", "items": {"type": "string"}, "description": "Flavors or modifications"}
                    },
                    required=["item_name"],
                ),
                FlowsFunctionSchema(
                    name="get_menu",
                    description="Customer asks about menu or prices",
                    handler=handle_get_menu,
                    properties={},
                    required=[],
                ),
                FlowsFunctionSchema(
                    name="complete_order",
                    description="Customer says they're done ordering (e.g., 'that's it', 'that's all', 'no' to anything else)",
                    handler=handle_complete_order,
                    properties={},
                    required=[],
                ),
            ],
        }

    def create_order_confirmation_node(self) -> NodeConfig:
        """Order confirmation node."""
        factory = self

        items_text = "\n".join([
            f"- {item.get('quantity', 1)}x {item.get('item_name')}" +
            (f" ({item.get('size')})" if item.get('size') else "") +
            (f" - {', '.join(item.get('modifiers', []))}" if item.get('modifiers') else "")
            for item in factory.items
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
                    description="Customer wants to change something",
                    handler=handle_modify_order,
                    properties={},
                    required=[],
                ),
                FlowsFunctionSchema(
                    name="confirm_order",
                    description="Customer confirms the order is correct",
                    handler=handle_confirm_order,
                    properties={},
                    required=[],
                ),
            ],
        }

    def create_customer_info_node(self) -> NodeConfig:
        """Customer info collection node."""
        factory = self

        async def handle_set_customer_info(args: FlowArgs, flow_manager: FlowManager) -> tuple:
            factory.customer_name = args.get("name", "")
            factory.customer_phone = args.get("phone", "")
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
                    "errors": result.errors,
                    "warnings": result.warnings
                }
                logger.info(f"Order submitted: {factory.order_result}")

            except Exception as e:
                logger.error(f"Order submission failed: {e}")
                factory.order_result = {
                    "success": False,
                    "errors": [str(e)]
                }

            return ("Submitting your order now...", factory.create_completion_node())

        return {
            "name": "customer_info",
            "task_messages": [{
                "role": "system",
                "content": "Get the customer's name first, then their phone number. Read back the phone number to confirm."
            }],
            "functions": [
                FlowsFunctionSchema(
                    name="set_customer_info",
                    description="Record customer name and phone number",
                    handler=handle_set_customer_info,
                    properties={
                        "name": {"type": "string", "description": "Customer's name"},
                        "phone": {"type": "string", "description": "Customer's phone number"}
                    },
                    required=["name", "phone"],
                ),
            ],
        }

    def create_completion_node(self) -> NodeConfig:
        """Final completion node."""
        factory = self

        success = factory.order_result.get("success", False) if factory.order_result else False
        order_id = factory.order_result.get("orderId", "")[:8] if factory.order_result and factory.order_result.get("orderId") else ""

        if success:
            message = f"Order placed! Order number is {order_id}. It'll be ready in about 15-20 minutes. Thanks for calling!"
        else:
            errors = ", ".join(factory.order_result.get("errors", ["Unknown error"])) if factory.order_result else "Unknown error"
            message = f"Sorry, there was a problem: {errors}. Please try again or call back."

        async def handle_end_call(args: FlowArgs, flow_manager: FlowManager) -> tuple:
            logger.info("Call ending")
            if factory.task:
                await factory.task.queue_frames([EndFrame()])
            return ("Goodbye!", None)

        return {
            "name": "completion",
            "pre_actions": [
                {"type": "tts_say", "text": message}
            ],
            "task_messages": [{
                "role": "system",
                "content": "Say goodbye warmly and end the call."
            }],
            "functions": [
                FlowsFunctionSchema(
                    name="end_call",
                    description="End the call after saying goodbye",
                    handler=handle_end_call,
                    properties={},
                    required=[],
                ),
            ],
        }


# ============================================================================
# MAIN BOT
# ============================================================================

async def main(room_url: str, token: str = None, session_id: str = None):
    """Run the voice ordering bot with Pipecat Flows."""

    if not FLOWS_AVAILABLE:
        logger.error("pipecat-flows not installed. Run: pip install pipecat-ai-flows")
        return

    session_id = session_id or datetime.now().strftime("%Y%m%d_%H%M%S")
    logger.info(f"Starting Flows bot for session {session_id}")

    # Initialize order client
    order_client = OrderClient(
        base_url=os.getenv("ORDER_API_URL", "http://localhost:3000")
    )

    # Create node factory (holds order state)
    node_factory = FlowNodeFactory(order_client)

    # Configure VAD
    vad_params = VADParams(
        start_secs=0.2,
        stop_secs=0.8,
        confidence=0.7,
        min_volume=0.6,
    )
    vad_analyzer = SileroVADAnalyzer(params=vad_params)

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

    # Create context aggregator (required for new FlowManager API)
    context = OpenAILLMContext()
    context_aggregator = llm.create_context_aggregator(context)

    # Build pipeline first (needed for FlowManager)
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
            allow_interruptions=True,
            enable_metrics=True,
            idle_timeout_secs=300,
            cancel_on_idle_timeout=True,
        ),
    )

    # Create FlowManager with new API (requires task and context_aggregator)
    flow_manager = FlowManager(
        task=task,
        llm=llm,
        context_aggregator=context_aggregator,
    )

    # Give node factory references for ending calls
    node_factory.set_refs(flow_manager, task)

    # Start with greeting when participant joins
    @transport.event_handler("on_participant_joined")
    async def on_participant_joined(transport, participant):
        if participant.get("info", {}).get("isLocal"):
            return

        logger.info(f"Participant joined: {participant.get('id', 'unknown')}")

        # Initialize flow manager with greeting node (handlers embedded in node)
        await flow_manager.initialize(node_factory.create_greeting_node())

    @transport.event_handler("on_participant_left")
    async def on_participant_left(transport, participant, reason):
        logger.info(f"Participant left: {reason}")
        await task.queue_frames([EndFrame()])

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
