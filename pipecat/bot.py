"""
Pipecat voice ordering bot with enhanced features.

Pipeline: Audio In → Deepgram STT → OpenAI LLM → ElevenLabs TTS → Audio Out

Features:
- SmartTurnAnalyzer for natural turn detection
- Optimized VAD parameters for restaurant ordering
- Turn tracking observer for observability
- Idle detection and watchdog timers
- Call recording support
- Graceful error handling

NOTE: Daily.co transport requires Linux or macOS - no Windows wheels available.
For Windows development, use test_order.py for text-based testing.
"""

import os
import asyncio
import logging
from datetime import datetime
from dotenv import load_dotenv

from pipecat.frames.frames import EndFrame, EndTaskFrame, LLMMessagesFrame, TranscriptionFrame, TextFrame
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.aggregators.openai_llm_context import OpenAILLMContext
from pipecat.services.deepgram.stt import DeepgramSTTService
from pipecat.services.cartesia.tts import CartesiaTTSService
from pipecat.services.openai.llm import OpenAILLMService
from pipecat.services.llm_service import FunctionCallParams
from pipecat.transports.daily.transport import DailyParams, DailyTransport
from pipecat.audio.vad.vad_analyzer import VADParams
from pipecat.audio.vad.silero import SileroVADAnalyzer

# Try to import smart turn analyzer (may not be available in all versions)
try:
    from pipecat.audio.turn.smart_turn import LocalSmartTurnAnalyzerV3
    SMART_TURN_AVAILABLE = True
except ImportError:
    SMART_TURN_AVAILABLE = False
    logging.warning("SmartTurnAnalyzer not available - using basic VAD only")

# Try to import observers
try:
    from pipecat.observers.turn_tracker import TurnTrackingObserver
    from pipecat.observers.loggers import LLMLogObserver, TranscriptionLogObserver
    OBSERVERS_AVAILABLE = True
except ImportError:
    OBSERVERS_AVAILABLE = False
    logging.warning("Observers not available - metrics will be limited")

from order_client import OrderClient
from order_assistant import OrderAssistant, SYSTEM_PROMPT, ORDER_FUNCTIONS

load_dotenv()


class TranscriptCaptureProcessor(FrameProcessor):
    """Captures transcription and LLM output frames for transcript storage."""

    def __init__(self, metrics: "CallMetrics"):
        super().__init__()
        self.metrics = metrics
        self._current_user_text = ""
        self._current_assistant_text = ""

    async def process_frame(self, frame, direction):
        await super().process_frame(frame, direction)

        # Capture user speech from STT (TranscriptionFrame)
        if isinstance(frame, TranscriptionFrame):
            if frame.text:
                # Only capture final transcriptions (not interim)
                if hasattr(frame, 'is_final') and frame.is_final:
                    self.metrics.add_transcript_entry("user", frame.text)
                    self.metrics.turn_count += 1
                    logger.debug(f"Transcript captured (user): {frame.text}")
                elif not hasattr(frame, 'is_final'):
                    # Some STT services don't have is_final, capture all
                    self.metrics.add_transcript_entry("user", frame.text)
                    self.metrics.turn_count += 1
                    logger.debug(f"Transcript captured (user): {frame.text}")

        # Capture assistant output (TextFrame from LLM before TTS)
        elif isinstance(frame, TextFrame):
            if frame.text and direction == FrameDirection.DOWNSTREAM:
                self.metrics.add_transcript_entry("assistant", frame.text)
                logger.debug(f"Transcript captured (assistant): {frame.text}")

        await self.push_frame(frame, direction)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("voice-bot")


class CallMetrics:
    """Track metrics for a single call."""

    def __init__(self, session_id: str, room_url: str = None):
        self.session_id = session_id
        self.room_url = room_url
        self.start_time = datetime.now()
        self.end_time = None
        self.turn_count = 0
        self.interruptions = 0
        self.order_submitted = False
        self.order_id = None
        self.errors = []
        self.customer_name = None
        self.customer_phone = None
        self.transcript = []  # List of {"role": "user"|"assistant", "content": str, "timestamp": str}
        self._submitted = False  # Track if already sent to API

    def add_transcript_entry(self, role: str, content: str):
        """Add a transcript entry."""
        self.transcript.append({
            "role": role,
            "content": content,
            "timestamp": datetime.now().isoformat()
        })

    def log_summary(self):
        """Log call summary metrics."""
        duration = (self.end_time or datetime.now()) - self.start_time
        logger.info(f"""
        === Call Summary ===
        Session: {self.session_id}
        Duration: {duration.total_seconds():.1f}s
        Turns: {self.turn_count}
        Interruptions: {self.interruptions}
        Order Submitted: {self.order_submitted}
        Order ID: {self.order_id or 'N/A'}
        Errors: {len(self.errors)}
        ====================
        """)

    def to_dict(self) -> dict:
        """Convert metrics to dictionary for API submission."""
        duration = (self.end_time or datetime.now()) - self.start_time
        return {
            "session_id": self.session_id,
            "start_time": self.start_time.isoformat(),
            "end_time": (self.end_time or datetime.now()).isoformat(),
            "duration_seconds": duration.total_seconds(),
            "turn_count": self.turn_count,
            "interruptions": self.interruptions,
            "order_submitted": self.order_submitted,
            "order_id": self.order_id,
            "errors": self.errors,
            "room_url": self.room_url,
            "customer_name": self.customer_name,
            "customer_phone": self.customer_phone,
            "transcript": self.transcript,
        }

    async def submit_to_api(self, client):
        """Submit metrics to the API."""
        if self._submitted:
            return

        try:
            response = await client.client.post(
                f"{client.base_url}/calls",
                json=self.to_dict()
            )
            if response.status_code == 201:
                logger.info(f"Metrics submitted to API for session {self.session_id}")
            else:
                logger.warning(f"Failed to submit metrics: {response.status_code}")
            self._submitted = True
        except Exception as e:
            logger.error(f"Error submitting metrics to API: {e}")


async def main(room_url: str, token: str = None, session_id: str = None):
    """
    Run the voice ordering bot in a Daily.co room.

    Args:
        room_url: Daily.co room URL
        token: Optional meeting token
        session_id: Optional session identifier for tracking
    """

    session_id = session_id or datetime.now().strftime("%Y%m%d_%H%M%S")
    metrics = CallMetrics(session_id, room_url)

    logger.info(f"Starting voice bot for session {session_id}")
    logger.info(f"Room URL: {room_url}")

    # Initialize the order client (connects to our TypeScript API)
    order_client = OrderClient(
        base_url=os.getenv("ORDER_API_URL", "http://localhost:3000")
    )
    order_assistant = OrderAssistant(order_client)

    # Configure VAD for restaurant ordering
    # Lower stop_secs for responsiveness when using SmartTurn
    vad_params = VADParams(
        start_secs=0.2,  # Quick speech detection
        stop_secs=0.2 if SMART_TURN_AVAILABLE else 0.8,  # SmartTurn handles longer pauses
        confidence=0.7,
        min_volume=0.6,
    )

    vad_analyzer = SileroVADAnalyzer(params=vad_params)

    # Smart turn detection for natural conversations
    turn_analyzer = None
    if SMART_TURN_AVAILABLE:
        try:
            turn_analyzer = LocalSmartTurnAnalyzerV3()
            logger.info("SmartTurnAnalyzer enabled for natural turn detection")
        except Exception as e:
            logger.warning(f"Failed to initialize SmartTurnAnalyzer: {e}")

    # Daily.co transport for WebRTC audio
    # Set explicit sample rates to ensure compatibility
    transport = DailyTransport(
        room_url,
        token,
        "Allstar Voice Assistant",
        DailyParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            audio_in_sample_rate=16000,
            audio_out_sample_rate=16000,
            transcription_enabled=False,  # We use Deepgram directly
            vad_enabled=True,
            vad_analyzer=vad_analyzer,
            turn_analyzer=turn_analyzer,
        ),
    )

    # Speech-to-Text with Deepgram
    stt = DeepgramSTTService(
        api_key=os.getenv("DEEPGRAM_API_KEY"),
        model="nova-2",  # Best accuracy for restaurant ordering
        language="en-US",
    )

    # LLM for conversation and order extraction
    llm = OpenAILLMService(
        api_key=os.getenv("OPENAI_API_KEY"),
        model="gpt-4o",  # Use GPT-4o for better instruction following and speed
    )

    # Text-to-Speech with Cartesia
    # Cartesia uses sonic-3 model by default with 16000 Hz sample rate
    tts = CartesiaTTSService(
        api_key=os.getenv("CARTESIA_API_KEY"),
        voice_id=os.getenv("CARTESIA_VOICE_ID", "79a125e8-cd45-4c13-8a67-188112f4dd22"),  # Friendly female voice
        sample_rate=16000,  # Match Daily.co transport sample rate
    )

    # Set up the conversation context with system prompt
    # Include a user message to trigger the initial greeting
    messages = [
        {
            "role": "system",
            "content": SYSTEM_PROMPT,
        },
        {
            "role": "user",
            "content": "[Customer has joined the call. Greet them warmly.]",
        },
    ]

    context = OpenAILLMContext(messages, ORDER_FUNCTIONS)
    context_aggregator = llm.create_context_aggregator(context)

    # Register function handlers using modern FunctionCallParams pattern
    async def handle_get_menu(params: FunctionCallParams):
        logger.info(f"Function call: {params.function_name} with {params.arguments}")
        try:
            result = await order_assistant.handle_function_call(params.function_name, params.arguments)
            await params.result_callback(result)
        except Exception as e:
            logger.error(f"Function call error: {e}")
            metrics.errors.append(str(e))
            await params.result_callback(f"Error: {str(e)}")

    async def handle_add_item(params: FunctionCallParams):
        logger.info(f"Function call: {params.function_name} with {params.arguments}")
        try:
            result = await order_assistant.handle_function_call(params.function_name, params.arguments)
            await params.result_callback(result)
        except Exception as e:
            logger.error(f"Function call error: {e}")
            metrics.errors.append(str(e))
            await params.result_callback(f"Error: {str(e)}")

    async def handle_remove_item(params: FunctionCallParams):
        logger.info(f"Function call: {params.function_name} with {params.arguments}")
        try:
            result = await order_assistant.handle_function_call(params.function_name, params.arguments)
            await params.result_callback(result)
        except Exception as e:
            logger.error(f"Function call error: {e}")
            metrics.errors.append(str(e))
            await params.result_callback(f"Error: {str(e)}")

    async def handle_get_order_summary(params: FunctionCallParams):
        logger.info(f"Function call: {params.function_name} with {params.arguments}")
        try:
            result = await order_assistant.handle_function_call(params.function_name, params.arguments)
            await params.result_callback(result)
        except Exception as e:
            logger.error(f"Function call error: {e}")
            metrics.errors.append(str(e))
            await params.result_callback(f"Error: {str(e)}")

    async def handle_submit_order(params: FunctionCallParams):
        logger.info(f"Function call: {params.function_name} with {params.arguments}")
        try:
            # Capture customer info
            metrics.customer_name = params.arguments.get("customerName")
            metrics.customer_phone = params.arguments.get("customerPhone")

            result = await order_assistant.handle_function_call(params.function_name, params.arguments)

            if "ORDER_SUCCESS" in result:
                metrics.order_submitted = True
                # Extract order ID if present
                if "Order #" in result:
                    metrics.order_id = result.split("Order #")[1].split()[0]

            await params.result_callback(result)
        except Exception as e:
            logger.error(f"Function call error: {e}")
            metrics.errors.append(str(e))
            await params.result_callback(f"Error: {str(e)}")

    async def handle_end_call(params: FunctionCallParams):
        logger.info("End call requested - hanging up")
        metrics.end_time = datetime.now()
        metrics.log_summary()
        # Submit metrics before ending
        await metrics.submit_to_api(order_client)
        await params.result_callback("Ending call now.")
        # Use EndTaskFrame with UPSTREAM direction for proper termination from inside pipeline
        await llm.push_frame(EndTaskFrame(), FrameDirection.UPSTREAM)

    # Register all functions with the LLM
    llm.register_function("get_menu", handle_get_menu)
    llm.register_function("add_item", handle_add_item)
    llm.register_function("remove_item", handle_remove_item)
    llm.register_function("get_order_summary", handle_get_order_summary)
    llm.register_function("submit_order", handle_submit_order)
    llm.register_function("end_call", handle_end_call)

    # Create transcript capture processor
    transcript_processor = TranscriptCaptureProcessor(metrics)

    # Build the pipeline
    pipeline = Pipeline(
        [
            transport.input(),          # Audio from user
            stt,                         # Speech to text
            transcript_processor,        # Capture transcripts
            context_aggregator.user(),   # Add user message to context
            llm,                         # Generate response
            tts,                         # Text to speech
            transport.output(),          # Audio to user
            context_aggregator.assistant(),  # Add assistant response to context
        ]
    )

    # Configure observers for monitoring
    observers = []
    if OBSERVERS_AVAILABLE:
        try:
            observers.append(LLMLogObserver())
            observers.append(TranscriptionLogObserver())
            observers.append(TurnTrackingObserver())
            logger.info("Observers enabled for pipeline monitoring")
        except Exception as e:
            logger.warning(f"Failed to initialize observers: {e}")

    # Create task with enhanced parameters
    task = PipelineTask(
        pipeline,
        params=PipelineParams(allow_interruptions=True),
    )

    # Track whether recording has started
    recording_started = False

    # Greet the customer when first participant joins
    @transport.event_handler("on_first_participant_joined")
    async def on_first_participant_joined(transport, participant):
        nonlocal recording_started

        participant_id = participant.get("id", "unknown")
        participant_name = participant.get("info", {}).get("userName", "")
        logger.info(f"First participant joined: {participant_id} ({participant_name})")

        # Enable transcription capture for this participant
        await transport.capture_participant_transcription(participant_id)
        logger.info(f"Transcription capture enabled for participant {participant_id}")

        # Start recording if enabled
        if os.getenv("ENABLE_RECORDING", "false").lower() == "true" and not recording_started:
            try:
                await transport.start_recording()
                recording_started = True
                logger.info("Call recording started")
            except Exception as e:
                logger.warning(f"Failed to start recording: {e}")

        # Send initial greeting using LLMMessagesFrame
        # This triggers the LLM to generate a greeting based on the context
        await task.queue_frames([LLMMessagesFrame(messages)])
        metrics.turn_count += 1
        logger.info("Initial greeting queued")

    # Clean up when call ends
    @transport.event_handler("on_participant_left")
    async def on_participant_left(transport, participant, reason):
        logger.info(f"Participant left: {reason}")
        metrics.end_time = datetime.now()
        metrics.log_summary()
        # Submit metrics before ending (if not already submitted by end_call)
        await metrics.submit_to_api(order_client)
        await task.queue_frames([EndFrame()])

    # Handle idle timeout
    @task.event_handler("on_idle_timeout")
    async def on_idle_timeout(task):
        logger.info("Idle timeout reached - ending call")
        metrics.end_time = datetime.now()
        metrics.log_summary()
        # Pipeline will auto-cancel due to cancel_on_idle_timeout=True

    # Handle pipeline errors
    @task.event_handler("on_pipeline_error")
    async def on_pipeline_error(task, error):
        logger.error(f"Pipeline error: {error}")
        metrics.errors.append(str(error))

    # Run the pipeline
    runner = PipelineRunner()
    try:
        await runner.run(task)
    except Exception as e:
        logger.error(f"Pipeline runner error: {e}")
        metrics.errors.append(str(e))
    finally:
        metrics.end_time = datetime.now()
        metrics.log_summary()
        # Submit metrics if not already done
        await metrics.submit_to_api(order_client)
        # Close the client last
        await order_client.close()


if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Usage: python bot.py <daily_room_url> [token] [session_id]")
        print("\nTo create a room, run: python create_room.py")
        sys.exit(1)

    room_url = sys.argv[1]
    token = sys.argv[2] if len(sys.argv) > 2 else None
    session_id = sys.argv[3] if len(sys.argv) > 3 else None

    asyncio.run(main(room_url, token, session_id))
