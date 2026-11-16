import { Invalid } from "./errors.ts";

export type PaymentMode = "test" | "live";
type Keys = { id: string; secret: string; webhook: string; mode?: PaymentMode };
type Order = { id: string; total_minor: number; currency: string };
type Link = {
  id: string; reference_id: string; amount: number; amount_paid: number; currency: string;
  status: string; short_url: string;
  payments?: { payment_id: string; status: string; amount: number }[] | null;
};
type Payment = { id: string; amount: number; currency: string; status: string; captured: boolean; amount_refunded: number };
type Refund = { id: string; payment_id: string; amount: number; currency: string; status: string };
type Capture = (orderId: string, paymentId: string, amount: number, currency: string, refunded?: number) => Promise<void>;
type RefundHandler = (id: string, paymentId: string, amount: number, currency: string, capturedAmount: number, totalRefunded: number) => Promise<void>;
type FailureHandler = (paymentId: string, amount: number, currency: string) => Promise<void>;
const modeOf = (keys: Keys): PaymentMode => keys.mode ?? "test";
const reference = (id: string, keys: Keys) => (modeOf(keys) === "test" ? "C3T" : "C3L") + id;
const linkId = /^plink_[a-zA-Z0-9]+$/;
const storeReference = /^C3([TL])([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i;
const paymentId = /^pay_[a-zA-Z0-9]+$/;
const encoder = new TextEncoder();

export function sandboxKeys(get: (name: string) => string | undefined): Keys | null {
  const id = get("CHROMA_RAZORPAY_TEST_KEY_ID")?.trim(), secret = get("CHROMA_RAZORPAY_TEST_KEY_SECRET")?.trim();
  const webhook = get("CHROMA_RAZORPAY_TEST_WEBHOOK_SECRET");
  return id?.startsWith("rzp_test_") && secret && webhook ? { id, secret, webhook } : null;
}

export function paymentKeys(get: (name: string) => string | undefined): Keys | null {
  const mode = get("CHROMA_PAYMENT_MODE") ?? "test";
  if (mode === "test") return sandboxKeys(get);
  if (mode !== "live" || get("CHROMA_ALLOW_LIVE_PAYMENTS") !== "true") return null;
  const id = get("CHROMA_RAZORPAY_LIVE_KEY_ID")?.trim();
  const secret = get("CHROMA_RAZORPAY_LIVE_KEY_SECRET")?.trim();
  const webhook = get("CHROMA_RAZORPAY_LIVE_WEBHOOK_SECRET");
  return id?.startsWith("rzp_live_") && secret && webhook ? { id, secret, webhook, mode: "live" } : null;
}

export function webhookSecret(get: (name: string) => string | undefined) {
  const mode = get("CHROMA_PAYMENT_MODE") ?? "test";
  if (mode === "test") return get("CHROMA_RAZORPAY_TEST_WEBHOOK_SECRET");
  if (mode === "live" && get("CHROMA_ALLOW_LIVE_PAYMENTS") === "true") return get("CHROMA_RAZORPAY_LIVE_WEBHOOK_SECRET");
  return undefined;
}

async function api<T>(keys: Keys, path: string, body?: object): Promise<T> {
  const result = await fetch("https://api.razorpay.com/v1" + path, {
    method: body ? "POST" : "GET", redirect: "error", signal: AbortSignal.timeout(12000),
    headers: { Authorization: "Basic " + btoa(keys.id + ":" + keys.secret), "Content-Type": "application/json" },
    body: body && JSON.stringify(body),
  });
  if (!result.ok) throw new Invalid("Razorpay checkout is unavailable. Retry from your saved order.", 502);
  return await result.json();
}

async function settle(link: Link, keys: Keys, capture: Capture) {
  const match = storeReference.exec(link.reference_id);
  const payment = link.payments?.find(p => p.status === "captured" && p.amount === link.amount);
  if (!match || link.reference_id !== reference(match[2], keys) || link.status !== "paid" || !payment || !paymentId.test(payment.payment_id) ||
      !Number.isSafeInteger(link.amount) || link.amount <= 0 || link.amount_paid !== link.amount || link.currency !== "INR")
    throw new Invalid("The gateway has not confirmed a full payment.", 409);
  const paid = await api<Payment>(keys, "/payments/" + payment.payment_id);
  if (paid.id !== payment.payment_id || !paid.captured || !["captured", "refunded"].includes(paid.status) ||
      paid.amount !== link.amount || paid.currency !== link.currency || !Number.isSafeInteger(paid.amount_refunded) ||
      paid.amount_refunded < 0 || paid.amount_refunded > paid.amount)
    throw new Invalid("The captured payment does not match the order.", 409);
  await capture(match[2], paid.id, paid.amount, paid.currency, paid.amount_refunded);
}

export async function openSandboxPayment(order: Order, keys: Keys, capture: Capture) {
  if (modeOf(keys) !== "test") throw new Invalid("This checkout requires Test Mode.", 409);
  return openPayment(order, keys, capture);
}

export async function openPayment(order: Order, keys: Keys, capture: Capture) {
  const ref = reference(order.id, keys);
  const lookup = async () => {
    const found = await api<{payment_links: Link[]}>(keys, "/payment_links?reference_id=" + encodeURIComponent(ref));
    return found.payment_links.find(l => l.reference_id === ref);
  };
  let link = await lookup();
  if (!link) {
    try {
      link = await api<Link>(keys, "/payment_links", { amount: order.total_minor, currency: order.currency,
        reference_id: ref, accept_partial: false,
        description: "Chroma3D " + (modeOf(keys) === "test" ? "test " : "") + "order " + order.id.slice(0,8),
        // Real UPI apps cannot pay a sandbox QR. Keep the simulated UPI ID flow where offered.
        ...(modeOf(keys) === "test" ? { options: { checkout: { config: { display: {
          hide: [{ method: "upi", flows: ["qr", "intent"] }],
        } } } } } : {}),
        notify: { email: false, sms: false }, reminder_enable: false });
    } catch (error) {
      // The gateway may already have accepted this unique reference on a concurrent or interrupted request.
      link = await lookup();
      if (!link) throw error;
    }
  }
  if (!linkId.test(link.id) || link.reference_id !== ref || link.amount !== order.total_minor || link.currency !== order.currency)
    throw new Invalid("The gateway order does not match the saved order.", 409);
  if (link.status === "paid") {
    const paid = await api<Link>(keys, "/payment_links/" + link.id);
    if (paid.reference_id !== ref || paid.id !== link.id) throw new Invalid("Unexpected gateway order.", 409);
    await settle(paid, keys, capture);
    return { received: true };
  }
  if (link.status !== "created") throw new Invalid("This payment link is closed. Contact the studio about your order.", 409);
  const checkout = new URL(link.short_url);
  if (checkout.protocol !== "https:" || checkout.username || checkout.password || checkout.port ||
      !["rzp.io", "rzp.to", "razorpay.com", "pages.razorpay.com"].includes(checkout.hostname))
    throw new Invalid("Unexpected checkout address.", 502);
  return { checkoutUrl: checkout.href };
}

export async function handleGatewayEvent(
  raw: Uint8Array<ArrayBuffer>, signature: string | null, secret: string, keys: Keys | null,
  capture: Capture, refund?: RefundHandler, failure?: FailureHandler,
) {
  if (!signature || !/^[a-f0-9]{64}$/i.test(signature)) throw new Invalid("Invalid payment signature.", 401);
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const bytes = Uint8Array.from(signature.match(/../g)!, value => parseInt(value, 16));
  if (!await crypto.subtle.verify("HMAC", key, bytes, raw)) throw new Invalid("Invalid payment signature.", 401);
  const event = JSON.parse(new TextDecoder().decode(raw));
  if (!["payment_link.paid", "refund.processed", "payment.failed"].includes(event.event)) return;
  if (!keys) throw new Invalid("Razorpay credentials are not configured.", 503);
  if (event.event === "payment_link.paid") {
    const entity = event.payload?.payment_link?.entity;
    if (!entity || !storeReference.test(entity.reference_id)) return;
    if (!linkId.test(entity.id)) throw new Invalid("Invalid payment link.", 400);
    const paid = await api<Link>(keys, "/payment_links/" + entity.id);
    if (paid.id !== entity.id || paid.reference_id !== entity.reference_id) throw new Invalid("Unexpected gateway order.", 409);
    await settle(paid, keys, capture);
    return;
  }
  if (event.event === "refund.processed") {
    const entity = event.payload?.refund?.entity;
    if (!entity || !/^rfnd_[a-zA-Z0-9]+$/.test(entity.id) || !refund) throw new Invalid("Invalid refund event.", 400);
    const returned = await api<Refund>(keys, "/refunds/" + entity.id);
    if (returned.id !== entity.id || !paymentId.test(returned.payment_id) || returned.status !== "processed" ||
        returned.currency !== "INR" || !Number.isSafeInteger(returned.amount) || returned.amount <= 0)
      throw new Invalid("Refund is not confirmed.", 409);
    const paid = await api<Payment>(keys, "/payments/" + returned.payment_id);
    if (paid.id !== returned.payment_id || !paid.captured || paid.currency !== returned.currency ||
        !Number.isSafeInteger(paid.amount) || paid.amount <= 0 || !Number.isSafeInteger(paid.amount_refunded) ||
        paid.amount_refunded < returned.amount || paid.amount_refunded > paid.amount)
      throw new Invalid("Refund does not match the captured payment.", 409);
    await refund(returned.id, paid.id, returned.amount, returned.currency, paid.amount, paid.amount_refunded);
    return;
  }
  const entity = event.payload?.payment?.entity;
  if (!entity || !paymentId.test(entity.id)) throw new Invalid("Invalid failed payment event.", 400);
  const paid = await api<Payment>(keys, "/payments/" + entity.id);
  if (paid.id !== entity.id || paid.status !== "failed" || paid.captured || paid.currency !== "INR" ||
      !Number.isSafeInteger(paid.amount) || paid.amount <= 0)
    throw new Invalid("Payment failure is not confirmed.", 409);
  if (failure) await failure(paid.id, paid.amount, paid.currency);
}
