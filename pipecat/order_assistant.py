"""
Order-taking assistant that extracts order intent from conversation.
Uses OpenAI function calling for structured extraction.
"""

import json
from typing import Optional
from order_client import OrderClient, VoiceOrder, OrderItem, Customer


# System prompt for the voice ordering assistant - OPTIMIZED FOR VOICE
# Key principles: Be warm, conversational, use natural language, keep responses concise
SYSTEM_PROMPT = """You're a friendly order-taker at Allstar Wings & Ribs. You're warm, upbeat, and helpful - like talking to a friend who works there.

PERSONALITY:
- Sound natural, not scripted. Use contractions (I'm, we've, that's)
- Be enthusiastic about the food! "Oh, great choice!" or "Those are my favorite!"
- Use casual phrases: "Sure thing!", "You got it!", "Awesome!"
- Vary your responses - don't repeat the same phrases

MENU HIGHLIGHTS:
- Wings: 1lb ($12.99), 2lb ($22.99), 3lb ($31.99) - bone-in or boneless
- Flavors: Honey Garlic, BBQ, Hot, Mild, Lemon Pepper, Salt & Pepper, Jerk
- Ribs: Half rack ($16.99), Full rack ($28.99)
- Burgers, Wraps, Salads, Fries, Drinks also available
- Call get_menu for full details and current prices

CONVERSATION FLOW:
1. Greet warmly: "Hey there! Thanks for calling Allstar Wings! What can I get started for you today?"
2. Take their order naturally - confirm items as you go
3. If they want wings, ask: "What size?" then "And what flavor would you like on those?"
4. When they seem done: "Anything else, or should I get this order in for you?"
5. Get their info: "Perfect! Can I grab a name for the order?" then "And a phone number in case we need to reach you?"
6. Confirm and submit: "Alright [name], let me read that back..." then call submit_order
7. After success: "You're all set! Should be ready in about 15-20 minutes. Thanks so much!" then call end_call

KEEP IT SHORT:
- 1-2 sentences per response max
- Don't list the whole menu unprompted
- Get to the point but stay friendly

IMPORTANT: Always get customer name AND phone before calling submit_order. After order succeeds, thank them warmly and call end_call."""


# Function definitions for OpenAI function calling (tools format)
ORDER_FUNCTIONS = [
    {
        "type": "function",
        "function": {
            "name": "get_menu",
            "description": "Get the full menu with prices. Use when customer asks about menu items or prices.",
            "parameters": {
                "type": "object",
                "properties": {}
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "add_item",
            "description": "Add an item to the current order.",
            "parameters": {
                "type": "object",
                "properties": {
                    "itemName": {
                        "type": "string",
                        "description": "Name of the menu item (e.g., 'Lord of the Wing', 'Boneless Wings', 'Full Rack Ribs')"
                    },
                    "quantity": {
                        "type": "integer",
                        "description": "Number of this item",
                        "default": 1
                    },
                    "size": {
                        "type": "string",
                        "description": "Size if applicable (e.g., '1 lb', '2 lb', '3 lb' for wings)"
                    },
                    "modifiers": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Flavors, sauces, or modifications (e.g., ['honey garlic', 'extra crispy'])"
                    }
                },
                "required": ["itemName"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "remove_item",
            "description": "Remove an item from the current order.",
            "parameters": {
                "type": "object",
                "properties": {
                    "itemName": {
                        "type": "string",
                        "description": "Name of the menu item to remove"
                    }
                },
                "required": ["itemName"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_order_summary",
            "description": "Get a summary of the current order with all items and total price.",
            "parameters": {
                "type": "object",
                "properties": {}
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "end_call",
            "description": "End the call after the order is complete and confirmed. Say goodbye to the customer first, then call this function.",
            "parameters": {
                "type": "object",
                "properties": {}
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "submit_order",
            "description": "Submit a completed food order. Call this when you have all items and customer information.",
            "parameters": {
                "type": "object",
                "properties": {
                    "items": {
                        "type": "array",
                        "description": "List of items in the order",
                        "items": {
                            "type": "object",
                            "properties": {
                                "itemName": {
                                    "type": "string",
                                    "description": "Name of the menu item (e.g., 'Lord of the Wing', 'Boneless Wings', 'Full Rack Ribs')"
                                },
                                "quantity": {
                                    "type": "integer",
                                    "description": "Number of this item",
                                    "default": 1
                                },
                                "size": {
                                    "type": "string",
                                    "description": "Size if applicable (e.g., '1 lb', '2 lb', '3 lb' for wings)"
                                },
                                "modifiers": {
                                    "type": "array",
                                    "items": {"type": "string"},
                                    "description": "Flavors, sauces, or modifications (e.g., ['honey garlic', 'extra crispy'])"
                                }
                            },
                            "required": ["itemName"]
                        }
                    },
                    "customerName": {
                        "type": "string",
                        "description": "Customer's name for the order"
                    },
                    "customerPhone": {
                        "type": "string",
                        "description": "Customer's phone number"
                    },
                    "orderType": {
                        "type": "string",
                        "enum": ["pickup", "delivery"],
                        "description": "Whether this is for pickup or delivery",
                        "default": "pickup"
                    }
                },
                "required": ["items", "customerName", "customerPhone"]
            }
        }
    }
]


class OrderAssistant:
    """
    Handles order extraction and submission.
    This class processes function calls from the LLM.
    """

    def __init__(self, order_client: OrderClient):
        self.order_client = order_client
        self.current_order: Optional[VoiceOrder] = None
        self.order_items: list = []  # Track items during conversation
        self.last_order_result = None

    async def handle_function_call(self, function_name: str, arguments: dict) -> str:
        """Process a function call from the LLM."""

        if function_name == "get_menu":
            return await self._handle_get_menu()

        elif function_name == "add_item":
            return await self._handle_add_item(arguments)

        elif function_name == "remove_item":
            return await self._handle_remove_item(arguments)

        elif function_name == "get_order_summary":
            return await self._handle_get_order_summary()

        elif function_name == "submit_order":
            return await self._handle_submit_order(arguments)

        return f"Unknown function: {function_name}"

    async def _handle_get_menu(self) -> str:
        """Fetch and format the menu."""
        try:
            menu = await self.order_client.get_menu()
            # Format menu for voice reading
            items_by_category = {}
            for item in menu.get("items", []):
                cat = item.get("category", "Other")
                if cat not in items_by_category:
                    items_by_category[cat] = []
                items_by_category[cat].append(item)

            result = []
            for category, items in items_by_category.items():
                result.append(f"\n{category}:")
                for item in items[:5]:  # Limit to avoid long responses
                    price = item.get("basePrice", 0)
                    result.append(f"  - {item['name']}: ${price:.2f}")

            return "\n".join(result)
        except Exception as e:
            return f"Sorry, I couldn't fetch the menu right now. Error: {str(e)}"

    async def _handle_add_item(self, args: dict) -> str:
        """Add an item to the current order."""
        try:
            item = OrderItem(
                itemName=args.get("itemName", ""),
                quantity=args.get("quantity", 1),
                size=args.get("size"),
                modifiers=args.get("modifiers", [])
            )
            self.order_items.append(item)

            item_desc = f"{item.quantity}x {item.itemName}"
            if item.size:
                item_desc += f" ({item.size})"
            if item.modifiers:
                item_desc += f" with {', '.join(item.modifiers)}"

            return f"Added to order: {item_desc}. You now have {len(self.order_items)} item(s) in your order."
        except Exception as e:
            return f"Sorry, I couldn't add that item. Error: {str(e)}"

    async def _handle_remove_item(self, args: dict) -> str:
        """Remove an item from the current order."""
        try:
            item_name = args.get("itemName", "").lower()

            for i, item in enumerate(self.order_items):
                if item.itemName.lower() == item_name or item_name in item.itemName.lower():
                    removed = self.order_items.pop(i)
                    return f"Removed {removed.itemName} from your order. You now have {len(self.order_items)} item(s)."

            return f"I couldn't find '{args.get('itemName')}' in your order."
        except Exception as e:
            return f"Sorry, I couldn't remove that item. Error: {str(e)}"

    async def _handle_get_order_summary(self) -> str:
        """Get a summary of the current order."""
        if not self.order_items:
            return "Your order is currently empty."

        summary = ["Current order:"]
        for item in self.order_items:
            item_desc = f"- {item.quantity}x {item.itemName}"
            if item.size:
                item_desc += f" ({item.size})"
            if item.modifiers:
                item_desc += f" with {', '.join(item.modifiers)}"
            summary.append(item_desc)

        return "\n".join(summary)

    async def _handle_submit_order(self, args: dict) -> str:
        """Submit an order to the NCR API."""
        try:
            # Build the order
            items = []
            for item_data in args.get("items", []):
                items.append(OrderItem(
                    itemName=item_data.get("itemName", ""),
                    quantity=item_data.get("quantity", 1),
                    size=item_data.get("size"),
                    modifiers=item_data.get("modifiers", [])
                ))

            order = VoiceOrder(
                orderType=args.get("orderType", "pickup"),
                items=items,
                customer=Customer(
                    name=args.get("customerName", ""),
                    phone=args.get("customerPhone", "")
                )
            )

            self.current_order = order

            # Submit to NCR
            result = await self.order_client.submit_order(order)
            self.last_order_result = result

            if result.success:
                return f"ORDER_SUCCESS: Order #{result.orderId[:8] if result.orderId else 'N/A'} has been placed successfully!"
            else:
                errors = ", ".join(result.errors or ["Unknown error"])
                return f"ORDER_FAILED: {errors}"

        except Exception as e:
            return f"ORDER_ERROR: Failed to submit order - {str(e)}"
