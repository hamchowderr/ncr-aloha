"""
HTTP server that spawns voice bots for incoming calls.

Features:
- Creates Daily.co rooms for voice sessions
- Auto-spawns bots when sessions are created
- Supports both standard bot and Flows-based bot
- Session tracking and status monitoring
- Health checks for monitoring

Endpoints:
- POST /sessions - Create new voice session (spawns bot automatically)
- GET /sessions/:id - Get session status
- GET /health - Health check
"""

import os
import sys
import asyncio
import uuid
import subprocess
import logging
from datetime import datetime
from typing import Optional
from dotenv import load_dotenv

from aiohttp import web
import httpx

load_dotenv()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("pipecat-server")

# Store active bot sessions
active_sessions = {}

# Bot process references
bot_processes = {}


async def create_daily_room() -> dict:
    """Create a Daily.co room for a new call."""
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


async def spawn_bot(room_url: str, session_id: str, use_flows: bool = False):
    """Spawn a bot process for the given room."""
    bot_script = "bot_flows.py" if use_flows else "bot.py"
    script_path = os.path.join(os.path.dirname(__file__), bot_script)

    # Check if we're in WSL or Linux (Daily.co requires it)
    if sys.platform == "win32":
        logger.warning("Daily.co transport not available on Windows. Bot not spawned.")
        logger.info(f"To run manually in WSL: python {bot_script} {room_url} {session_id}")
        return None

    try:
        # Spawn bot as subprocess
        process = subprocess.Popen(
            [sys.executable, script_path, room_url, "", session_id],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        bot_processes[session_id] = process
        logger.info(f"Spawned bot for session {session_id} (PID: {process.pid})")
        return process.pid
    except Exception as e:
        logger.error(f"Failed to spawn bot: {e}")
        return None


async def handle_start_session(request: web.Request) -> web.Response:
    """
    Start a new voice session.

    Creates a Daily.co room and optionally spawns a bot.

    Query params:
    - use_flows: Use Pipecat Flows version (default: false)
    - auto_spawn: Auto-spawn bot (default: true on Linux, false on Windows)
    """
    try:
        # Parse options
        use_flows = request.query.get("use_flows", "false").lower() == "true"
        auto_spawn_default = "true" if sys.platform != "win32" else "false"
        auto_spawn = request.query.get("auto_spawn", auto_spawn_default).lower() == "true"

        # Create Daily.co room
        room = await create_daily_room()
        room_url = room.get("url")
        room_name = room.get("name")

        if not room_url:
            return web.json_response(
                {"error": "Failed to create room", "details": room},
                status=500
            )

        session_id = str(uuid.uuid4())
        bot_pid = None

        # Spawn bot if requested
        if auto_spawn:
            bot_pid = await spawn_bot(room_url, session_id, use_flows)

        # Track session
        active_sessions[session_id] = {
            "session_id": session_id,
            "room_url": room_url,
            "room_name": room_name,
            "status": "bot_running" if bot_pid else "waiting_for_bot",
            "bot_pid": bot_pid,
            "use_flows": use_flows,
            "created_at": datetime.now().isoformat(),
        }

        response_data = {
            "session_id": session_id,
            "room_url": room_url,
            "room_name": room_name,
            "status": active_sessions[session_id]["status"],
        }

        # Add instructions if bot not spawned
        if not bot_pid:
            bot_script = "bot_flows.py" if use_flows else "bot.py"
            response_data["instructions"] = f"Bot not auto-spawned. Run manually: python {bot_script} {room_url}"
            if sys.platform == "win32":
                response_data["note"] = "Daily.co requires Linux/macOS. Use WSL on Windows."

        logger.info(f"Session created: {session_id} (room: {room_name})")
        return web.json_response(response_data)

    except httpx.HTTPStatusError as e:
        logger.error(f"Daily API error: {e}")
        return web.json_response(
            {"error": "Failed to create Daily.co room", "details": str(e)},
            status=500
        )
    except Exception as e:
        logger.error(f"Session creation error: {e}")
        return web.json_response(
            {"error": str(e)},
            status=500
        )


async def handle_session_status(request: web.Request) -> web.Response:
    """Get the status of a voice session."""
    session_id = request.match_info.get("session_id")

    if session_id not in active_sessions:
        return web.json_response(
            {"error": "Session not found"},
            status=404
        )

    session = active_sessions[session_id]

    # Check if bot process is still running
    if session.get("bot_pid") and session_id in bot_processes:
        process = bot_processes[session_id]
        if process.poll() is not None:
            # Process has exited
            session["status"] = "completed"
            session["exit_code"] = process.returncode

    return web.json_response(session)


async def handle_end_session(request: web.Request) -> web.Response:
    """End a voice session and terminate the bot."""
    session_id = request.match_info.get("session_id")

    if session_id not in active_sessions:
        return web.json_response(
            {"error": "Session not found"},
            status=404
        )

    # Terminate bot process if running
    if session_id in bot_processes:
        process = bot_processes[session_id]
        if process.poll() is None:
            process.terminate()
            logger.info(f"Terminated bot for session {session_id}")

    active_sessions[session_id]["status"] = "ended"

    return web.json_response({
        "session_id": session_id,
        "status": "ended"
    })


async def handle_health(request: web.Request) -> web.Response:
    """Health check endpoint."""
    # Count active sessions
    running_sessions = sum(
        1 for s in active_sessions.values()
        if s.get("status") in ["bot_running", "waiting_for_bot"]
    )

    return web.json_response({
        "status": "ok",
        "service": "pipecat-voice",
        "platform": sys.platform,
        "daily_available": sys.platform != "win32",
        "active_sessions": len(active_sessions),
        "running_sessions": running_sessions,
        "timestamp": datetime.now().isoformat(),
    })


async def handle_list_sessions(request: web.Request) -> web.Response:
    """List all sessions."""
    return web.json_response({
        "sessions": list(active_sessions.values())
    })


def create_app() -> web.Application:
    """Create the aiohttp application."""
    app = web.Application()

    # Routes
    app.router.add_get("/health", handle_health)
    app.router.add_post("/sessions", handle_start_session)
    app.router.add_get("/sessions", handle_list_sessions)
    app.router.add_get("/sessions/{session_id}", handle_session_status)
    app.router.add_delete("/sessions/{session_id}", handle_end_session)

    return app


if __name__ == "__main__":
    port = int(os.getenv("PIPECAT_PORT", "8765"))
    app = create_app()

    print(f"""
    =======================================
    Pipecat Voice Server
    =======================================

    Running at http://localhost:{port}
    Platform: {sys.platform}
    Daily.co available: {sys.platform != 'win32'}

    Endpoints:
      GET  /health                - Health check
      POST /sessions              - Create new voice session
           ?use_flows=true        - Use Pipecat Flows version
           ?auto_spawn=true       - Auto-spawn bot (Linux/macOS only)
      GET  /sessions              - List all sessions
      GET  /sessions/:id          - Get session status
      DELETE /sessions/:id        - End session

    Create a voice session:
      curl -X POST http://localhost:{port}/sessions

    With Pipecat Flows:
      curl -X POST "http://localhost:{port}/sessions?use_flows=true"

    {"NOTE: Running on Windows - bots must be spawned manually in WSL" if sys.platform == "win32" else ""}
    =======================================
    """)

    web.run_app(app, port=port)
