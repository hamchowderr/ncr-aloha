import { OrderService } from "./services/order-service.js";
import { allstarMenu } from "./data/allstar-menu.js";
import type { VoiceOrder } from "./models/menu.js";

/**
 * Test script to verify NCR API integration
 */
async function main() {
  console.log("🍗 NCR Aloha Voice Ordering - API Test\n");

  const orderService = new OrderService(allstarMenu);

  // Sample voice order - what would come from Pipecat
  const voiceOrder: VoiceOrder = {
    orderType: "pickup",
    items: [
      {
        itemName: "wings",
        quantity: 1,
        size: "2 pounds",
        modifiers: ["honey garlic", "extra crispy"],
      },
      {
        itemName: "poutine",
        quantity: 1,
      },
      {
        itemName: "pop",
        quantity: 2,
        size: "large",
      },
    ],
    customer: {
      name: "John Smith",
      phone: "416-555-1234",
    },
    specialInstructions: "Please include extra napkins",
  };

  console.log("📝 Voice Order Input:");
  console.log(JSON.stringify(voiceOrder, null, 2));
  console.log("\n" + "=".repeat(50) + "\n");

  // First validate the order
  console.log("🔍 Validating order...\n");
  const validation = orderService.validateOrder(voiceOrder);

  if (!validation.valid) {
    console.log("❌ Order validation failed:");
    validation.errors.forEach((e) => console.log(`  - ${e}`));
    return;
  }

  if (validation.warnings.length > 0) {
    console.log("⚠️  Warnings:");
    validation.warnings.forEach((w) => console.log(`  - ${w}`));
    console.log("");
  }

  console.log("✅ Order Summary:");
  console.log(`   Customer: ${voiceOrder.customer.name}`);
  console.log(`   Type: ${voiceOrder.orderType}`);
  console.log("");
  console.log("   Items:");
  validation.orderSummary?.items.forEach((item) => {
    console.log(`   - ${item.quantity}x ${item.name}: $${item.price.toFixed(2)}`);
    if (item.modifiers.length > 0) {
      console.log(`     Modifiers: ${item.modifiers.join(", ")}`);
    }
  });
  console.log("");
  console.log(`   Subtotal: $${validation.orderSummary?.subtotal.toFixed(2)}`);
  console.log(`   Tax (HST): $${validation.orderSummary?.tax.toFixed(2)}`);
  console.log(`   Total: $${validation.orderSummary?.total.toFixed(2)}`);
  console.log("\n" + "=".repeat(50) + "\n");

  // Submit to NCR API
  console.log("🚀 Submitting order to NCR API...\n");
  const result = await orderService.submitOrder(voiceOrder);

  if (result.success) {
    console.log("✅ Order submitted successfully!");
    console.log(`   Order ID: ${result.orderId}`);
    console.log(`   Status: ${result.order?.status}`);
  } else {
    console.log("❌ Order submission failed:");
    result.errors.forEach((e) => console.log(`  - ${e}`));
  }
}

main().catch(console.error);
