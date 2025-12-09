"""
Create a Daily.co room for voice calls.

This creates a temporary room that expires after 1 hour.
Run this to get a room URL, then use it with bot_flows.py.
"""

import os
import time
import httpx
from dotenv import load_dotenv

load_dotenv()


def create_room():
    """Create a Daily.co room and return the URL."""
    api_key = os.getenv("DAILY_API_KEY")

    if not api_key:
        print("Error: DAILY_API_KEY not set in .env")
        print("Get your API key from https://dashboard.daily.co/developers")
        return None

    response = httpx.post(
        "https://api.daily.co/v1/rooms",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json={
            "properties": {
                "exp": int(time.time()) + 3600,  # Room expires in 1 hour (Unix timestamp)
                "enable_chat": False,
                "enable_screenshare": False,
                "start_video_off": True,
                "start_audio_off": False,
            }
        },
    )

    if response.status_code != 200:
        print(f"Error creating room: {response.text}")
        return None

    data = response.json()
    room_url = data.get("url")
    room_name = data.get("name")

    print(f"Room created successfully!")
    print(f"  Name: {room_name}")
    print(f"  URL:  {room_url}")
    print(f"\nTo start the bot:")
    print(f"  python bot_flows.py {room_url}")
    print(f"\nTo join as a caller:")
    print(f"  Open {room_url} in your browser")

    return room_url


if __name__ == "__main__":
    create_room()
