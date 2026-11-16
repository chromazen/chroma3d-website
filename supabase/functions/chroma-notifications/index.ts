import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import nodemailer from "npm:nodemailer@10.4.0";
import { deliveryFailure, renderNotification } from "./messages.ts";
import type { Notification } from "./messages.ts";

const url = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
  Object.values(JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}"))[0] as string;
const publicKey = Deno.env.get("SUPABASE_ANON_KEY") ||
  Object.values(JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}"))[0] as string;
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const db = createClient(url, serviceKey, options);
const allowedOrigins = new Set(["https://chroma3d-website.vercel.app", "http://localhost:5209", "http://127.0.0.1:5209"]);

async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = await db.rpc(name, args);
  if (result.error) throw Error("DELIVERY_DATABASE_ERROR");
  return result.data as T;
}

async function requireAdmin(req: Request) {
  const bearer = req.headers.get("authorization");
  if (!bearer?.startsWith("Bearer ")) return false;
  const user = await db.auth.getUser(bearer.slice(7));
  if (user.error || !user.data.user) return false;
  const client = createClient(url, publicKey, { ...options, global: { headers: { Authorization: bearer } } });
  const access = await client.rpc("admin_access");
  return !access.error && access.data === "admin";
}

async function finish(row: Notification, outcome: string, reason: string | null = null) {
  // Retrying the database acknowledgement never resends the email.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const done = await rpc<boolean>("finish_notification", {
        p_id: row.id, p_lease: row.lease_id, p_outcome: outcome, p_error: reason,
      });
      if (done) return;
    } catch {
      if (attempt === 1) throw Error("DELIVERY_ACKNOWLEDGEMENT_PENDING");
    }
  }
  throw Error("DELIVERY_ACKNOWLEDGEMENT_PENDING");
}

Deno.serve(async req => {
  const origin = req.headers.get("origin");
  const cors = {
    ...(origin && allowedOrigins.has(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS", "Cache-Control": "no-store",
  };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { ...cors, "Content-Type": "application/json" },
  });
  if (origin && !allowedOrigins.has(origin)) return json({ error: "Origin denied" }, 403);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  let transport: ReturnType<typeof nodemailer.createTransport> | undefined;
  try {
    const workerToken = req.headers.get("x-chroma-worker");
    const scheduled = !!workerToken && await rpc<boolean>("notification_worker_access", { p_token: workerToken });
    if (!scheduled && !await requireAdmin(req)) return json({ error: "Administrator MFA or worker authentication required" }, 403);
    const raw = await req.text();
    if (raw.length > 4096) return json({ error: "Request too large" }, 413);
    const input = raw ? JSON.parse(raw) : {};
    const action = input.action ?? "run";
    if (!["setup", "run", "status"].includes(action)) return json({ error: "Unknown action" }, 400);
    if (scheduled && action !== "run") return json({ error: "Owner action required" }, 403);
    const settings = await rpc<{ enabled: boolean; test_mode: boolean }>("notification_delivery_settings");
    if (action === "status") return json(settings);
    if (action !== "setup" && !settings.enabled) return json({ paused: true });
    const password = Deno.env.get("CHROMA_SMTP_PASSWORD");
    if (!password) return json({ error: "CHROMA_SMTP_PASSWORD is required" }, 503);
    transport = nodemailer.createTransport({
      host: "smtp.gmail.com", port: 465, secure: true,
      auth: { user: "chromazen.zen@gmail.com", pass: password },
      tls: { minVersion: "TLSv1.2" },
      connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 12000,
      disableFileAccess: true, disableUrlAccess: true, logger: false, debug: false,
    });
    if (action === "setup") {
      await transport.verify();
      await rpc("configure_notification_worker");
      return json({ smtp_verified: true, scheduled: true, test_mode: settings.test_mode });
    }
    const rows = await rpc<Notification[]>("claim_notifications");
    let delivered = 0, deferred = 0;
    for (const row of rows) {
      let message;
      try { message = renderNotification(row, settings.test_mode); }
      catch {
        await finish(row, "skipped", "INVALID_OR_RESTRICTED_MESSAGE");
        deferred++; continue;
      }
      try {
        const sent = await transport.sendMail({ ...message, from: '"Chroma3D" <chromazen.zen@gmail.com>' });
        if (!Array.isArray(sent.accepted) || sent.accepted.length !== 1) {
          await finish(row, "failed", "SMTP_RECIPIENT_REJECTED");
          deferred++; continue;
        }
      } catch (error) {
        const failure = deliveryFailure(error as { code?: string; command?: string; responseCode?: number });
        await finish(row, failure.outcome, failure.reason);
        if ((error as { code?: string }).code === "EAUTH") await rpc("pause_notification_delivery");
        deferred++; continue;
      }
      await finish(row, "delivered");
      delivered++;
    }
    return json({ delivered, deferred, test_mode: settings.test_mode });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "EAUTH") await db.rpc("pause_notification_delivery");
    const allowed = new Set(["DELIVERY_DATABASE_ERROR", "DELIVERY_ACKNOWLEDGEMENT_PENDING"]);
    const message = error instanceof Error && allowed.has(error.message) ? error.message :
      code === "EAUTH" ? "SMTP_AUTH_REQUIRED" : "NOTIFICATION_SERVICE_UNAVAILABLE";
    return json({ error: message }, 503);
  } finally {
    transport?.close();
  }
});
