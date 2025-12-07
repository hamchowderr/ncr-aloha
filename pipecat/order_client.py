"""
HTTP client for the NCR Aloha order API (TypeScript server).
"""

import httpx
from pydantic import BaseModel
from typing import Optional


class OrderItem(BaseModel):
    itemName: str
    quantity: int = 1
    size: Optional[str] = None
    modifiers: list[str] = []


class Customer(BaseModel):
    name: str
    phone: str


class VoiceOrder(BaseModel):
    orderType: str = "pickup"  # pickup or delivery
    items: list[OrderItem]
    customer: Customer


class OrderResult(BaseModel):
    success: bool
    orderId: Optional[str] = None
    errors: Optional[list[str]] = None
    warnings: Optional[list[str]] = None


class OrderClient:
    """Client for submitting orders to the NCR Aloha API."""

    def __init__(self, base_url: str = "http://localhost:3000"):
        self.base_url = base_url.rstrip("/")
        self.client = httpx.AsyncClient(timeout=30.0)

    async def get_menu(self) -> dict:
        """Fetch the restaurant menu."""
        response = await self.client.get(f"{self.base_url}/menu")
        response.raise_for_status()
        return response.json()

    async def validate_order(self, order: VoiceOrder) -> dict:
        """Validate an order without submitting."""
        response = await self.client.post(
            f"{self.base_url}/orders/validate",
            json=order.model_dump(),
        )
        return response.json()

    async def submit_order(self, order: VoiceOrder) -> OrderResult:
        """Submit an order to NCR Aloha."""
        response = await self.client.post(
            f"{self.base_url}/orders",
            json=order.model_dump(),
        )
        data = response.json()
        return OrderResult(**data)

    async def get_order_status(self, order_id: str) -> dict:
        """Get the status of an existing order."""
        response = await self.client.get(f"{self.base_url}/orders/{order_id}")
        return response.json()

    async def close(self):
        """Close the HTTP client."""
        await self.client.aclose()
