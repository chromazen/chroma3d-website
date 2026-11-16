import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { handleGatewayEvent, openSandboxPayment, paymentKeys, sandboxKeys, webhookSecret } from "../functions/chroma-api/payments.ts";

const keys = { id: "rzp_test_fixture", secret: "fixture-api", webhook: "fixture-hook" };
const order = { id: "00000000-0000-4000-8000-000000000001", currency: "INR", total_minor: 10000 };
const link = { id: "plink_Fixture", reference_id: "C3T" + order.id, amount: order.total_minor,
  amount_paid: 0, currency: "INR", status: "created", short_url: "https://rzp.io/i/fixture" };
const paid = { ...link, status: "paid", amount_paid: link.amount,
  payments: [{ status: "captured", amount: link.amount, payment_id: "pay_Fixture" }] };
const capturedPayment = { id: "pay_Fixture", amount: link.amount, currency: "INR", status: "captured", captured: true, amount_refunded: 0 };
const event = new TextEncoder().encode(JSON.stringify({ event: "payment_link.paid",
  payload: { payment_link: { entity: { id: link.id, reference_id: link.reference_id } } } }));
const signature = createHmac("sha256", keys.webhook).update(event).digest("hex");
const noCapture = async () => assert.fail("unexpected capture");

test("only fully configured test keys are accepted", () => {
  assert.equal(sandboxKeys(() => undefined), null);
  assert.equal(sandboxKeys(() => "rzp_live_fixture"), null);
});

test("live credentials require explicit server activation and matching mode", () => {
  const env = {
    CHROMA_PAYMENT_MODE: "live",
    CHROMA_RAZORPAY_LIVE_KEY_ID: "rzp_live_fixture",
    CHROMA_RAZORPAY_LIVE_KEY_SECRET: "fixture-secret",
    CHROMA_RAZORPAY_LIVE_WEBHOOK_SECRET: "fixture-hook",
  };
  const get = key => env[key];
  assert.equal(paymentKeys(get), null);
  assert.equal(webhookSecret(get), undefined);
  env.CHROMA_ALLOW_LIVE_PAYMENTS = "true";
  assert.equal(paymentKeys(get).mode, "live");
  env.CHROMA_RAZORPAY_LIVE_KEY_ID = "rzp_test_fixture";
  assert.equal(paymentKeys(get), null);
});

test("create or recover the unique merchant reference with no automatic notifications", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url, opts) => {
    calls++;
    if (opts.method === "GET") {
      assert.equal(new URL(url).searchParams.get("reference_id"), link.reference_id);
      return Response.json({ payment_links: calls === 1 ? [] : [link] });
    }
    const body = JSON.parse(opts.body);
    assert.equal(body.amount, order.total_minor);
    assert.equal(body.reference_id, link.reference_id);
    assert.deepEqual(body.notify, { email: false, sms: false });
    assert.deepEqual(body.options.checkout.config.display.hide, [{ method: "upi", flows: ["qr", "intent"] }]);
    return new Response(null, { status: 409 });
  });
  assert.equal((await openSandboxPayment(order, keys, noCapture)).checkoutUrl, link.short_url);
  assert.equal(calls, 3);
});

test("refuse mismatched amounts and foreign checkout destinations", async t => {
  let response = { ...link, amount: 3 };
  t.mock.method(globalThis, "fetch", async () => Response.json({ payment_links: [response] }));
  await assert.rejects(openSandboxPayment(order, keys, noCapture), /does not match/);
  response = { ...link, short_url: "https://example.invalid/checkout" };
  await assert.rejects(openSandboxPayment(order, keys, noCapture), /Unexpected checkout/);
});

test("verify raw webhook bytes, then independently fetch the captured payment", async t => {
  let response = paid, lookups = 0;
  t.mock.method(globalThis, "fetch", async (url, opts) => {
    assert.equal(opts.method, "GET"); lookups++;
    if (url.endsWith("/payments/pay_Fixture")) return Response.json(capturedPayment);
    assert.equal(url, "https://api.razorpay.com/v1/payment_links/" + link.id);
    return Response.json(response);
  });
  await assert.rejects(handleGatewayEvent(event, null, keys.webhook, null, noCapture), /signature/);
  await assert.rejects(handleGatewayEvent(event, "0".repeat(64), keys.webhook, null, noCapture), /signature/);
  await assert.rejects(handleGatewayEvent(new Uint8Array([...event,32]), signature, keys.webhook, keys, noCapture), /signature/);
  await assert.rejects(handleGatewayEvent(event, signature, keys.webhook, null, noCapture), /credentials/);
  assert.equal(lookups, 0);
  let captured;
  await handleGatewayEvent(event, signature, keys.webhook, keys, async (...args) => {captured = args;});
  assert.deepEqual(captured, [order.id, "pay_Fixture", link.amount, "INR", 0]);
  response = { ...paid, amount_paid: 500 };
  await assert.rejects(handleGatewayEvent(event, signature, keys.webhook, keys, noCapture), /full payment/);
});

test("customer can reconcile an already paid link after closing the gateway", async t => {
  t.mock.method(globalThis, "fetch", async url => Response.json(
    url.endsWith("pay_Fixture") ? capturedPayment : url.endsWith(link.id) ? paid : { payment_links: [paid] }
  ));
  let captured = false;
  const result = await openSandboxPayment(order, keys, async () => {captured=true;});
  assert.equal(captured, true); assert.deepEqual(result, {received:true});
});

test("redelivery of the same signed event produces the same settlement identity", async t => {
  t.mock.method(globalThis, "fetch", async url => Response.json(url.endsWith("pay_Fixture") ? capturedPayment : paid));
  const calls = [];
  const capture = async (...args) => { calls.push(args); };
  await handleGatewayEvent(event, signature, keys.webhook, keys, capture);
  await handleGatewayEvent(event, signature, keys.webhook, keys, capture);
  assert.deepEqual(calls, Array(2).fill([order.id, "pay_Fixture", link.amount, "INR", 0]));
});

test("a link cannot settle across payment modes or without a captured payment", async t => {
  let payment = { ...capturedPayment, captured: false, status: "authorized" };
  let response = paid;
  t.mock.method(globalThis, "fetch", async url => Response.json(url.endsWith("pay_Fixture") ? payment : response));
  await assert.rejects(handleGatewayEvent(event, signature, keys.webhook, keys, noCapture), /captured payment/);
  payment = capturedPayment;
  response = { ...paid, reference_id: "C3L" + order.id };
  const changed = new TextEncoder().encode(JSON.stringify({ event: "payment_link.paid", payload: { payment_link: { entity: response } } }));
  const signed = createHmac("sha256", keys.webhook).update(changed).digest("hex");
  await assert.rejects(handleGatewayEvent(changed, signed, keys.webhook, keys, noCapture), /full payment/);
});

test("refunds use authoritative refund and payment amounts and are safe to redeliver", async t => {
  const body = new TextEncoder().encode(JSON.stringify({ event: "refund.processed", payload: { refund: { entity: { id: "rfnd_Fixture", amount: 1 } } } }));
  const signed = createHmac("sha256", keys.webhook).update(body).digest("hex");
  let refund = { id: "rfnd_Fixture", payment_id: capturedPayment.id, status: "processed", amount: 2000, currency: "INR" };
  t.mock.method(globalThis, "fetch", async url => Response.json(
    url.endsWith("rfnd_Fixture") ? refund : { ...capturedPayment, amount_refunded: 2000 }
  ));
  const calls = [], record = async (...args) => { calls.push(args); };
  await handleGatewayEvent(body, signed, keys.webhook, keys, noCapture, record);
  await handleGatewayEvent(body, signed, keys.webhook, keys, noCapture, record);
  assert.deepEqual(calls, Array(2).fill(["rfnd_Fixture", "pay_Fixture", 2000, "INR", link.amount, 2000]));
  refund = { ...refund, amount: link.amount + 1 };
  await assert.rejects(handleGatewayEvent(body, signed, keys.webhook, keys, noCapture, record), /match the captured/);
});

test("a failed payment is recorded without invoking settlement", async t => {
  const body = new TextEncoder().encode(JSON.stringify({ event: "payment.failed", payload: { payment: { entity: { id: capturedPayment.id } } } }));
  const signed = createHmac("sha256", keys.webhook).update(body).digest("hex");
  t.mock.method(globalThis, "fetch", async () => Response.json({ ...capturedPayment, captured: false, status: "failed" }));
  let failure;
  await handleGatewayEvent(body, signed, keys.webhook, keys, noCapture, undefined, async (...args) => {failure=args;});
  assert.deepEqual(failure, ["pay_Fixture", link.amount, "INR"]);
});
