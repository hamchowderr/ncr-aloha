import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CartItem, OrderResult } from "@/types/menu";
import { useState } from "react";

interface CartProps {
  items: CartItem[];
  subtotal: number;
  tax: number;
  total: number;
  onRemove: (id: string) => void;
  onClear: () => void;
}

export function Cart({
  items,
  subtotal,
  tax,
  total,
  onRemove,
  onClear,
}: CartProps) {
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [orderType, setOrderType] = useState<"pickup" | "delivery">("pickup");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [orderResult, setOrderResult] = useState<OrderResult | null>(null);

  const handlePlaceOrder = async () => {
    if (!customerName || !customerPhone) {
      alert("Please enter your name and phone number");
      return;
    }

    setIsSubmitting(true);
    setOrderResult(null);

    const voiceOrder = {
      orderType,
      items: items.map((item) => ({
        itemName: item.menuItem.name,
        quantity: item.quantity,
        size: item.size?.name,
        modifiers: item.modifiers.map((m) => m.name),
      })),
      customer: {
        name: customerName,
        phone: customerPhone,
      },
    };

    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(voiceOrder),
      });

      const result = await res.json();
      setOrderResult(result);

      if (result.success) {
        onClear();
        setCustomerName("");
        setCustomerPhone("");
      }
    } catch (err) {
      setOrderResult({
        success: false,
        errors: [err instanceof Error ? err.message : "Unknown error"],
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (orderResult?.success) {
    return (
      <Card className="h-full">
        <CardContent className="flex flex-col items-center justify-center h-full py-12 text-center">
          <div className="text-6xl mb-4">&#10003;</div>
          <h3 className="text-2xl font-bold text-green-600 mb-2">
            Order Placed!
          </h3>
          <p className="text-muted-foreground mb-4">
            Your order has been sent to the kitchen.
          </p>
          <div className="bg-muted px-4 py-2 rounded-md font-mono text-sm mb-6">
            Order #{orderResult.orderId?.slice(0, 8)}...
          </div>
          <Button onClick={() => setOrderResult(null)}>New Order</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between">
          <span>Your Order</span>
          {items.length > 0 && (
            <Badge variant="secondary">{items.length} items</Badge>
          )}
        </CardTitle>
      </CardHeader>

      <CardContent className="flex-1 flex flex-col">
        {items.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            Your cart is empty
          </div>
        ) : (
          <>
            <ScrollArea className="flex-1 -mx-2 px-2">
              <div className="space-y-3">
                {items.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-start justify-between bg-muted/50 rounded-lg p-3"
                  >
                    <div className="flex-1">
                      <div className="font-medium">
                        {item.quantity}x {item.menuItem.name}
                        {item.size && (
                          <span className="text-muted-foreground">
                            {" "}
                            ({item.size.name})
                          </span>
                        )}
                      </div>
                      {item.modifiers.length > 0 && (
                        <div className="text-sm text-muted-foreground">
                          {item.modifiers.map((m) => m.name).join(", ")}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">
                        ${item.total.toFixed(2)}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-destructive"
                        onClick={() => onRemove(item.id)}
                      >
                        &times;
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>

            <div className="mt-4 space-y-4">
              <Separator />

              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Subtotal</span>
                  <span>${subtotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Tax (HST 13%)</span>
                  <span>${tax.toFixed(2)}</span>
                </div>
                <div className="flex justify-between font-bold text-lg">
                  <span>Total</span>
                  <span>${total.toFixed(2)}</span>
                </div>
              </div>

              <Separator />

              <div className="space-y-3">
                <div className="flex gap-2">
                  <Button
                    variant={orderType === "pickup" ? "default" : "outline"}
                    size="sm"
                    className="flex-1"
                    onClick={() => setOrderType("pickup")}
                  >
                    Pickup
                  </Button>
                  <Button
                    variant={orderType === "delivery" ? "default" : "outline"}
                    size="sm"
                    className="flex-1"
                    onClick={() => setOrderType("delivery")}
                  >
                    Delivery
                  </Button>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    placeholder="Your name"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="phone">Phone</Label>
                  <Input
                    id="phone"
                    placeholder="416-555-1234"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                  />
                </div>
              </div>

              {orderResult?.errors && (
                <div className="text-sm text-destructive">
                  {orderResult.errors.join(", ")}
                </div>
              )}

              <Button
                className="w-full"
                size="lg"
                onClick={handlePlaceOrder}
                disabled={isSubmitting || items.length === 0}
              >
                {isSubmitting ? "Placing Order..." : "Place Order"}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
