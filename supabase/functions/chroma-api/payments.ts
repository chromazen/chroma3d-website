import { Invalid } from "./errors.ts";

type Keys = { id: string; secret: string; webhook: string };
type Order = { id: string; total_minor: number; currency: string };
type Link = {
  id: string; reference_id: string; amount: number; amount_paid: number; currency: string;
  status: string; short_url: string;
  payments?: { payment_id: string; status: string; amount: number }[] | null;
};
type Capture = (orderId: string, paymentId: string, amount: number, currency: string) => Promise<void>;
const reference = (id: string) => "C3T" + id;
const linkId = /^plink_[a-zA-Z0-9]+$/;
const storeReference = /^C3T([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i;
const encoder = new TextEncoder();

export function sandboxKeys(get: (name: string) => string | undefined): Keys | null {
  const id = get("CHROMA_RAZORPAY_TEST_KEY_ID")?.trim(), secret = get("CHROMA_RAZORPAY_TEST_KEY_SECRET")?.trim();
  const webhook = get("CHROMA_RAZORPAY_TEST_WEBHOOK_SECRET");
  return id?.startsWith("rzp_test_") && secret && webhook ? { id, secret, webhook } : null;
}

async function api<T>(keys: Keys, path: string, body?: object): Promise<T> {
  const result = await fetch("https://api.razorpay.com/v1/payment_links" + path, {
    method: body ? "POST" : "GET", redirect: "error", signal: AbortSignal.timeout(12000),
    headers: { Authorization: "Basic " + btoa(keys.id + ":" + keys.secret), "Content-Type": "application/json" },
    body: body && JSON.stringify(body),
  });
  if (!result.ok) throw new Invalid("Razorpay test checkout is unavailable. Retry from your saved order.", 502);
  return await result.json();
}

async function settle(link: Link, capture: Capture) {
  const match = storeReference.exec(link.reference_id);
  const payment = link.payments?.find(p => p.status === "captured" && p.amount === link.amount);
  if (!match || link.status !== "paid" || !payment || !/^pay_[a-zA-Z0-9]+$/.test(payment.payment_id) ||
      !Number.isSafeInteger(link.amount) || link.amount <= 0 || link.amount_paid !== link.amount || link.currency !== "INR")
    throw new Invalid("The gateway has not confirmed a full payment.", 409);
  await capture(match[1], payment.payment_id, link.amount, link.currency);
}

export async function openSandboxPayment(order: Order, keys: Keys, capture: Capture) {
  const ref = reference(order.id);
  const lookup = async () => {
    const found = await api<{payment_links: Link[]}>(keys, "?reference_id=" + encodeURIComponent(ref));
    return found.payment_links.find(l => l.reference_id === ref);
  };
  let link = await lookup();
  if (!link) {
    try {
      link = await api<Link>(keys, "", { amount: order.total_minor, currency: order.currency,
        reference_id: ref, accept_partial: false, description: "Chroma3D test order " + order.id.slice(0,8),
        // Real UPI apps cannot pay a sandbox QR. Keep the simulated UPI ID flow where offered.
        options: { checkout: { config: { display: {
          hide: [{ method: "upi", flows: ["qr", "intent"] }],
        } } } },
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
    const paid = await api<Link>(keys, "/" + link.id);
    if (paid.reference_id !== ref || paid.id !== link.id) throw new Invalid("Unexpected gateway order.", 409);
    await settle(paid, capture);
    return { received: true };
  }
  if (link.status !== "created") throw new Invalid("This payment link is closed. Contact the studio about your order.", 409);
  const checkout = new URL(link.short_url);
  if (checkout.protocol !== "https:" || checkout.username || checkout.password || checkout.port ||
      !["rzp.io", "rzp.to", "razorpay.com", "pages.razorpay.com"].includes(checkout.hostname))
    throw new Invalid("Unexpected checkout address.", 502);
  return { checkoutUrl: checkout.href };
}

export async function handleGatewayEvent(raw: Uint8Array<ArrayBuffer>, signature: string | null, secret: string, keys: Keys | null, capture: Capture) {
  if (!signature || !/^[a-f0-9]{64}$/i.test(signature)) throw new Invalid("Invalid payment signature.", 401);
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const bytes = Uint8Array.from(signature.match(/../g)!, value => parseInt(value, 16));
  if (!await crypto.subtle.verify("HMAC", key, bytes, raw)) throw new Invalid("Invalid payment signature.", 401);
  const event = JSON.parse(new TextDecoder().decode(raw));
  if (event.event !== "payment_link.paid") return;
  const entity = event.payload?.payment_link?.entity;
  if (!entity || !storeReference.test(entity.reference_id)) return;
  if (!linkId.test(entity.id)) throw new Invalid("Invalid payment link.", 400);
  if (!keys) throw new Invalid("Razorpay test API credentials are not configured.", 503);
  // Re-read with this merchant's test API credentials before recording a capture.
  const paid = await api<Link>(keys, "/" + entity.id);
  if (paid.id !== entity.id || paid.reference_id !== entity.reference_id) throw new Invalid("Unexpected gateway order.", 409);
  await settle(paid, capture);
}
