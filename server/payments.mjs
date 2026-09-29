// Payment layer. Online payments are not connected yet: everything here is a stub with the shape a real provider
// (Stripe, Mollie, ...) will fill in later, so the shop and the order flow do not change when it is switched on.

const parsePrice = (value) => {
  const cents = Number.parseInt(value ?? "", 10);
  return Number.isInteger(cents) && cents > 0 ? cents : null;
};

// Payments stay off until a provider is implemented below.
export const paymentsEnabled = () => false;

export function shopConfig(env = process.env) {
  return {
    product: { id: "laptrace", name: "LapTrace" },
    priceCents: parsePrice(env.SHOP_PRICE_CENTS),
    currency: (env.SHOP_CURRENCY || "EUR").toUpperCase(),
    maxQuantity: 10,
    paymentsEnabled: paymentsEnabled(),
  };
}

// Would create a hosted checkout session for an order and return its redirect URL.
export async function createCheckout(_order) {
  return { provider: "stub", status: "unavailable", url: null };
}

// Would verify the provider signature and mark the order as paid.
export async function handlePaymentWebhook(_request) {
  throw Object.assign(new Error("Online payments are not available yet"), { status: 501 });
}
