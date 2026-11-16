import { createClient } from "@supabase/supabase-js";
import { backendUrl, publishableKey } from "./catalog";

// Auth consumes the URL fragment before the lazy account screens mount.
// Retain only the purpose of the link. Supabase verifies the session itself.
function readEmailAction(path: string) {
  if (
    typeof window === "undefined" ||
    location.pathname.replace(/\/$/, "") !== path
  )
    return null;
  const params = new URLSearchParams(location.hash.slice(1));
  const action = params.get("type");
  if (!params.has("access_token")) return null;
  return action === "invite" || action === "recovery" || action === "signup" ? action : null;
}
let adminEmailAction = readEmailAction("/admin");
let customerEmailAction = readEmailAction("/account");
export const customerLinkFailed = typeof window !== "undefined" && location.pathname.replace(/\/$/, "") === "/account" &&
  [location.hash.slice(1), location.search.slice(1)].some(part => {
    const query = new URLSearchParams(part);
    return query.has("error") || query.has("error_code");
  });
export function takeCustomerEmailAction() {
  const action = customerEmailAction;
  customerEmailAction = null;
  return action;
}
export function takeAdminEmailAction() {
  const action = adminEmailAction;
  adminEmailAction = null;
  return action;
}
export const db =
  backendUrl && publishableKey
    ? createClient(backendUrl, publishableKey)
    : null;
export type Receipt = {
  id: string;
  receipt: string;
  kind: "order" | "studio" | "print";
};
function makeReceipt(kind: Receipt["kind"]): Receipt {
  return {
    id: crypto.randomUUID(),
    kind,
    receipt: Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join(""),
  };
}
export function receipts(): Receipt[] {
  try {
    return JSON.parse(sessionStorage.getItem("chroma-receipts") || "[]");
  } catch {
    return [];
  }
}
function remember(r: Receipt) {
  sessionStorage.setItem(
    "chroma-receipts",
    JSON.stringify(
      [r, ...receipts().filter((x) => x.id !== r.id)].slice(0, 40),
    ),
  );
}
export async function submitWork(
  kind: Receipt["kind"],
  body: Record<string, unknown>,
  files: File[] = [],
  progress?: (pct: number) => void,
) {
  const actor = (await db?.auth.getSession())?.data.session?.user.id || "guest";
  const input = JSON.stringify([
    actor,
    kind,
    body,
    files.map((f) => [f.name, f.size, f.lastModified]),
  ]);
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  const fingerprint = Array.from(new Uint8Array(hash), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  const key = "chroma-pending-" + kind;
  const previous = JSON.parse(sessionStorage.getItem(key) || "null");
  const receipt: Receipt =
    previous?.fingerprint === fingerprint
      ? previous.receipt
      : makeReceipt(kind);
  sessionStorage.setItem(key, JSON.stringify({ fingerprint, receipt }));
  await operation({ action: "submit", ...receipt, ...body }, files, progress);
  if (actor === "guest") remember(receipt);
  sessionStorage.removeItem(key);
  return actor === "guest" ? receipt : { id: receipt.id, kind: receipt.kind };
}
export async function operation<T = Record<string, unknown>>(
  data: Record<string, unknown>,
  files: File[] = [],
  progress?: (pct: number) => void,
): Promise<T> {
  if (!db) throw Error("The development backend is unavailable.");
  const session = (await db.auth.getSession()).data.session;
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("POST", backendUrl + "/functions/v1/chroma-api");
    x.timeout = 100000;
    x.setRequestHeader("apikey", publishableKey);
    if (session)
      x.setRequestHeader("Authorization", "Bearer " + session.access_token);
    x.onload = () => {
      let body;
      try {
        body = JSON.parse(x.responseText);
      } catch {
        reject(Error("Unexpected studio response."));
        return;
      }
      if (x.status < 200 || x.status >= 300) {
        reject(Error(body.error || "The studio could not save this request."));
        return;
      }
      resolve(body);
    };
    x.onerror = x.ontimeout = () =>
      reject(Error("Connection interrupted. Retry with the same details."));
    if (files.length) {
      const f = new FormData();
      f.append("data", JSON.stringify(data));
      files.forEach((file) => f.append("file", file));
      x.upload.onprogress = (e) => {
        if (e.lengthComputable)
          progress?.(Math.round((e.loaded / e.total) * 100));
      };
      x.send(f);
    } else {
      x.setRequestHeader("Content-Type", "application/json");
      x.send(JSON.stringify(data));
    }
  });
}
