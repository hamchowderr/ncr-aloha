"""
Test script for order assistant without voice/audio.
Use this to verify the LLM and order client integration works.
"""

import os
import asyncio
from dotenv import load_dotenv
from openai import AsyncOpenAI

from order_client import OrderClient
from order_assistant import OrderAssistant, SYSTEM_PROMPT, ORDER_FUNCTIONS

load_dotenv()


async def main():
    """Interactive text-based order test."""

    # Check for API key
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        print("Error: OPENAI_API_KEY not set in .env")
        return

    # Initialize clients
    order_client = OrderClient(
        base_url=os.getenv("ORDER_API_URL", "http://localhost:3000")
    )
    order_assistant = OrderAssistant(order_client)
    openai_client = AsyncOpenAI(api_key=api_key)

    print("\n" + "="*60)
    print("Allstar Wings & Ribs - Voice Order Test (Text Mode)")
    print("="*60)
    print("\nThis simulates the voice ordering conversation.")
    print("Type your order as if speaking. Type 'quit' to exit.\n")

    # Conversation history
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "assistant", "content": "Hi! Welcome to Allstar Wings and Ribs. What can I get started for you today?"}
    ]

    print(f"Assistant: {messages[-1]['content']}\n")

    while True:
        # Get user input
        user_input = input("You: ").strip()

        if user_input.lower() in ['quit', 'exit', 'q']:
            print("\nGoodbye!")
            break

        if not user_input:
            continue

        # Add user message
        messages.append({"role": "user", "content": user_input})

        try:
            # Call OpenAI with function calling
            response = await openai_client.chat.completions.create(
                model="gpt-4o-mini",
                messages=messages,
                tools=[{"type": "function", "function": f} for f in ORDER_FUNCTIONS],
                tool_choice="auto"
            )

            assistant_message = response.choices[0].message

            # Check for function calls
            if assistant_message.tool_calls:
                for tool_call in assistant_message.tool_calls:
                    function_name = tool_call.function.name
                    import json
                    arguments = json.loads(tool_call.function.arguments)

                    print(f"\n[Function Call: {function_name}]")
                    print(f"[Arguments: {json.dumps(arguments, indent=2)}]")

                    # Execute function
                    result = await order_assistant.handle_function_call(function_name, arguments)
                    print(f"[Result: {result}]\n")

                    # Add function result to messages
                    messages.append({
                        "role": "assistant",
                        "content": None,
                        "tool_calls": [tool_call]
                    })
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "content": result
                    })

                # Get follow-up response
                followup = await openai_client.chat.completions.create(
                    model="gpt-4o-mini",
                    messages=messages
                )
                final_content = followup.choices[0].message.content
                messages.append({"role": "assistant", "content": final_content})
                print(f"Assistant: {final_content}\n")
            else:
                # Regular response
                content = assistant_message.content
                messages.append({"role": "assistant", "content": content})
                print(f"Assistant: {content}\n")

        except Exception as e:
            print(f"\nError: {str(e)}\n")

    await order_client.close()


if __name__ == "__main__":
    asyncio.run(main())
