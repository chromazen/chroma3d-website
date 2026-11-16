import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import { handleGatewayEvent, openPayment, paymentKeys, webhookSecret } from "./payments.ts";
import type { PaymentMode } from "./payments.ts";
import { Invalid } from "./errors.ts";
import {
  digest,
  field,
  inspectFile,
  requireValue,
  uuid,
} from "./files.ts";
const url = Deno.env.get("SUPABASE_URL")!;
const secretKey =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
  (Object.values(
    JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}"),
  )[0] as string);
const publicKey =
  Deno.env.get("SUPABASE_ANON_KEY") ||
  (Object.values(
    JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}"),
  )[0] as string);
const db = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info",
  "Cache-Control": "no-store",
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
type Result<T> = { data: T; error: unknown };
function checked<T>(result: Result<T>, allowNull: true): T;
function checked<T>(result: Result<T>, allowNull?: false): NonNullable<T>;
function checked<T>(result: Result<T>, allowNull = false): T {
  if (result.error || (!allowNull && result.data == null))
    throw new Invalid(
      "The operation could not be completed. Check the details and current status.",
      409,
    );
  return result.data;
}
const rpc = async (name: string, args: Record<string, unknown>) =>
  checked(await db.rpc(name, args), true);
const gatewayKeys = () => paymentKeys(name => Deno.env.get(name));
async function recordCapture(mode: PaymentMode, orderId: string, paymentId: string, amount: number, currency: string, refunded = 0) {
  await rpc("record_gateway_capture", { p_mode: mode, p_order_id: orderId,
    p_payment_id: paymentId, p_amount_minor: amount, p_currency: currency, p_refunded_minor: refunded });
}
async function rate(key: string, limit: number) {
  if (!(await rpc("workflow_rate", { p_key: key, p_limit: limit })))
    throw new Invalid("Hourly request limit reached. Try again later.", 429);
}
async function identity(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer /i, "");
  if (!token || token === publicKey) return { user: null, admin: false };
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new Invalid("Sign in again.", 401);
  const client = createClient(url, publicKey, {
    global: { headers: { Authorization: "Bearer " + token } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return {
    user: data.user.id,
    admin: checked(await client.rpc("admin_access")) === "admin",
  };
}
function limitedBody(req: Request, max: number) {
  if (Number(req.headers.get("content-length")) > max)
    throw new Invalid("Upload too large", 413);
  let total = 0;
  const stream = req.body?.pipeThrough(
    new TransformStream({
      transform(chunk, controller) {
        total += chunk.byteLength;
        if (total > max) throw new Invalid("Upload too large", 413);
        controller.enqueue(chunk);
      },
    }),
  );
  return new Response(stream, {
    headers: {
      "content-type": req.headers.get("content-type") || "application/json",
    },
  });
}
async function readInput(req: Request) {
  const body = limitedBody(req, 27 * 1048576);
  if (req.headers.get("content-type")?.startsWith("multipart/form-data")) {
    const f = await body.formData(),
      data = field(f.get("data"), 40000, "request");
    const files = f.getAll("file");
    requireValue(
      files.length <= 3 && files.every((x) => x instanceof File),
      "Invalid attachments",
    );
    return { data: JSON.parse(data), files: files as File[] };
  }
  const raw = await body.text();
  requireValue(raw.length <= 40000, "Request too large");
  return { data: JSON.parse(raw), files: [] as File[] };
}
async function receiptHash(value: unknown) {
  requireValue(
    typeof value === "string" && /^[a-f0-9]{64}$/.test(value),
    "Invalid access receipt",
  );
  return await digest(value);
}
async function upload(
  bucket: string,
  id: string,
  file: Awaited<ReturnType<typeof inspectFile>>,
) {
  const path = id + "/" + crypto.randomUUID() + "." + file.ext;
  checked(await db.from("upload_intents").insert({ bucket, path }), true);
  checked(
    await db.storage
      .from(bucket)
      .upload(path, file.buffer, { contentType: file.mime, upsert: false }),
  );
  return { path, filename: file.filename, bytes: file.bytes };
}
async function clearIntents(paths: string[]) {
  if (paths.length)
    checked(await db.from("upload_intents").delete().in("path", paths), true);
}
type Data = Record<string, any>;
function submission(data: Data) {
  const kind = data.kind;
  requireValue(
    ["studio", "order", "print"].includes(kind),
    "Unknown submission",
  );
  const name = field(data.name, 100, "contact name"),
    email = field(data.email, 254, "contact email");
  requireValue(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), "Enter a valid email");
  if (kind === "order") {
    requireValue(
      Array.isArray(data.items) &&
        data.items.length >= 1 &&
        data.items.length <= 60,
      "Invalid bag",
    );
    const items = data.items.map((i: Data) => {
      requireValue(
        Number.isInteger(i.quantity) && i.quantity >= 1 && i.quantity <= 100000,
        "Invalid quantity",
      );
      return {
        variant_id: uuid(i.variant_id),
        quantity: i.quantity,
        finish: field(i.finish, 100, "finish", false),
        ...(i.height_mm == null ? {} : { height_mm: Number(i.height_mm) }),
      };
    });
    const s = data.shipping;
    const shipping = s
      ? {
          address: field(s.address, 600, "address"),
          city: field(s.city, 120, "city"),
          pin: field(s.pin, 6, "PIN"),
        }
      : null;
    return { kind, name, email, items, shipping };
  }
  const s = data.specification ?? {},
    title = field(data.title, 180, "title");
  let specification;
  if (kind === "studio") {
    const idea = field(s.idea, 3000, "idea");
    requireValue(
      idea.length >= 10,
      "Describe the idea in at least ten characters",
    );
    const reference = field(s.reference, 700, "reference", false);
    requireValue(
      !reference || /^https?:\/\//i.test(reference),
      "Use an HTTP or HTTPS reference",
    );
    specification = {
      idea,
      reference,
      requirements: field(s.requirements, 1000, "requirements", false),
      budget: field(s.budget, 100, "budget", false),
      timeline: field(s.timeline, 100, "timeline", false),
    };
  } else {
    requireValue(
      Number.isInteger(s.quantity) && s.quantity >= 1 && s.quantity <= 100000,
      "Invalid quantity",
    );
    specification = {
      material: field(s.material, 80, "material"),
      colour: field(s.colour, 80, "colour"),
      finish: field(s.finish, 80, "finish"),
      quantity: s.quantity,
      inspected_bounds: field(s.inspected_bounds, 150, "inspected dimensions"),
      requested_dimensions: field(
        s.requested_dimensions,
        150,
        "requested dimensions",
        false,
      ),
      delivery_date: field(s.delivery_date, 20, "delivery date", false),
      notes: field(s.notes, 1500, "notes", false),
    };
  }
  return { kind, name, email, title, specification };
}
async function owned(
  table: "requests" | "orders",
  id: string,
  auth: Awaited<ReturnType<typeof identity>>,
  receipt: unknown,
) {
  const record = checked(
    await db.from(table).select("*").eq("id", id).maybeSingle(),
    true,
  );
  if (record && (auth.admin || (auth.user && record.owner_id === auth.user)))
    return record;
  if (
    record &&
    record.owner_id === null &&
    typeof receipt === "string" &&
    /^[a-f0-9]{64}$/.test(receipt) &&
    (await rpc("receipt_matches", { p_id: id, p_hash: await digest(receipt) }))
  )
    return record;
  throw new Invalid("Record unavailable", 404);
}
async function publish(id: string, status: string) {
  requireValue(
    ["draft", "published", "archived"].includes(status),
    "Unknown publication state",
  );
  const product = checked(
    await db.from("products").select("sample,updated_at").eq("id", id).single(),
  );
  const paths = checked(
    await db.from("product_media").select("path").eq("product_id", id),
  )
    .map((m) => m.path)
    .filter((p) => !p.startsWith("/"));
  const publicMedia = db.storage.from("product-media");
  const copied: string[] = [];
  try {
    if (status === "published") {
      await rpc("check_listing", { p_id: id, p_sample: product.sample });
      for (const path of paths) {
        if ((await publicMedia.exists(path)).data) continue;
        checked(
          await db.storage
            .from("draft-media")
            .copy(path, path, { destinationBucket: "product-media" }),
        );
        copied.push(path);
      }
    }
    checked(
      await db
        .from("products")
        .update({ status })
        .eq("id", id)
        .eq("updated_at", product.updated_at)
        .select("id")
        .single(),
    );
  } catch (e) {
    const current = checked(
      await db.from("products").select("status").eq("id", id).single(),
    );
    if (copied.length && current.status !== "published")
      checked(await publicMedia.remove(copied));
    throw e;
  }
  if (status !== "published" && paths.length)
    checked(await publicMedia.remove(paths));
  return { status, seo: await refreshSEO() };
}
async function refreshSEO() {
  const hook = Deno.env.get("CHROMA_VERCEL_DEPLOY_HOOK");
  if (!hook) return "Build hook pending configuration";
  try {
    const res = await fetch(hook, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(6000),
    });
    return res.ok
      ? "Build requested"
      : "Build request failed. Retry SEO publishing.";
  } catch {
    return "Build request failed. Retry SEO publishing.";
  }
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  try {
    if (new URL(req.url).pathname.replace(/\/$/, "").endsWith("/razorpay-webhook")) {
      const secret = webhookSecret(name => Deno.env.get(name));
      if (!secret) throw new Invalid("Payment webhook is not configured.", 503);
      const raw = new Uint8Array(await limitedBody(req, 128 * 1024).arrayBuffer());
      const keys = gatewayKeys();
      await handleGatewayEvent(raw, req.headers.get("x-razorpay-signature"), secret, keys, recordCapture.bind(null, keys?.mode ?? "test"),
        async (id, paymentId, amount, currency, captured, total) => {
          await rpc("record_gateway_refund", { p_mode: keys!.mode ?? "test", p_refund_id: id,
            p_payment_id: paymentId, p_amount_minor: amount, p_currency: currency,
            p_captured_minor: captured, p_total_refunded: total });
        },
        async (paymentId, amount, currency) => {
          await rpc("record_gateway_failure", { p_mode: keys!.mode ?? "test", p_payment_id: paymentId,
            p_amount_minor: amount, p_currency: currency });
        });
      return json({ received: true });
    }
    // A shared ceiling still applies when a client changes its IP or headers.
    await rate("all", 1800);
    const ip = (req.headers.get("x-forwarded-for") || "unknown")
      .split(",")
      .at(-1)!
      .trim();
    await rate("ip:" + (await digest(ip)), 180);
    const auth = await identity(req);
    const { data, files } = await readInput(req);
    requireValue(data && typeof data === "object", "Invalid request");
    const action = data.action;
    if (action === "test-payment" || action === "payment") {
      const id = uuid(data.id);
      const order = await owned("orders", id, auth, data.receipt);
      requireValue(order.status === "pending" && order.payment_status === "unpaid" &&
        order.currency === "INR" && Number.isSafeInteger(order.total_minor) && order.total_minor > 0, "Order is not payable.");
      const keys = gatewayKeys();
      if (action === "test-payment" && keys?.mode === "live") throw new Invalid("This action requires Test Mode.", 409);
      if (keys?.mode === "live" && !await rpc("gateway_live_enabled", {}))
        throw new Invalid("Live payments require owner activation.", 503);
      if (keys?.mode !== "live" && await rpc("has_test_payment_capture", { p_order_id: id })) return json({ received: true });
      if (!keys) {
        const keyId = Deno.env.get("CHROMA_RAZORPAY_TEST_KEY_ID")?.trim();
        console.warn("Chroma3D sandbox configuration " + JSON.stringify({
          keyId: !keyId ? "absent" : keyId.startsWith("rzp_test_") ? "test" : keyId.startsWith("rzp_live_") ? "live" : "unrecognized",
          hasApiSecret: !!Deno.env.get("CHROMA_RAZORPAY_TEST_KEY_SECRET")?.trim(),
          hasWebhookSecret: !!Deno.env.get("CHROMA_RAZORPAY_TEST_WEBHOOK_SECRET"),
        }));
        throw new Invalid("Razorpay test mode is not configured.", 503);
      }
      await rate("test-payment:" + id, 20);
      return json(await openPayment({ id, total_minor: order.total_minor, currency: order.currency }, keys, recordCapture.bind(null, keys.mode ?? "test")));
    }
    if (action === "submit") {
      await rate("submit:" + (await digest(ip)), 25);
      const id = uuid(data.id),
        hash = await receiptHash(data.receipt),
        body = submission(data);
      const bucket = body.kind === "print" ? "print-uploads" : "studio-files";
      requireValue(
        body.kind === "print"
          ? files.length === 1
          : body.kind === "order"
            ? files.length === 0
            : files.reduce((a, f) => a + f.size, 0) <= 10485760,
        "Incorrect attachments",
      );
      const validated = [];
      for (const file of files) validated.push(await inspectFile(file, bucket));
      const fingerprint = await digest(
        JSON.stringify([body, validated.map((f) => [f.filename, f.hash])]),
      );
      const prior = await rpc("receipt_matches", { p_id: id, p_hash: hash });
      const stored = [];
      if (!prior)
        for (const f of validated) stored.push(await upload(bucket, id, f));
      await rpc("submit_work", {
        p_id: id,
        p_secret: hash,
        p_digest: fingerprint,
        p_owner: auth.user,
        p_data: body,
        p_files: stored,
      });
      // Concurrent retries can leave a staged duplicate. Only clear intents for committed paths.
      if (stored.length) {
        const bound = checked(
          await db.from("request_files").select("path").eq("request_id", id),
        );
        await clearIntents(bound.map((x) => x.path));
      }
      return json({ id, kind: body.kind }, 201);
    }
    if (
      action === "read" ||
      action === "download" ||
      action === "request-file" ||
      action === "advance"
    ) {
      const id = uuid(data.id),
        table = data.kind === "order" ? "orders" : "requests";
      const record = await owned(table, id, auth, data.receipt);
      if (action === "read") {
        if (table === "orders") {
          const keys = gatewayKeys();
          const paymentAvailable = !!keys && (keys.mode !== "live" || await rpc("gateway_live_enabled", {}));
          return json({
            record: {
              ...record,
              ...await rpc("gateway_order_state", { p_order_id: id }) as Record<string, unknown>,
              payment_mode: keys?.mode ?? "test",
              payment_available: paymentAvailable,
              test_payment_received: await rpc("has_test_payment_capture", { p_order_id: id }),
              test_checkout_enabled: paymentAvailable && keys?.mode !== "live",
            },
            items: checked(
              await db.from("order_items").select("*").eq("order_id", id),
            ),
            downloads: await rpc("order_downloads", { p_id: id }),
          });
        }
        let q = db
          .from("request_history")
          .select("id,status,note,revision_id,created_at,internal")
          .eq("request_id", id)
          .order("id");
        if (!auth.admin) q = q.eq("internal", false);
        return json({
          record,
          history: checked(await q),
          files: checked(
            await db
              .from("request_files")
              .select("id,filename,purpose,created_at")
              .eq("request_id", id),
          ),
        });
      }
      if (action === "download") {
        requireValue(table === "orders", "Invalid record");
        const path = await rpc("authorize_download", {
          p_id: id,
          p_entitlement: uuid(data.file_id),
        });
        return json(
          checked(
            await db.storage
              .from("digital-products")
              .createSignedUrl(path, 60, { download: true }),
          ),
        );
      }
      if (action === "request-file") {
        requireValue(table === "requests", "Invalid record");
        const f = checked(
          await db
            .from("request_files")
            .select("path,filename")
            .eq("id", uuid(data.file_id))
            .eq("request_id", id)
            .single(),
        );
        return json(
          checked(
            await db.storage
              .from(record.kind === "print" ? "print-uploads" : "studio-files")
              .createSignedUrl(f.path, 60, { download: f.filename }),
          ),
        );
      }
      if (table === "orders") {
        if (!auth.admin) throw new Invalid("Administrator required", 403);
        await rpc("advance_order", {
          p_id: id,
          p_status: field(data.status, 32, "status"),
        });
      } else
        await rpc("advance_work", {
          p_id: id,
          p_actor: auth.user,
          p_admin: auth.admin,
          p_status: field(data.status, 32, "status"),
          p_note: field(data.note, 3000, "note", false),
          p_amount: data.amount_minor ?? null,
          p_until: data.valid_until ?? null,
          p_file: data.file_id ? uuid(data.file_id) : null,
          p_internal: !!data.internal,
        });
      return json({ id });
    }
    if (!auth.admin) throw new Invalid("Administrator MFA required", 403);
    if (action === "refresh-seo") return json({ seo: await refreshSEO() });
    if (action === "estimate") {
      requireValue(
        Number.isFinite(data.grams) &&
          Number.isSafeInteger(data.estimate_minor),
        "Enter a measured mass and an estimate",
      );
      await rpc("review_print_estimate", {
        p_id: uuid(data.id),
        p_actor: auth.user,
        p_grams: data.grams,
        p_estimate: data.estimate_minor,
      });
      return json({ saved: true });
    }
    if (action === "publish")
      return json(await publish(uuid(data.id), data.status));
    if (action === "cleanup") {
      const intents = checked(await db.rpc("unused_uploads"));
      for (const i of intents) {
        checked(await db.storage.from(i.bucket).remove([i.path]));
        await clearIntents([i.path]);
      }
      return json({ removed: intents.length });
    }
    if (action === "preview-media") {
      const m = checked(
        await db
          .from("product_media")
          .select("path")
          .eq("id", uuid(data.id))
          .single(),
      );
      if (m.path.startsWith("/")) return json({ signedUrl: m.path });
      return json(
        checked(
          await db.storage.from("draft-media").createSignedUrl(m.path, 60),
        ),
      );
    }
    if (action === "preview-listing") {
      const media = checked(
        await db
          .from("product_media")
          .select("path")
          .eq("product_id", uuid(data.id)),
      );
      const paths = media.map((m) => m.path).filter((p) => !p.startsWith("/"));
      const links = paths.length
        ? checked(
            await db.storage.from("draft-media").createSignedUrls(paths, 60),
          )
        : [];
      requireValue(
        links.every((l) => l.path && l.signedUrl),
        "Unable to preview media",
      );
      return json({
        urls: Object.fromEntries(links.map((l) => [l.path, l.signedUrl])),
      });
    }
    if (action === "admin-file") {
      const id = uuid(data.id);
      requireValue(files.length === 1, "Choose one file");
      const bucket = String(data.bucket);
      requireValue(
        ["digital-products", "draft-media", "studio-files"].includes(bucket),
        "Invalid bucket",
      );
      if (bucket === "studio-files") {
        const r = checked(
          await db.from("requests").select("kind").eq("id", id).single(),
        );
        requireValue(r.kind === "studio", "Select a studio project");
      } else if (bucket === "digital-products") {
        const v = checked(
          await db.from("variants").select("format").eq("id", id).single(),
        );
        requireValue(v.format === "stl", "Choose an STL variant");
      } else {
        const p = checked(
          await db.from("products").select("status").eq("id", id).single(),
        );
        requireValue(
          p.status === "draft",
          "Save as draft before editing media",
        );
      }
      const f = await inspectFile(files[0], bucket, bucket === "studio-files");
      const stored = await upload(bucket, id, f);
      if (bucket === "studio-files") {
        requireValue(
          ["revision", "final"].includes(data.purpose),
          "Select revision or final",
        );
        checked(
          await db
            .from("request_files")
            .insert({ ...stored, request_id: id, purpose: data.purpose }),
          true,
        );
      } else if (bucket === "digital-products") {
        requireValue(
          Number.isSafeInteger(data.version) && data.version > 0,
          "Specify a positive file version",
        );
        checked(
          await db
            .from("digital_assets")
            .insert({
              ...stored,
              variant_id: id,
              sha256: f.hash,
              version: data.version,
            }),
          true,
        );
      } else {
        checked(
          await db
            .from("product_media")
            .insert({
              product_id: id,
              path: stored.path,
              kind: f.ext === "glb" ? "preview" : "photo",
              alt: field(data.alt, 200, "alt text"),
              display_order: Number(data.position ?? 0),
              is_primary: !!data.primary,
            }),
          true,
        );
      }
      await clearIntents([stored.path]);
      return json({ saved: true });
    }
    throw new Invalid("Unknown action");
  } catch (error) {
    const e = error as Error;
    return json(
      {
        error:
          e instanceof Invalid ? e.message : "Unable to process this request",
      },
      e instanceof Invalid ? e.status : 400,
    );
  }
});
