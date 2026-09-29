// Validation for shop orders (pure, so it can be unit tested without a database).
const clean = (value, max) => String(value ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max);
const validEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

export function validateOrder(body, { maxQuantity = 10 } = {}) {
  const value = {
    name: clean(body?.name, 100),
    email: clean(body?.email, 200).toLowerCase(),
    phone: clean(body?.phone, 40),
    country: clean(body?.country, 80),
    address: clean(body?.address, 400),
    note: clean(body?.note, 1000),
    quantity: Number(body?.quantity),
  };
  if (value.name.length < 2) return { error: "Enter your name" };
  if (!validEmail(value.email)) return { error: "Enter a valid email" };
  if (value.country.length < 2) return { error: "Enter the delivery country" };
  if (value.address.length < 5) return { error: "Enter the delivery address" };
  if (!Number.isInteger(value.quantity) || value.quantity < 1 || value.quantity > maxQuantity) return { error: `Quantity must be between 1 and ${maxQuantity}` };
  if (body?.consent !== true) return { error: "Confirm that this is a pre-order" };
  return { value };
}

export const orderNumber = (number) => `D3-${String(number).padStart(4, "0")}`;
