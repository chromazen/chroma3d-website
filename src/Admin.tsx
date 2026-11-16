import { useEffect, useRef, useState } from "react";
import { db, takeAdminEmailAction } from "./backend";
import { recoveryKey } from "./customerSession";
import Workspace from "./Workspace";
import StudioCatalogue from "./StudioCatalogue";
import {
  SquaresFourIcon,
  TrayIcon,
  SignOutIcon,
  ArrowRightIcon,
  LockSimpleIcon,
  EyeIcon,
  EyeSlashIcon,
} from "@phosphor-icons/react";
import "./studio-desk.css";
function finishSignIn(admin: boolean) {
  const requested = new URLSearchParams(location.search).get("returnTo");
  const allowed =
    requested &&
    (/^\/(?:requests|shop|studio|print|bag|checkout)?$/.test(requested) ||
      /^\/shop\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\?format=(?:print|stl))?$/.test(
        requested,
      ) ||
      (admin && requested === "/admin"));
  const path = allowed ? requested : admin ? "/admin" : "/account";
  if (location.pathname + location.search !== path) {
    history.replaceState(null, "", path);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }
}
function AuthenticatorVerification({
  client,
}: {
  client: NonNullable<typeof db>;
}) {
  const [factorId, setFactorId] = useState("");
  const [setup, setSetup] = useState<{ qr: string; key: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (factorId) {
        const result = await client.auth.mfa.challengeAndVerify({
          factorId,
          code,
        });
        if (result.error) throw result.error;
        setSetup(null);
        setCode("");
        return;
      }
      const factors = await client.auth.mfa.listFactors();
      if (factors.error) throw factors.error;
      const verified = factors.data.totp.find(
        (factor) => factor.status === "verified",
      );
      if (verified) {
        setFactorId(verified.id);
        return;
      }
      const result = await client.auth.mfa.enroll({
        factorType: "totp",
        issuer: "Chroma3D",
        friendlyName: "Studio " + new Date().toISOString(),
      });
      if (result.error) throw result.error;
      const { qr_code, secret } = result.data.totp;
      // Auth JS wraps raw SVG in a data URL. Escape paint colours such as #000.
      const svg = qr_code.slice(qr_code.indexOf(",") + 1);
      const qr =
        qr_code.startsWith("data:image/svg+xml") &&
        svg.trimStart().startsWith("<")
          ? "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg)
          : qr_code;
      setSetup({ qr, key: secret });
      setFactorId(result.data.id);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form-stack" onSubmit={submit}>
      <h2>Authenticator verification</h2>
      {setup && (
        <>
          <p>In Google Authenticator, tap + and choose Scan a QR code.</p>
          <img
            className="authenticator-qr"
            src={setup.qr}
            alt="Private Chroma3D authenticator enrollment QR code"
          />
          <details className="authenticator-manual">
            <summary>Can’t scan? Enter a setup key</summary>
            <p>
              In Google Authenticator, tap + and choose Enter a setup key. Name
              the account Chroma3D, enter the private key below, and select Time
              based.
            </p>
            <code>{setup.key}</code>
          </details>
        </>
      )}
      {factorId && (
        <label>
          Six-digit code
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
          />
        </label>
      )}
      {error && <p role="alert">{error}</p>}
      <button
        type="submit"
        disabled={busy || (!!factorId && code.length !== 6)}
      >
        {factorId ? "Verify" : "Set up or use authenticator"}
      </button>
    </form>
  );
}

export default function Admin() {
  const client = db;
  const [access, setAccess] = useState("loading"),
    [msg, setMsg] = useState(""),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [reset, setReset] = useState(false);
  const interactiveLogin = useRef(false);
  const passwordUser = useRef("");
  const [emailBusy, setEmailBusy] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [section, setSection] = useState<"catalogue" | "queue">("catalogue");
  useEffect(() => {
    if (!client) return;
    let live = true,
      revision = 0;
    const failedLink =
      new URLSearchParams(location.hash.slice(1)).has("error") ||
      new URLSearchParams(location.search).has("error_code");
    if (failedLink)
      setMsg(
        "This email link is invalid or has expired. Request a fresh recovery link.",
      );
    const { data } = client.auth.onAuthStateChange((event, session) => {
      if (!live) return;
      const current = ++revision;
      if (!session) {
        setAccess("login");
        setSection("catalogue");
        setReset(false);
        passwordUser.current = "";
        if (event === "SIGNED_OUT") {
          setRecovering(false);
          setShowPassword(false);
          interactiveLogin.current = false;
          sessionStorage.removeItem("chroma-password-setup");
          setPassword("");
        }
        return;
      }
      if (passwordUser.current !== session.user.id) {
        setAccess("loading");
      }
      passwordUser.current = session.user.id;
      const mailAction = takeAdminEmailAction();
      if (mailAction === "invite" || mailAction === "recovery" || event === "PASSWORD_RECOVERY")
        sessionStorage.setItem("chroma-password-setup", session.user.id);
      const setup =
        sessionStorage.getItem("chroma-password-setup") === session.user.id;
      setReset(setup);
      // Run after the auth callback has released its session lock.
      setTimeout(() => {
        if (live)
          client.rpc("admin_access").then((r) => {
            if (!live || current !== revision) return;
            if (r.error) {
              setAccess(r.status === 401 ? "login" : "denied");
              setMsg(
                r.status === 401
                  ? "Your session expired. Sign in again."
                  : "Unable to verify studio access. Refresh to retry.",
              );
              return;
            }
            if (setup && r.data === "denied") {
              // Dashboard invitations can land on the default /admin callback.
              // Give a confirmed customer a password setup screen on their own account.
              sessionStorage.setItem(recoveryKey, session.user.id);
              sessionStorage.removeItem("chroma-password-setup");
              history.replaceState(null, "", "/account");
              window.dispatchEvent(new PopStateEvent("popstate"));
              return;
            }
            setAccess(r.data);
            if (
              !setup &&
              (interactiveLogin.current ||
                (r.data === "admin" &&
                  new URLSearchParams(location.search).has("returnTo"))) &&
              r.data !== "mfa_required"
            ) {
              interactiveLogin.current = false;
              finishSignIn(r.data === "admin");
            }
          });
      }, 0);
    });
    return () => {
      live = false;
      data.subscription.unsubscribe();
    };
  }, [client]);
  async function run(task: () => Promise<void>) {
    setMsg("");
    try {
      await task();
    } catch (e) {
      setMsg((e as Error).message);
    }
  }
  if (!client)
    return (
      <main id="main" className="page wrap">
        Configure the development backend to enter the studio desk.
      </main>
    );
  function signOut() {
    void run(async () => {
      const result = await client!.auth.signOut();
      if (result.error) throw result.error;
    });
  }
  if (access === "admin" && !reset) {
    return (
      <main id="main" className="studio-desk wrap">
        <aside className="desk-rail">
          <h1>Studio desk</h1>
          <nav aria-label="Studio desk sections">
            <button
              aria-current={section === "catalogue" ? "page" : undefined}
              onClick={() => setSection("catalogue")}
            >
              <SquaresFourIcon aria-hidden />
              Catalogue
            </button>
            <button
              aria-current={section === "queue" ? "page" : undefined}
              onClick={() => setSection("queue")}
            >
              <TrayIcon aria-hidden />
              Work queue
            </button>
          </nav>
          <button className="desk-signout" onClick={signOut}>
            <SignOutIcon aria-hidden />
            Sign out
          </button>
        </aside>
        <div className="desk-body">
          <div hidden={section !== "catalogue"}>
            <StudioCatalogue />
          </div>
          <div hidden={section !== "queue"}>
            <Workspace admin />
          </div>
          {msg && <p role="status">{msg}</p>}
        </div>
      </main>
    );
  }
  return (
    <main id="main" className="desk-auth wrap">
      <div className="desk-auth-layout">
        <figure className="desk-auth-object">
          <div className="desk-auth-plate">
            <img
              src="/adiyogi-store-1440.webp"
              srcSet="/adiyogi-store-720.webp 720w, /adiyogi-store-1440.webp 1440w"
              sizes="(max-width: 700px) 90vw, 510px"
              width="1440"
              height="1017"
              alt="Adiyogi in ash grey, seen from a three-quarter angle"
            />
          </div>
          <figcaption>
            <span>Adiyogi</span>
            <span>Digital sculpt</span>
          </figcaption>
        </figure>
        <section className="desk-auth-panel" aria-labelledby="desk-auth-title">
          <header>
            <p className="desk-auth-eyebrow">
              <LockSimpleIcon aria-hidden />
              Administrator access
            </p>
            <h1 id="desk-auth-title">
              {access === "login" && recovering
                ? "Reset password"
                : "Studio desk"}
            </h1>
            {access === "login" && (
              <p className="desk-auth-intro">
                {recovering
                  ? "Enter your studio email to receive a password reset link."
                  : "Sign in to manage your catalogue and studio requests."}
              </p>
            )}
          </header>
          {access === "login" ? (
            <form
              className="form-stack"
              onSubmit={(e) => {
                e.preventDefault();
                if (emailBusy) return;
                void run(async () => {
                  setEmailBusy(true);
                  try {
                    if (recovering) {
                      const r = await client.auth.resetPasswordForEmail(
                        email.trim(),
                        {
                          redirectTo: location.origin + "/admin",
                        },
                      );
                      if (r.error) throw r.error;
                      setMsg("Check your email for the recovery link.");
                      return;
                    }
                    interactiveLogin.current = true;
                    const r = await client.auth.signInWithPassword({
                      email: email.trim(),
                      password,
                    });
                    if (r.error) {
                      interactiveLogin.current = false;
                      throw r.error;
                    }
                    setPassword("");
                    setShowPassword(false);
                  } finally {
                    setEmailBusy(false);
                  }
                });
              }}
            >
              <label>
                Email
                <input
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              {!recovering && (
                <div className="desk-auth-password">
                  <label htmlFor="desk-password">Password</label>
                  <div>
                    <input
                      id="desk-password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <button
                      type="button"
                      aria-label={
                        showPassword ? "Hide password" : "Show password"
                      }
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? (
                        <EyeSlashIcon aria-hidden />
                      ) : (
                        <EyeIcon aria-hidden />
                      )}
                    </button>
                  </div>
                </div>
              )}
              <button
                type="submit"
                className="desk-auth-submit"
                disabled={emailBusy}
              >
                {recovering
                  ? emailBusy
                    ? "Sending…"
                    : "Send reset link"
                  : emailBusy
                    ? "Signing in…"
                    : "Sign in"}
                <ArrowRightIcon aria-hidden />
              </button>
              <button
                type="button"
                className="desk-auth-link"
                disabled={emailBusy}
                onClick={() => {
                  setRecovering(!recovering);
                  setMsg("");
                  setPassword("");
                  setShowPassword(false);
                }}
              >
                {recovering ? "Back to sign in" : "Forgot your password?"}
              </button>
            </form>
          ) : (
            <>
              {access === "loading" && <p>Checking access…</p>}
              {reset && (
                <p>
                  Your email link opened a secure session. Set your password
                  below. If you already have an authenticator, verify it before
                  changing your password.
                </p>
              )}
              {access === "denied" && (
                <p>
                  Administrator membership required.{" "}
                  <a href="/requests">Open your requests</a>
                </p>
              )}
              {access === "mfa_required" && (
                <AuthenticatorVerification
                  key={passwordUser.current}
                  client={client}
                />
              )}
              {reset && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run(async () => {
                      const r = await client.auth.updateUser({ password });
                      if (r.error) throw r.error;
                      if (
                        sessionStorage.getItem("chroma-password-setup") ===
                        passwordUser.current
                      )
                        sessionStorage.removeItem("chroma-password-setup");
                      setReset(false);
                      setPassword("");
                      setMsg("Password updated.");
                    });
                  }}
                >
                  <label>
                    Set your password
                    <input
                      type="password"
                      autoComplete="new-password"
                      minLength={12}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </label>
                  <button>Save password</button>
                </form>
              )}
              {access !== "loading" && (
                <button className="desk-auth-link" onClick={signOut}>
                  Sign out
                </button>
              )}
            </>
          )}
          <p role="status" className="desk-auth-feedback">
            {msg}
          </p>
        </section>
      </div>
    </main>
  );
}
