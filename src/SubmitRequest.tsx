import { useState } from "react";
import { submitWork } from "./backend";
type Props = {
  kind: "print" | "studio";
  title: string;
  specification: Record<string, unknown>;
  files: File[];
  contact?: { name: string; email: string };
};
export default function SubmitRequest({
  kind,
  title,
  specification,
  files,
  contact,
}: Props) {
  const [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  if (saved)
    return (
      <p role="status">
        Received by the development studio.{" "}
        <a className="inline-link" href="/requests">
          View your request
        </a>
      </p>
    );
  return (
    <form
      className="form-stack"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        const f = new FormData(e.currentTarget);
        setBusy(true);
        setError("");
        setProgress(0);
        try {
          await submitWork(
            kind,
            {
              title,
              name: contact?.name ?? f.get("name"),
              email: contact?.email ?? f.get("email"),
              specification: {
                ...specification,
                ...Object.fromEntries(
                  [
                    "requested_dimensions",
                    "delivery_date",
                    "notes",
                    "budget",
                    "timeline",
                  ]
                    .filter((k) => f.has(k))
                    .map((k) => [k, f.get(k)]),
                ),
              },
            },
            files,
            setProgress,
          );
          setSaved(true);
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3>
        {kind === "print"
          ? "Send a quotation request"
          : "Send this project to the studio"}
      </h3>
      {!contact && (
        <div className="form-pair">
          <label>
            Your name
            <input required maxLength={100} name="name" autoComplete="name" />
          </label>
          <label>
            Contact email
            <input
              required
              name="email"
              type="email"
              maxLength={254}
              autoComplete="email"
            />
          </label>
        </div>
      )}
      {kind === "print" ? (
        <details>
          <summary>Dimensions, delivery or notes</summary>
          <label>
            Requested dimensions
            <input name="requested_dimensions" maxLength={150} />
          </label>
          <label>
            Requested delivery
            <input type="date" name="delivery_date" />
          </label>
          <label>
            Notes
            <textarea name="notes" maxLength={1500} />
          </label>
        </details>
      ) : (
        <details>
          <summary>Budget and timeline</summary>
          <label>
            Budget (optional)
            <input name="budget" maxLength={100} />
          </label>
          <label>
            Timeline (optional)
            <input name="timeline" maxLength={100} />
          </label>
        </details>
      )}
      <p className="fine">
        Submitting shares your contact details and selected files privately with
        the development studio. Keep this browser tab to access your request.
      </p>
      <button disabled={busy} className="primary">
        {busy
          ? "Submitting…"
          : kind === "print"
            ? "Submit quote request"
            : "Submit project brief"}
      </button>
      {busy && (
        <progress aria-label="Upload progress" max={100} value={progress} />
      )}{" "}
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
