import { useEffect, useRef, useState } from "react";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowClockwiseIcon,
  CubeIcon,
  PackageIcon,
  PencilRulerIcon,
  TrayIcon,
} from "@phosphor-icons/react";
import { db, operation, receipts, type Receipt } from "./backend";
type Kind = Receipt["kind"];
type Target = { id: string; kind: Kind; receipt?: string };
type QueueEntry = Target & {
  title?: string;
  status?: string;
  created_at?: string;
};
const kindLabel: Record<Kind, string> = {
  print: "Print request",
  studio: "Studio project",
  order: "Order",
};
const kindIcon = {
  print: CubeIcon,
  studio: PencilRulerIcon,
  order: PackageIcon,
};
type History = {
  status: string;
  note: string;
  revision_id: string | null;
  internal: boolean;
};
type Detail = {
  record: {
    id: string;
    kind?: Kind;
    status: string;
    name: string;
    email: string;
    title?: string;
    specification?: Record<string, unknown>;
    total_minor?: number;
    payment_status?: string;
    test_payment_received?: boolean;
    test_checkout_enabled?: boolean;
    payment_mode?: "test" | "live";
    payment_available?: boolean;
    test_refunded_minor?: number;
    review_required?: boolean;
    quote_minor?: number;
    estimated_minor?: number;
    material_grams?: number;
    material_cost_minor?: number;
    valid_until?: string;
    shipping?: Record<string, string>;
  };
  history?: History[];
  files?: { id: string; filename: string; purpose: string }[];
  items?: { product_name: string; quantity: number; unit_minor: number }[];
  downloads?: { id: string; filename: string }[];
};
const stages: Record<string, string[]> = {
  submitted: ["review"],
  review: ["discussion", "rejected"],
  discussion: ["revision"],
  revision: ["awaiting_approval"],
  approved: ["manufacturing"],
  accepted: ["manufacturing"],
  manufacturing: ["shipped"],
  shipped: ["completed"],
};
const fmt = (s: string) => s.replaceAll("_", " ");
export function RecordDetail({
  target,
  admin = false,
  refreshVersion = 0,
}: {
  target: Target;
  admin?: boolean;
  refreshVersion?: number;
}) {
  const [detail, setDetail] = useState<Detail>(),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [version, setVersion] = useState(0);
  const [note, setNote] = useState(""),
    [amount, setAmount] = useState(""),
    [until, setUntil] = useState(""),
    [internal, setInternal] = useState(false),
    [file, setFile] = useState<File>(),
    [purpose, setPurpose] = useState("revision"),
    [revision, setRevision] = useState("");
  const [link, setLink] = useState("");
  const [checkoutUrl, setCheckoutUrl] = useState("");
  const { id, kind, receipt } = target;
  useEffect(() => {
    let active = true;
    setDetail(undefined);
    setLink("");
    operation<Detail>({ action: "read", id, kind, receipt })
      .then((d) => {
        if (active) setDetail(d);
      })
      .catch((e) => {
        if (active) setMessage(e.message);
      });
    return () => {
      active = false;
    };
  }, [id, kind, receipt, version, refreshVersion]);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!detail)
    return (
      <p role="status">
        {message || "Loading record…"}{" "}
        <button onClick={() => setVersion((v) => v + 1)}>Refresh</button>
      </p>
    );
  const r = { ...detail.record },
    history = detail.history || [];
  if (
    r.status === "quoted" &&
    r.valid_until &&
    Date.parse(r.valid_until) <= Date.now()
  )
    r.status = "expired";
  const customerNext: Record<string, string[]> = {
    submitted: ["cancelled"],
    discussion: ["cancelled"],
    quoted: ["accepted", "rejected"],
    awaiting_approval: ["approved", "revision", "rejected"],
  };
  const actions =
    kind === "order"
      ? admin
        ? r.payment_status === "verified"
          ? {
              pending: ["processing"],
              processing: ["shipped", "completed"],
              shipped: ["completed"],
            }[r.status] || []
          : r.status === "pending"
            ? ["cancelled"]
            : []
        : []
      : admin
        ? kind === "print" && r.status === "review"
          ? ["quoted", "rejected"]
          : stages[r.status] || []
        : customerNext[r.status] || [];
  const currentRevision = [...history]
    .reverse()
    .find(
      (h) => h.revision_id && h.status === "awaiting_approval",
    )?.revision_id;
  const advance = (status: string) =>
    run(async () => {
      await operation({
        action: "advance",
        ...target,
        status,
        note,
        internal: status === "note" && internal,
        amount_minor: amount ? Math.round(Number(amount) * 100) : null,
        valid_until: until ? new Date(until).toISOString() : null,
        file_id: status === "awaiting_approval" ? revision : currentRevision,
      });
      setNote("");
      setVersion((v) => v + 1);
    });
  return (
    <section className="form-stack portal">
      {admin ? (
        <header className="desk-record-heading">
          <small>{kindLabel[kind]}</small>
          <h2>{r.title || "Order " + id.slice(0, 8)}</h2>
          <span className="desk-status" data-state={r.status}>
            {fmt(r.status)}
          </span>
        </header>
      ) : (
        <h2>
          {r.title || "Order"} · {fmt(r.status)}
        </h2>
      )}
      <p>
        {r.name} · {r.email}
      </p>
      <small>{id}</small>
      {Object.entries(r.specification || {})
        .filter(([, v]) => v !== "" && v != null)
        .map(([k, v]) => (
          <p key={k}>
            <strong>{fmt(k)}</strong> {String(v)}
          </p>
        ))}
      {detail.items?.map((i, n) => (
        <p key={n}>
          {i.product_name} × {i.quantity} · ₹{(i.unit_minor * i.quantity) / 100}
        </p>
      ))}
      {r.total_minor != null && (
        <p>
          Order total ₹{r.total_minor / 100} · {r.payment_status}
        </p>
      )}
      {r.test_payment_received && r.payment_status === "unpaid" && (
        <p role="status">Test payment received. No money was collected. STL downloads require a verified purchase.</p>
      )}
      {Number(r.test_refunded_minor) > 0 && <p role="status">Test refund recorded · ₹{Number(r.test_refunded_minor) / 100}. No real money was refunded.</p>}
      {r.review_required && <p role="status">A captured payment needs studio review before fulfilment or downloads.</p>}
      {r.payment_status === "refunded" && <p role="status">Payment refunded. New download links are unavailable for this order.</p>}
      {!admin && kind === "order" && (r.payment_available ?? r.test_checkout_enabled) && !(r.payment_mode !== "live" && r.test_payment_received) &&
        r.payment_status === "unpaid" && r.status === "pending" && Number(r.total_minor) > 0 && (
        <div className="form-stack">
          {r.payment_mode === "live" ? <p>Continue to Razorpay to pay securely.</p> :
            <p>Test checkout. If Razorpay offers a UPI ID field, enter <code>success@razorpay</code>.
              {" "}Otherwise, choose a test card. Scanning a QR with GPay requires live payments.</p>}
          {checkoutUrl && <a href={checkoutUrl} target="_blank" rel="noopener noreferrer" className="primary">
            {r.payment_mode === "live" ? "Open Razorpay checkout ↗" : "Open Razorpay test checkout ↗"}</a>}
          <button disabled={busy} onClick={() => run(async () => {
            const result = await operation<{ checkoutUrl?: string; received?: boolean }>({ action: "payment", ...target });
            if (result.received) { setCheckoutUrl(""); setVersion(v => v + 1); }
            else if (result.checkoutUrl) setCheckoutUrl(result.checkoutUrl);
          })}>{checkoutUrl ? (r.payment_mode === "live" ? "Check payment status" : "Check test payment status") :
            (r.payment_mode === "live" ? "Get payment link" : "Get test payment link")}</button>
        </div>
      )}
      {r.shipping && <p>Delivery · {Object.values(r.shipping).join(", ")}</p>}
      {r.estimated_minor != null && (
        <p>Indicative estimate · ₹{r.estimated_minor / 100}</p>
      )}
      {admin && r.material_grams != null && (
        <p>
          Reviewed material · {r.material_grams} g
          {r.material_cost_minor != null
            ? " · ₹" + r.material_cost_minor / 100
            : " · rate pending"}
        </p>
      )}
      {admin &&
        kind === "print" &&
        ["review", "submitted"].includes(r.status) && (
          <form
            className="form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void run(async () => {
                await operation({
                  action: "estimate",
                  id,
                  grams: Number(f.get("grams")),
                  estimate_minor: Math.round(Number(f.get("estimate")) * 100),
                });
                setVersion((v) => v + 1);
              });
            }}
          >
            <label>
              Reviewed total material for this quantity (g)
              <input
                type="number"
                required
                min=".001"
                step=".001"
                name="grams"
                defaultValue={r.material_grams}
              />
            </label>
            <label>
              Indicative total in INR
              <input
                type="number"
                name="estimate"
                required
                min="0"
                step=".01"
                defaultValue={
                  r.estimated_minor != null ? r.estimated_minor / 100 : ""
                }
              />
            </label>
            <button disabled={busy}>Save estimate</button>
          </form>
        )}
      {r.quote_minor != null && (
        <p>
          Quotation ₹{r.quote_minor / 100} · valid until{" "}
          {new Date(r.valid_until!).toLocaleString()}
        </p>
      )}
      {admin && history.length > 0 && <h3>Activity</h3>}
      {history.map((h, i) => (
        <p key={i}>
          {fmt(h.status)} {h.internal ? "(studio only)" : ""} {h.note}
        </p>
      ))}
      {[...(detail.files ?? []), ...(detail.downloads ?? [])].map((f) => (
        <button
          key={f.id}
          disabled={busy}
          onClick={() =>
            run(async () => {
              const res = await operation<{ signedUrl: string }>({
                action: kind === "order" ? "download" : "request-file",
                ...target,
                file_id: f.id,
              });
              setLink(res.signedUrl);
            })
          }
        >
          {kind === "order" ? "Get download link · " : ""}
          {f.filename}
        </button>
      ))}
      {link && (
        <a href={link} target="_blank" rel="noreferrer">
          {kind === "order" ? "Download STL" : "Open file"} · link valid for one
          minute
        </a>
      )}
      {kind !== "order" && (
        <>
          <label>
            {admin ? "Studio comment" : "Message to the studio"}
            <textarea
              maxLength={3000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          {admin && (
            <label>
              <input
                type="checkbox"
                checked={internal}
                onChange={(e) => setInternal(e.target.checked)}
              />{" "}
              Studio-only note
            </label>
          )}
          <button
            disabled={busy || !note.trim()}
            onClick={() => advance("note")}
          >
            Save comment
          </button>
        </>
      )}
      {admin && kind === "print" && r.status === "review" && (
        <>
          <label>
            Quoted amount in INR
            <input
              type="number"
              min=".01"
              step=".01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
          <label>
            Valid until
            <input
              type="datetime-local"
              value={until}
              onChange={(e) => setUntil(e.target.value)}
            />
          </label>
        </>
      )}
      {admin && kind === "studio" && (
        <>
          <label>
            Project file
            <select
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
            >
              <option>revision</option>
              <option>final</option>
            </select>
            <input
              type="file"
              accept=".png,.jpg,.jpeg,.pdf,.stl"
              onChange={(e) => setFile(e.target.files?.[0])}
            />
          </label>
          <button
            disabled={!file || busy}
            onClick={() =>
              run(async () => {
                await operation(
                  { action: "admin-file", id, bucket: "studio-files", purpose },
                  [file!],
                );
                setVersion((v) => v + 1);
              })
            }
          >
            Upload project file
          </button>
          {r.status === "revision" && (
            <label>
              Revision for approval
              <select
                value={revision}
                onChange={(e) => setRevision(e.target.value)}
              >
                <option value="">Choose revision</option>
                {detail.files
                  ?.filter((f) => f.purpose === "revision")
                  .map((f) => (
                    <option value={f.id} key={f.id}>
                      {f.filename}
                    </option>
                  ))}
              </select>
            </label>
          )}
        </>
      )}
      {admin && actions.length > 0 && <h3>Update status</h3>}
      {actions.map((s) => (
        <button
          key={s}
          disabled={busy || (s === "awaiting_approval" && !revision)}
          onClick={() => advance(s)}
        >
          {fmt(s)}
        </button>
      ))}
      <button onClick={() => setVersion((v) => v + 1)}>Refresh status</button>
      {message && <p role="alert">{message}</p>}
    </section>
  );
}
export default function Workspace({ admin = false }: { admin?: boolean }) {
  const [list, setList] = useState<QueueEntry[]>([]),
    [target, setTarget] = useState<Target>(),
    [error, setError] = useState(""),
    [version, setVersion] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState("all");
  const [listError, setListError] = useState("");
  const back = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!admin) return;
    if (target) back.current?.focus();
    else opener.current?.focus();
  }, [admin, target]);
  useEffect(() => {
    let live = true;
    const client = db;
    async function load() {
      const found: QueueEntry[] = admin ? [] : receipts();
      const session = client && (await client.auth.getSession()).data.session;
      if (client && session) {
        for (const table of ["requests", "orders"]) {
          const fields = table === "requests" ? "id,kind" : "id";
          let query = client
            .from(table)
            .select(
              admin
                ? fields +
                    ",created_at,status" +
                    (table === "requests" ? ",title" : "")
                : fields,
            );
          if (!admin) query = query.eq("owner_id", session.user.id);
          const r = await query.order("created_at", { ascending: false })
            .limit(100);
          if (r.error) throw r.error;
          for (const v of r.data as unknown as QueueEntry[]) {
            if (!found.some((x) => x.id === v.id))
              found.push({
                ...v,
                id: v.id,
                kind: table === "orders" ? "order" : v.kind,
              });
          }
        }
      }
      if (live) {
        if (admin)
          found.sort(
            (a, b) => Date.parse(b.created_at!) - Date.parse(a.created_at!),
          );
        setList(found);
        setLoaded(true);
        setListError("");
      }
    }
    load().catch((e) => live && setListError(e.message));
    return () => {
      live = false;
    };
  }, [admin, version]);
  useEffect(() => {
    const client = db;
    if (!admin || !client) return;
    let live = true;
    const channel = client.channel("studio-work");
    async function subscribe() {
      // Prime the JWT before joining so Postgres authorizes the first subscription.
      await client!.realtime.setAuth();
      if (!live) return;
      for (const table of ["requests", "orders"]) {
        channel.on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table },
          () => setVersion((v) => v + 1),
        );
        channel.on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table },
          () => setVersion((v) => v + 1),
        );
      }
      channel.subscribe((status) => {
        if (live && ["CHANNEL_ERROR", "TIMED_OUT"].includes(status))
          setError(
            "Live updates are unavailable. Refresh the list to check for changes.",
          );
      });
    }
    subscribe().catch(
      () =>
        live &&
        setError(
          "Live updates are unavailable. Refresh the list to check for changes.",
        ),
    );
    return () => {
      live = false;
      void client.removeChannel(channel);
    };
  }, [admin]);
  if (admin) {
    const filtered = list.filter(
      (entry) => filter === "all" || entry.kind === filter,
    );
    return (
      <section className="desk-queue">
        <div hidden={!!target}>
          <header className="desk-heading">
            <h2>Work queue</h2>
            <button onClick={() => setVersion((v) => v + 1)}>
              <ArrowClockwiseIcon aria-hidden />
              Refresh list
            </button>
          </header>
          <div
            className="desk-switch"
            role="group"
            aria-label="Filter work queue"
          >
            {(
              [
                ["all", "All work"],
                ["print", "Print requests"],
                ["studio", "Studio projects"],
                ["order", "Orders"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
          {listError && <p role="alert">{listError}</p>}
          {error && <p role="status">{error}</p>}
          {filtered.length > 0 ? (
            <>
              <div className="desk-list-head queue-columns" aria-hidden="true">
                <span>Record</span>
                <span>Received</span>
                <span>Status</span>
                <span />
              </div>
              <ul className="desk-list">
                {filtered.map((entry) => {
                  const Icon = kindIcon[entry.kind];
                  return (
                    <li key={entry.id}>
                      <button
                        className="desk-row queue-columns"
                        onClick={(e) => {
                          opener.current = e.currentTarget;
                          setTarget({ id: entry.id, kind: entry.kind });
                        }}
                      >
                        <span className="desk-product">
                          <span className="desk-record-icon">
                            <Icon aria-hidden />
                          </span>
                          <span className="desk-row-copy">
                            <strong>
                              {entry.title || "Order " + entry.id.slice(0, 8)}
                            </strong>
                            <small>{kindLabel[entry.kind]}</small>
                          </span>
                        </span>
                        <time className="desk-date" dateTime={entry.created_at}>
                          {new Date(entry.created_at!).toLocaleDateString(
                            "en-IN",
                            { day: "numeric", month: "short", year: "numeric" },
                          )}
                        </time>
                        <span className="desk-status" data-state={entry.status}>
                          {fmt(entry.status || "")}
                        </span>
                        <ArrowRightIcon className="desk-arrow" aria-hidden />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            !listError && (
              <div className="desk-empty" role="status">
                <TrayIcon aria-hidden />
                <p>
                  {!loaded
                    ? "Loading work…"
                    : filter === "all"
                      ? "No orders or requests yet."
                      : "No records in this view."}
                </p>
              </div>
            )
          )}
        </div>
        {target && (
          <>
            <button
              ref={back}
              className="desk-back"
              onClick={() => setTarget(undefined)}
            >
              <ArrowLeftIcon aria-hidden />
              Work queue
            </button>
            <div className="desk-sheet desk-record">
              <RecordDetail
                key={target.id}
                target={target}
                refreshVersion={version}
                admin
              />
            </div>
          </>
        )}
      </section>
    );
  }
  return (
    <section className="form-stack">
      <h2>Your orders and requests</h2>
      {listError && <p role="alert">{listError}</p>}
      <button onClick={() => setVersion((v) => v + 1)}>Refresh list</button>
      {!list.length && <p>No records available in this session.</p>}
      {list.map((t) => (
        <button className="secondary" key={t.id} onClick={() => setTarget(t)}>
          {fmt(t.kind)} · {t.id}
        </button>
      ))}
      {target && (
        <RecordDetail
          key={target.id + "-" + version}
          target={target}
          admin={admin}
        />
      )}
    </section>
  );
}
