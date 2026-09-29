import test from "node:test";
import assert from "node:assert/strict";
import { orderNumber, validateOrder } from "../server/orders.mjs";
import { createCheckout, handlePaymentWebhook, paymentsEnabled, shopConfig } from "../server/payments.mjs";

const valid = { name: "Mario Rossi", email: "Mario@Example.com ", phone: "", country: "Italy", address: "Via Roma 1, Viterbo", note: "", quantity: 2, consent: true };

test("accepts a valid pre-order and normalises the fields", () => {
  const { value, error } = validateOrder(valid);
  assert.equal(error, undefined);
  assert.equal(value.email, "mario@example.com");
  assert.equal(value.quantity, 2);
});

test("rejects incomplete or unsafe orders", () => {
  for (const patch of [{ name: "M" }, { email: "nope" }, { country: "" }, { address: "x" }, { quantity: 0 }, { quantity: 11 }, { quantity: 1.5 }, { quantity: "many" }, { consent: false }, { consent: "true" }]) {
    assert.ok(validateOrder({ ...valid, ...patch }).error, JSON.stringify(patch));
  }
  assert.ok(validateOrder(null).error);
});

test("trims oversize text and strips control characters", () => {
  const { value } = validateOrder({ ...valid, name: "A\u0000B".repeat(200), note: "n".repeat(5000) });
  assert.ok(value.name.length <= 100 && !value.name.includes("\u0000"));
  assert.equal(value.note.length, 1000);
});

test("order numbers are short and zero padded", () => {
  assert.equal(orderNumber(7), "D3-0007");
  assert.equal(orderNumber(12345), "D3-12345");
});

test("payments are stubbed: disabled, no checkout URL, webhook refuses", async () => {
  assert.equal(paymentsEnabled(), false);
  assert.deepEqual(await createCheckout({ id: "x" }), { provider: "stub", status: "unavailable", url: null });
  await assert.rejects(handlePaymentWebhook({}), (error) => error.status === 501);
});

test("shop config reads the price from the environment and defaults to unpriced", () => {
  assert.equal(shopConfig({}).priceCents, null);
  assert.equal(shopConfig({ SHOP_PRICE_CENTS: "19900", SHOP_CURRENCY: "pln" }).priceCents, 19900);
  assert.equal(shopConfig({ SHOP_PRICE_CENTS: "free" }).priceCents, null);
  assert.equal(shopConfig({ SHOP_CURRENCY: "pln" }).currency, "PLN");
  assert.equal(shopConfig({}).paymentsEnabled, false);
});
