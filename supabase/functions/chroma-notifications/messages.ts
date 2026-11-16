export type Notification = {
  id: number;
  entity_id: string;
  event: string;
  mode: "test" | "live";
  recipient: string;
  lease_id: string;
  dedupe_key?: string | null;
  payload: {
    name: string; kind: string; status: string; payment_status?: string; title?: string;
    amount_minor?: number; refunded_minor?: number; currency?: string; customer_account: boolean;
    items?: { name: string; quantity: number; format: string }[];
  };
};

export const testRecipients = new Set([
  "chromazen.zen@gmail.com",
  "chromazen.zen+customer1@gmail.com",
  "chromazen.zen+customer2@gmail.com",
]);

const titles: Record<string, string> = {
  "order.submitted": "Order received",
  "order.processing": "Order in progress",
  "order.shipped": "Order marked shipped",
  "order.completed": "Order completed",
  "order.cancelled": "Order cancelled",
  "payment.received": "Payment confirmed",
  "payment.test_received": "Test payment confirmed",
  "payment.refunded": "Refund processed",
  "payment.test_refunded": "Test refund recorded",
  "payment.review_required": "Payment needs studio review",
};
const stages: Record<string, string> = {
  submitted: "received", review: "under review", discussion: "ready for discussion",
  revision: "being revised", awaiting_approval: "ready for your approval", approved: "approved",
  manufacturing: "in manufacturing", shipped: "marked shipped", completed: "completed",
  quoted: "ready for quotation review", accepted: "accepted", rejected: "closed", cancelled: "cancelled", expired: "expired",
};
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const money = (minor: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(minor / 100);

export function renderNotification(row: Notification, forceTest: boolean) {
  if (!Number.isSafeInteger(row.id) || row.id <= 0 || !/^[a-f0-9-]{36}$/i.test(row.entity_id) ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.recipient) || /[\r\n]/.test(row.recipient))
    throw Error("INVALID_NOTIFICATION");
  const testCapture = row.event === "payment.test_received";
  const testRefund = row.event === "payment.test_refunded";
  const test = forceTest || row.mode === "test" || testCapture || testRefund;
  if (test && !testRecipients.has(row.recipient.toLowerCase())) throw Error("TEST_RECIPIENT_RESTRICTED");
  const data = row.payload;
  const corrected = testCapture && row.dedupe_key?.startsWith("correction:payment-status:");
  let title = corrected ? "Corrected test payment confirmation" : titles[row.event];
  if (!title && ["print", "studio"].includes(data.kind) && stages[data.status])
    title = (data.kind === "print" ? "Print request " : "Studio project ") + stages[data.status];
  if (!title) throw Error("UNSUPPORTED_EVENT");
  const reference = row.entity_id.slice(0, 8);
  const paymentLabels: Record<string, string> = {
    unpaid: "Awaiting payment", verified: "Paid", partially_refunded: "Partially refunded", refunded: "Refunded",
  };
  // Sandbox captures deliberately leave the real-money ledger unpaid. Describe
  // the trusted event, rather than presenting that internal value as a failed payment.
  const paymentStatus = testCapture ? "Paid (Test Mode)" : testRefund ?
    ((data.refunded_minor ?? 0) >= (data.amount_minor ?? Infinity) ? "Refunded" : "Partially refunded") + " (Test Mode)" :
    data.payment_status ? (paymentLabels[data.payment_status] ?? data.payment_status.replaceAll("_", " ")) +
      (test && data.payment_status !== "unpaid" ? " (Test Mode)" : "") : undefined;
  const lines = [
    ...(test ? ["TEST MESSAGE · Chroma3D testing environment.",
      "No real money is collected or refunded in Test Mode. Test payments do not unlock purchased STL files.", ""] : []),
    "Hello " + data.name + ",", "", title + ".",
    ...(corrected ? ["This corrects the payment-status text in our earlier confirmation."] : []),
    "Reference " + reference,
    testCapture || testRefund ? "Fulfilment On hold (Test Mode)" :
      (data.kind === "order" ? "Order status " : "Status ") + (stages[data.status] ?? data.status.replaceAll("_", " ")),
    ...(paymentStatus ? ["Payment status " + paymentStatus] : []),
    ...(data.title ? ["Project " + data.title] : []),
    ...(data.amount_minor != null ? ["Amount " + money(data.amount_minor)] : []),
    ...(data.refunded_minor ? ["Refunded " + money(data.refunded_minor)] : []),
    ...(data.items ?? []).map(item => item.name + " × " + item.quantity + (item.format === "stl" ? " · digital STL" : " · printed")),
    "", data.customer_account ? "Open My Account to review your order or project." :
      "Open Your requests in the browser where you submitted this request. Keep your saved receipt private.",
  ];
  const url = "https://chroma3d-website.vercel.app/" + (data.customer_account ? "account" : "requests");
  const text = lines.join("\n") + "\n" + url + "\n\nChroma3D\nReply to this email if you need help.";
  const html = '<!doctype html><html><body style="margin:0;background:#f5f4f0;color:#171815;font-family:Arial,sans-serif">' +
    '<main style="max-width:580px;margin:32px auto;background:#fff;padding:32px">' +
    '<p style="font-size:24px;font-weight:700">Chroma<span style="color:#e85f15">3D</span></p>' +
    '<h1 style="font-size:26px;line-height:1.25">' + escape((test ? "[TEST] " : "") + title) + '</h1>' +
    lines.map(line => '<p style="font-size:15px;line-height:1.6;margin:8px 0">' + (line ? escape(line) : "&nbsp;") + '</p>').join("") +
    '<p style="margin-top:24px"><a style="color:#a63800" href="' + url + '">' + (data.customer_account ? "Open My Account" : "Open Your requests") +
    '</a></p><p style="font-size:13px;color:#555">Chroma3D · Reply to this email if you need help.</p></main></body></html>';
  return {
    to: row.recipient,
    subject: (test ? "[TEST] " : "") + "Chroma3D · " + title + " · " + reference,
    messageId: "<chroma3d-mbilemzzpoxdwujyswfk-" + row.id + "@gmail.com>",
    text, html,
  };
}

export function deliveryFailure(error: { code?: string; command?: string; responseCode?: number }) {
  if (error.code === "EAUTH") return { outcome: "retry", reason: "SMTP_AUTH_REQUIRED" };
  if (error.responseCode && error.responseCode >= 500) return { outcome: "failed", reason: "SMTP_REJECTED" };
  if (error.responseCode && error.responseCode >= 400) return { outcome: "retry", reason: "SMTP_TEMPORARY_REJECTION" };
  if (/^(CONN|EHLO|HELO|AUTH|MAIL FROM|RCPT TO)/.test(error.command ?? ""))
    return { outcome: "retry", reason: "SMTP_CONNECTION_FAILED" };
  // Losing the DATA acknowledgement may mean Gmail accepted the message.
  return { outcome: "unknown", reason: "SMTP_DELIVERY_UNCERTAIN" };
}
