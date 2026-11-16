import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { ArrowLeftIcon, ArrowRightIcon } from "@phosphor-icons/react";
import { customerLinkFailed, db, operation } from "./backend";
import { recoveryKey } from "./customerSession";
import { navigate, rupees } from "./collection";
import { RecordDetail } from "./Workspace";
import "./account.css";

type Mode = "login" | "signup" | "forgot" | "reset";
type Section = "Orders" | "Downloads" | "Projects";
type Entry = { id: string; kind: "order" | "studio" | "print"; title: string; status: string; date: string; total?: number };
type Download = { id: string; filename: string; order: string };
const sections: Section[] = ["Orders", "Downloads", "Projects"];
const captions = { login: "Sign in", signup: "Create an account", forgot: "Reset your password", reset: "Choose a new password" };

function AccountForm({ reset, done }: { reset: boolean; done: () => void }) {
  const [mode, setMode] = useState<Mode>(reset ? "reset" : "login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState(customerLinkFailed ? "This email link has expired or is invalid. Request a new link." : "");
  const [busy, setBusy] = useState(false);
  function switchMode(next: Mode) { setMode(next); setPassword(""); setMessage(""); setError(""); }
  async function submit() {
    if (!db || busy) return;
    setBusy(true); setMessage(""); setError("");
    const address = email.trim();
    const callback = location.origin + "/account";
    try {
      if (mode === "signup") {
        const result = await db.auth.signUp({ email: address, password, options: { emailRedirectTo: callback } });
        if (result.error) throw result.error;
        if (result.data.session) done();
        else { switchMode("login"); setMessage("Check your email to confirm your account, then sign in."); }
      } else if (mode === "forgot") {
        const result = await db.auth.resetPasswordForEmail(address, { redirectTo: callback });
        if (result.error) throw result.error;
        setMessage("If there’s an account for this address, check your email for a password reset link.");
      } else if (mode === "reset") {
        const result = await db.auth.updateUser({ password });
        if (result.error) throw result.error;
        sessionStorage.removeItem(recoveryKey); setPassword(""); done();
      } else {
        const result = await db.auth.signInWithPassword({ email: address, password });
        if (result.error) throw result.error;
        done();
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not complete this request. Please try again."); }
    finally { setBusy(false); }
  }
  return <section className="customer-auth">
    <div><p className="kicker">My account</p><h1>{captions[mode]}</h1>
      <p>{mode === "login" || mode === "signup" ? "Track your orders, download purchased models, and follow your studio projects." :
        mode === "forgot" ? "Enter the email address you use for Chroma3D." : "Choose a password of at least 12 characters."}</p>
    </div>
    <form className="form-stack" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <fieldset disabled={busy}>
        {mode !== "reset" && <label>Email address<input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} /></label>}
        {mode !== "forgot" && <label>{mode === "reset" ? "New password" : "Password"}<input type="password" required
          autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={mode === "login" ? undefined : 12}
          value={password} onChange={e => setPassword(e.target.value)} /></label>}
        {mode === "signup" && <small>Use at least 12 characters.</small>}
        {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
        <button className="primary">{busy ? "Please wait…" : mode === "forgot" ? "Send reset link" : mode === "reset" ? "Save new password" : captions[mode]} <ArrowRightIcon /></button>
        {mode === "login" && <div className="account-switch"><button type="button" onClick={() => switchMode("signup")}>Create an account</button>
          <button type="button" onClick={() => switchMode("forgot")}>Forgot password?</button></div>}
        {(mode === "forgot" || mode === "signup") && <button type="button" className="inline-link" onClick={() => switchMode("login")}>Back to sign in</button>}
      </fieldset>
    </form>
  </section>;
}

function Records({ owner, section }: { owner: string; section: Section }) {
  const [rows, setRows] = useState<Entry[]>([]);
  const [files, setFiles] = useState<Download[]>([]);
  const [target, setTarget] = useState<Entry>();
  const [page, setPage] = useState(0);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(true);
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState("");
  const [getting, setGetting] = useState("");
  const [link, setLink] = useState<{ id: string; url: string }>();
  useEffect(() => {
    let active = true;
    const size = 10, start = page * size;
    setBusy(true); setError(""); setLink(undefined); setRows([]); setFiles([]); setMore(false);
    async function load() {
      const client = db!;
      let entries: Entry[], downloads: Download[] = [];
      if (section === "Projects") {
        const res = await client.from("requests").select("id,kind,title,status,created_at").eq("owner_id", owner)
          .order("created_at", { ascending: false }).order("id").range(start, start + size);
        if (res.error) throw res.error;
        entries = res.data.map(r => ({ ...r, date: r.created_at }));
      } else {
        let query = client.from("orders").select("id,status,payment_status,created_at,total_minor,order_items!inner(product_name,format)").eq("owner_id", owner);
        if (section === "Downloads") query = query.eq("payment_status","verified").eq("order_items.format","stl");
        const res = await query.order("created_at", { ascending: false }).order("id").range(start, start + size);
        if (res.error) throw res.error;
        entries = res.data.map(r => ({ id: r.id, kind: "order", title: r.order_items.map(i => i.product_name).join(", "),
          status: r.payment_status === "unpaid" ? "Awaiting payment" : r.status, date: r.created_at, total: r.total_minor }));
        if (section === "Downloads") {
          downloads = (await Promise.all(entries.slice(0,size).map(async entry => {
            const detail = await operation<{ downloads: { id: string; filename: string }[] }>({ action: "read", kind: "order", id: entry.id });
            return detail.downloads.map(f => ({ ...f, order: entry.id }));
          }))).flat();
        }
      }
      if (active) { setRows(entries.slice(0,size)); setFiles(downloads); setMore(entries.length > size); }
    }
    void load().catch(e => { if (active) setError(e.message || "Could not load your records."); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [owner, section, page, retry]);
  async function getFile(file: Download) {
    setGetting(file.id); setError(""); setLink(undefined);
    try {
      const res = await operation<{ signedUrl: string }>({ action: "download", kind: "order", id: file.order, file_id: file.id });
      setLink({ id: file.id, url: res.signedUrl });
    } catch (e) { setError(e instanceof Error ? e.message : "Could not prepare your download."); }
    finally { setGetting(""); }
  }
  if (target) return <div className="account-record"><button className="inline-link" onClick={() => {setTarget(undefined);setRetry(n=>n+1);}}><ArrowLeftIcon /> Back to {section.toLowerCase()}</button>
    <RecordDetail key={target.id} target={{id:target.id,kind:target.kind}} /></div>;
  return <section className="account-records" aria-label={section}>
    <h2>{section}</h2>
    {error && <p role="alert">{error} <button className="inline-link" onClick={() => setRetry(n=>n+1)}>Retry</button></p>}
    {busy ? <p role="status">Loading {section.toLowerCase()}…</p> : <>
      {section === "Downloads" ? files.map(file => <div className="account-row" key={file.order + file.id}><strong>{file.filename}</strong>
        {link?.id === file.id ? <><a href={link.url} target="_blank" rel="noreferrer">Download STL ↗</a>
          <button className="inline-link" onClick={() => void getFile(file)}>Renew link</button></> :
          <button className="inline-link" disabled={!!getting} onClick={() => void getFile(file)}>{getting === file.id ? "Preparing…" : "Get download link"}</button>}</div>) :
        rows.map(entry => <button className="account-row" key={entry.id} onClick={() => setTarget(entry)}>
          <span><strong>{entry.title || (entry.kind === "order" ? "Order" : "Project")}</strong>
            <small>{new Date(entry.date).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"})} · {entry.kind === "order" ? rupees((entry.total ?? 0)/100) : entry.kind === "print" ? "Print request" : "Studio project"}</small></span>
          <span>{entry.status.replaceAll("_"," ")} <ArrowRightIcon /></span></button>)}
      {!error && !(section === "Downloads" ? files : rows).length && <div className="account-empty"><p>{
        section === "Downloads" ? "Purchased STL files appear here after payment is verified." :
        section === "Projects" ? "Your print requests and studio projects will appear here." : "Your orders will appear here after checkout."}</p>
        {section !== "Downloads" && <a className="inline-link" href={section === "Orders" ? "/shop" : "/studio"}>{section === "Orders" ? "Explore the store" : "Start a project"} <ArrowRightIcon /></a>}</div>}
      {(page > 0 || more) && <div className="account-switch"><button disabled={!page} onClick={()=>setPage(page-1)}>Previous</button>
        <button disabled={!more} onClick={()=>setPage(page+1)}>Next</button></div>}
    </>}
  </section>;
}

export default function Account({ session }: { session: Session | null | undefined }) {
  const [section, setSection] = useState<Section>("Orders");
  const [notice, setNotice] = useState("");
  const resetting = !!session && sessionStorage.getItem(recoveryKey) === session.user.id;
  function done() {
    const dest = new URLSearchParams(location.search).get("returnTo");
    if (dest === "/checkout" || dest === "/bag") navigate(dest);
    else setNotice(resetting ? "Your password has been updated." : "");
  }
  return <main id="main" className="page wrap customer-account">
    {!db ? <p role="status">Customer accounts are currently unavailable.</p> : session === undefined ? <p role="status">Opening your account…</p> :
      !session || resetting ? <AccountForm key={resetting ? "reset" : "signin"} reset={resetting} done={done} /> : <>
        <header className="account-heading"><div><h1>My account</h1><p>{session.user.email}</p></div>
          <button className="inline-link" onClick={async () => {const res=await db!.auth.signOut({scope:"local"});setNotice(res.error?.message || "");}}>Sign out</button></header>
        {notice && <p role="status">{notice}</p>}
        <div className="account-sections" role="group" aria-label="Account sections">{sections.map(s=>
          <button key={s} aria-pressed={s===section} onClick={()=>setSection(s)}>{s}</button>)}</div>
        <Records key={session.user.id + section} owner={session.user.id} section={section} />
      </>}
  </main>;
}
