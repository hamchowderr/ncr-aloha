"""
Telnyx VOIP Bot for Allstar Wings & Ribs Voice Ordering
Uses Pipecat with Telnyx WebSocket Media Streaming for real phone calls.

To run locally:
  1. Start ngrok: ngrok http 8765
  2. Configure TeXML app in Telnyx with the ngrok URL
  3. Run: python bot_telnyx.py

For production: Deploy to a public server or use Pipecat Cloud.
"""

import os
import sys
from datetime import datetime
from dotenv import load_dotenv
from loguru import logger

from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.frames.frames import LLMMessagesFrame, EndTaskFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.aggregators.openai_llm_context import OpenAILLMContext
from pipecat.processors.frame_processor import FrameDirection
from pipecat.runner.types import RunnerArguments
from pipecat.runner.utils import parse_telephony_websocket
from pipecat.serializers.telnyx import TelnyxFrameSerializer
from pipecat.services.cartesia.tts import CartesiaTTSService
from pipecat.services.deepgram.stt import DeepgramSTTService
from pipecat.services.openai.llm import OpenAILLMService
from pipecat.transports.base_transport import BaseTransport
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

    async def submit_to_api(self, order_client: OrderClient):
        """Submit call metrics to the backend API."""
        try:
            duration = (self.end_time - self.start_time).total_seconds() if self.end_time else 0
            await order_client.submit_call_metrics({
                "sessionId": self.session_id,
                "fromNumber": self.from_number,
                "toNumber": self.to_number,
                "duration": duration,
                "turnCount": self.turn_count,
                "orderSubmitted": self.order_submitted,
                "orderId": self.order_id,
            })
            logger.info("Call metrics submitted to API")
        except Exception as e:
            logger.error(f"Failed to submit call metrics: {e}")


async def run_bot(transport: BaseTransport, handle_sigint: bool, call_data: dict):
    """Run the voice ordering bot with Telnyx transport."""

    # Extract call information
    from_number = call_data.get("from", "unknown")
    to_number = call_data.get("to", "unknown")
    session_id = datetime.now().strftime("%Y%m%d_%H%M%S")

    logger.info(f"Starting call: {from_number} -> {to_number}")

    # Initialize metrics
    metrics = CallMetrics(session_id, from_number, to_number)

    # Initialize order client
    order_api_url = os.getenv("ORDER_API_URL", "http://host.docker.internal:3000")
    order_client = OrderClient(order_api_url)
    order_assistant = OrderAssistant(order_client)

    # Initialize services - Telnyx uses 8kHz audio
    stt = DeepgramSTTService(
        api_key=os.getenv("DEEPGRAM_API_KEY"),
        model="nova-2-phonecall",  # Optimized for phone calls
        language="en-US",
    )

    tts = CartesiaTTSService(
        api_key=os.getenv("CARTESIA_API_KEY"),
        voice_id=os.getenv("CARTESIA_VOICE_ID", "79a125e8-cd45-4c13-8a67-188112f4dd22"),
        model="sonic-english",
        sample_rate=8000,  # Match Telnyx 8kHz
    )

    llm = OpenAILLMService(
        api_key=os.getenv("OPENAI_API_KEY"),
        model="gpt-4o",
    )

    # Register function handlers
    @llm.function("get_menu")
    async def handle_get_menu(params):
        result = await order_assistant.handle_function_call("get_menu", {})
        return result

    @llm.function("add_item")
    async def handle_add_item(params):
        result = await order_assistant.handle_function_call("add_item", params.arguments)
        return result

    @llm.function("remove_item")
    async def handle_remove_item(params):
        result = await order_assistant.handle_function_call("remove_item", params.arguments)
        return result

    @llm.function("get_order_summary")
    async def handle_get_order_summary(params):
        result = await order_assistant.handle_function_call("get_order_summary", {})
        return result

    @llm.function("submit_order")
    async def handle_submit_order(params):
        result = await order_assistant.handle_function_call("submit_order", params.arguments)
        if "ORDER_SUCCESS" in result:
            metrics.order_submitted = True
            if order_assistant.last_order_result:
                metrics.order_id = order_assistant.last_order_result.orderId
        return result

    @llm.function("end_call")
    async def handle_end_call(params):
        logger.info("End call requested - hanging up")
        metrics.end_time = datetime.now()
        metrics.log_summary()
        await metrics.submit_to_api(order_client)
        await order_client.close()
        # Use EndTaskFrame to properly terminate the pipeline
        await llm.push_frame(EndTaskFrame(), FrameDirection.UPSTREAM)
        return "Call ended."

    # Set up LLM context with system prompt and tools
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    context = OpenAILLMContext(messages, ORDER_FUNCTIONS)
    context_aggregator = llm.create_context_aggregator(context)

    # Build the pipeline
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
            audio_in_sample_rate=8000,   # Telnyx uses 8kHz
            audio_out_sample_rate=8000,
            allow_interruptions=True,
            enable_metrics=True,
            enable_usage_metrics=True,
        ),
    )

    @transport.event_handler("on_client_connected")
    async def on_client_connected(transport, client):
        logger.info(f"Client connected: {from_number}")
        # Greet the caller
        messages.append({
            "role": "system",
            "content": "A customer just called. Greet them warmly and ask what they'd like to order. Keep it brief!"
        })
        await task.queue_frames([LLMMessagesFrame(messages)])

    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(transport, client):
        logger.info(f"Client disconnected: {from_number}")
        metrics.end_time = datetime.now()
        metrics.log_summary()
        await metrics.submit_to_api(order_client)
        await order_client.close()
        await task.cancel()

    # Run the pipeline
    runner = PipelineRunner(handle_sigint=handle_sigint)
    await runner.run(task)


async def bot(runner_args: RunnerArguments):
    """Entry point for the Pipecat runner."""

    # Parse Telnyx WebSocket data
    _, call_data = await parse_telephony_websocket(runner_args.websocket)

    logger.info(f"Received call from: {call_data.get('from', 'unknown')}")
    logger.info(f"Stream ID: {call_data.get('stream_id', 'unknown')}")

    # Create Telnyx serializer
    serializer = TelnyxFrameSerializer(
        stream_id=call_data["stream_id"],
        outbound_encoding=call_data.get("outbound_encoding", "PCMU"),
        inbound_encoding="PCMU",
        call_control_id=call_data["call_control_id"],
        api_key=os.getenv("TELNYX_API_KEY"),
    )

    # Create WebSocket transport
    transport = FastAPIWebsocketTransport(
        websocket=runner_args.websocket,
        params=FastAPIWebsocketParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            add_wav_header=False,
            vad_analyzer=SileroVADAnalyzer(
                params=SileroVADAnalyzer.VADParams(
                    confidence=0.7,
                    start_secs=0.2,
                    stop_secs=0.8,
                    min_volume=0.6,
                )
            ),
            serializer=serializer,
        ),
    )

    await run_bot(transport, runner_args.handle_sigint, call_data)


if __name__ == "__main__":
    from pipecat.runner.run import main
    main()
