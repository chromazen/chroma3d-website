import { test } from "node:test";
import assert from "node:assert/strict";
import { deliveryFailure, renderNotification } from "../functions/chroma-notifications/messages.ts";

const row = {
  id: 37, entity_id: "00000000-0000-4000-8000-000000000001", event: "order.submitted", mode: "test",
  recipient: "chromazen.zen+customer2@gmail.com", lease_id: "00000000-0000-4000-8000-000000000002",
  payload: { name: '<img src=x onerror="bad()">', kind: "order", status: "pending", payment_status: "unpaid",
    amount_minor: 1000, customer_account: true, items: [{ name: "<script>bad()</script>", quantity: 1, format: "stl" }] },
};

test("test emails have fixed recipients, safe HTML, an account link and a stable message identity", () => {
  const first = renderNotification(row, true);
  assert.match(first.subject, /^\[TEST\]/);
  assert.match(first.text, /No real money/);
  assert.match(first.text, /https:\/\/chroma3d-website.vercel.app\/account/);
  assert(!first.html.includes("<script>") && !first.html.includes("<img src=x"));
  assert.equal(first.messageId, renderNotification(row, true).messageId);
  assert.throws(() => renderNotification({ ...row, recipient: "outsider@example.invalid" }, true), /RESTRICTED/);
  assert.throws(() => renderNotification({ ...row, recipient: "x@example.invalid\r\nBcc:a@example.invalid" }, false), /INVALID/);
});

test("test mode cannot be removed by the queued payload and guest messages never expose receipts", () => {
  const message = renderNotification({ ...row, mode: "live", payload: { ...row.payload, customer_account: false } }, true);
  assert.match(message.subject, /^\[TEST\]/);
  assert.match(message.text, /\/requests/);
  assert(!message.text.includes("access_token="));
});

test("a confirmed sandbox payment never displays the unpaid real-money ledger status", () => {
  const message = renderNotification({ ...row, event: "payment.test_received" }, true);
  assert.match(message.text, /Payment status Paid \(Test Mode\)/);
  assert.match(message.html, /Payment status Paid \(Test Mode\)/);
  assert.match(message.text, /Fulfilment On hold \(Test Mode\)/);
  assert(!/Payment status (unpaid|Awaiting payment)/i.test(message.text));
  assert.equal(row.payload.payment_status, "unpaid");
  const early = renderNotification(row, true);
  assert.match(early.text, /Payment status Awaiting payment/);
  assert(!early.text.includes("Payment status Paid"));
  assert.match(renderNotification({ ...row, event: "payment.test_received", mode: "live" }, false).subject, /^\[TEST\]/);
  const correction = renderNotification({ ...row, event: "payment.test_received", dedupe_key: "correction:payment-status:pay_Test" }, true);
  assert.match(correction.subject, /Corrected test payment confirmation/);
  assert.match(correction.text, /This corrects the payment-status text/);
  assert.match(correction.text, /Payment status Paid \(Test Mode\)/);
});

test("refund and genuine payment messages use distinct payment and fulfilment labels", () => {
  for (const [refunded, label] of [[400, "Partially refunded"], [1000, "Refunded"]]) {
    const message = renderNotification({ ...row, event: "payment.test_refunded", payload: { ...row.payload, refunded_minor: refunded } }, true);
    assert(message.text.includes("Payment status " + label + " (Test Mode)"));
    assert(!message.text.includes("Payment status Awaiting payment"));
  }
  const paid = renderNotification({ ...row, mode: "live", event: "payment.received", payload: { ...row.payload, payment_status: "verified" } }, false);
  assert.match(paid.text, /Payment status Paid\n/);
  assert(!paid.text.includes("Test Mode"));
});

test("SMTP uncertainty is retained for review instead of automatically resending", () => {
  assert.equal(deliveryFailure({ code: "ETIMEDOUT", command: "DATA" }).outcome, "unknown");
  assert.equal(deliveryFailure({ code: "ETIMEDOUT", command: "CONN" }).outcome, "retry");
  assert.equal(deliveryFailure({ code: "EAUTH", responseCode: 535 }).outcome, "retry");
  assert.equal(deliveryFailure({ responseCode: 550 }).outcome, "failed");
  assert.equal(deliveryFailure({ responseCode: 451 }).outcome, "retry");
});
