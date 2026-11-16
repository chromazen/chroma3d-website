import { lazy, Suspense, useEffect, useState } from "react";
import { useMotionValue } from "motion/react";
import {
  ArrowUpRightIcon,
  PencilSimpleIcon,
  ChatsCircleIcon,
  CheckSquareIcon,
  CubeIcon,
} from "@phosphor-icons/react";
import {connected} from "./catalog";
import SubmitRequest from "./SubmitRequest";
import { business } from "./content";
const ModelStage = lazy(() => import("./components/ModelStage"));

const stages = [
  {
    title: "Share",
    text: "Describe the idea. Add sketches, dimensions or a reference.",
    Icon: PencilSimpleIcon,
  },
  {
    title: "Discuss",
    text: "Work through the intended use, scope and design effort.",
    Icon: ChatsCircleIcon,
  },
  {
    title: "Finalize",
    text: "Review the design and approve the version to be made.",
    Icon: CheckSquareIcon,
  },
  {
    title: "Make",
    text: "Agree on production and delivery before the first print.",
    Icon: CubeIcon,
  },
];

function ReferenceFile({ file }: { file: File }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const source = URL.createObjectURL(file);
    setUrl(source);
    return () => URL.revokeObjectURL(source);
  }, [file]);
  return (
    <a
      className="inline-link"
      href={url || undefined}
      target="_blank"
      rel="noopener noreferrer"
    >
      {file.name} <ArrowUpRightIcon />
    </a>
  );
}

export function useStudioProject() {
  const [brief, setBrief] = useState<{
      name: string;
      email: string;
      idea: string;
      requirements: string;
      reference: string;
    } | null>(null),
    [files, setFiles] = useState<File[]>([]),
    [phase, setPhase] = useState<
      "brief" | "received" | "design" | "approved" | "delivery"
    >("brief"),
    [note, setNote] = useState(""),
    [revision, setRevision] = useState(""),
    [editing, setEditing] = useState(false),
    [delivery, setDelivery] = useState("");
  return {
    files,
    setFiles,
    brief,
    setBrief,
    phase,
    setPhase,
    note,
    setNote,
    revision,
    setRevision,
    editing,
    setEditing,
    delivery,
    setDelivery,
  };
}
export default function Studio({
  project,
}: {
  project: ReturnType<typeof useStudioProject>;
}) {
  const {
    files,
    setFiles,
    brief,
    setBrief,
    phase,
    setPhase,
    note,
    setNote,
    revision,
    setRevision,
    editing,
    setEditing,
    delivery,
    setDelivery,
  } = project;
  const progress = useMotionValue(0);
  const [fileError, setFileError] = useState("");
  return (
    <main className="wrap project-page" id="main">
      <header
        className={phase === "brief" ? "project-hero" : "workspace-header"}
      >
        <div>
          <p className="kicker">03 / Prototyping studio</p>
          {phase === "brief" ? (
            <>
              <h1 className="display-title">
                HAVE AN IDEA?
                <br />
                <em>LET’S MAKE IT REAL.</em>
              </h1>
              <p className="editorial-deck">
                Bring our Chennai studio a sketch, a reference or a problem
                to solve. We’ll work through the design together before it goes to print.
              </p>
            </>
          ) : (
            <h1 className="display-title">
              Your project<em>.</em>
            </h1>
          )}
        </div>
        {phase === "brief" && (
          <img
            src="/bracket-study.webp"
            alt="CAD study of a ribbed mounting bracket with a bronze bushing and slotted base"
          />
        )}
      </header>
      <div className="project-layout">
        <aside className="process-card">
          <p className="kicker">Studio process</p>
          <h2>From first sketch to finished part.</h2>
          <ol>
            {stages.map(({ title, text, Icon }, i) => (
              <li
                key={title}
                aria-current={
                  i ===
                  (phase === "brief"
                    ? 0
                    : phase === "received"
                      ? 1
                      : phase === "design"
                        ? 2
                        : 3)
                    ? "step"
                    : undefined
                }
              >
                <Icon size={24} weight="light" />
                <h3>
                  0{i + 1}. {title}
                </h3>
                <p>{text}</p>
              </li>
            ))}
          </ol>
        </aside>
        <section className="portal project-panel">
          {phase === "brief" ? (
            <form
              className="form-stack project-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (fileError) return;
                const f = new FormData(e.currentTarget);
                setBrief({
                  name: String(f.get("name")),
                  email: String(f.get("email")),
                  idea: String(f.get("idea")),
                  requirements: String(f.get("requirements")),
                  reference: String(f.get("reference")),
                });
                setPhase("received");
              }}
            >
              <div>
                <p className="kicker">Project intake</p>
                <h2>Tell us what you’re imagining.</h2>
                <p className="fine">
                  {connected?"Prepare your brief, then choose whether to send it to the development studio.":"Local preview. Use sample details to try a brief and design review."}
                </p>
              </div>
              <label>
                What would you like to make?
                <textarea
                  required
                  minLength={10}
                  maxLength={3000}
                  rows={3}
                  name="idea"
                  defaultValue={brief?.idea}
                  placeholder="Tell us what it should do and who will use it."
                />
              </label>
              <details
                className="brief-extras"
                open={fileError ? true : undefined}
              >
                <summary>References &amp; project requirements</summary>
                <label>
                  Dimensions, quantity or target date
                  <textarea
                    name="requirements"
                    rows={2}
                    maxLength={1000}
                    defaultValue={brief?.requirements}
                  />
                </label>
                <label>
                  Reference link
                  <input
                    type="url"
                    name="reference"
                    maxLength={700}
                    defaultValue={brief?.reference}
                    placeholder="https://"
                  />
                </label>
                <label>
                  Add reference files
                  <input
                    type="file"
                    multiple
                    accept="image/jpeg,image/png,application/pdf"
                    onChange={(e) => {
                      const picked = Array.from(e.target.files || []);
                      e.target.value = "";
                      const next = [...files, ...picked];
                      if (
                        next.length > 3 ||
                        next.some(
                          (f) => !/\.(jpe?g|png|pdf)$/i.test(f.name) || !f.size,
                        ) ||
                        next.reduce((sum, f) => sum + f.size, 0) >
                          10 * 1024 * 1024
                      ) {
                        setFileError(
                          "Choose up to three non-empty JPG, PNG or PDF files, up to 10 MB combined.",
                        );
                        return;
                      }
                      setFileError("");
                      setFiles(next);
                    }}
                  />
                  <small>
                    Up to three images or PDFs, 10 MB combined. {connected?"Files are sent only when you submit the brief.":"Files stay on this device."}
                  </small>
                </label>
                {fileError && (
                  <p role="alert">
                    {fileError}{" "}
                    <button
                      type="button"
                      className="inline-link"
                      onClick={() => setFileError("")}
                    >
                      Dismiss
                    </button>
                  </p>
                )}
                {files.map((f, i) => (
                  <div className="reference-row" key={i}>
                    <span>{f.name}</span>
                    <button
                      className="inline-link"
                      type="button"
                      onClick={() => {
                        setFiles(files.filter((_, j) => j !== i));
                        setFileError("");
                      }}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </details>
              <div className="form-pair">
                <label>
                  Your name
                  <input required name="name" defaultValue={brief?.name} />
                </label>
                <label>
                  Contact email
                  <input
                    required
                    type="email"
                    name="email"
                    defaultValue={brief?.email}
                  />
                </label>
              </div>
              <button className="primary">
                Preview project brief <ArrowUpRightIcon />
              </button>
            </form>
          ) : (
            <>
              <p className="breadcrumb">Sample project workspace</p>
              <h2>
                {phase === "received"
                  ? "Brief prepared"
                  : phase === "design"
                    ? "Design review"
                    : phase === "approved"
                      ? "Design approval"
                      : "Delivery details prepared"}
              </h2>
              <blockquote>{brief?.idea}</blockquote>
              {connected && brief && phase==="received" && <SubmitRequest kind="studio" title={brief.idea.slice(0,160)} specification={{idea:brief.idea,requirements:brief.requirements,reference:brief.reference}} contact={{name:brief.name,email:brief.email}} files={files}/>}
              <p className="fine">
                {brief?.name} · {brief?.email}
              </p>
              {brief?.requirements && <p>{brief.requirements}</p>}
              {brief?.reference && (
                <p className="reference">
                  <strong>Reference</strong>
                  <br />
                  {brief.reference}
                </p>
              )}
              {files.length > 0 && (
                <section aria-label="Local reference files">
                  {files.map((f, i) => (
                    <div key={i}>
                      <ReferenceFile file={f} />
                    </div>
                  ))}
                </section>
              )}
              {phase === "received" && (
                <>
                  <p>
                    This brief is saved for this session. Try the sample review
                    below, or open a draft in WhatsApp to discuss your idea with
                    the studio. Attach any reference files there before sending.
                  </p>
                  <button
                    className="primary"
                    onClick={() => setPhase("design")}
                  >
                    Explore a sample design review <ArrowUpRightIcon />
                  </button>
                  <button
                    className="inline-link"
                    onClick={() => setPhase("brief")}
                  >
                    Edit brief
                  </button>
                  <a
                    className="inline-link contact-draft"
                    target="_blank"
                    rel="noopener noreferrer"
                    href={
                      "https://wa.me/" +
                      business.whatsapp +
                      "?text=" +
                      encodeURIComponent(
                        [
                          "Project enquiry",
                          brief?.name,
                          brief?.idea,
                          brief?.requirements,
                          brief?.reference,
                        ]
                          .filter(Boolean)
                          .join("\n"),
                      )
                    }
                  >
                    Review brief in WhatsApp <ArrowUpRightIcon />
                  </a>
                </>
              )}
              {phase === "design" && (
                <>
                  <p>
                    The gear assembly below is a sample proposal for trying the
                    review controls.
                  </p>
                  <div className="proposal-view">
                    <Suspense fallback={<p>Opening study…</p>}>
                      <ModelStage progress={progress} />
                    </Suspense>
                  </div>
                  {revision && (
                    <p className="revision">
                      <b>Requested change</b>
                      <br />
                      {revision}
                    </p>
                  )}
                  {editing ? (
                    <form
                      className="form-stack"
                      onSubmit={(e) => {
                        e.preventDefault();
                        setRevision(note);
                        setEditing(false);
                      }}
                    >
                      <label>
                        What should change?
                        <textarea
                          required
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                        />
                      </label>
                      <button className="secondary">Save revision note</button>
                    </form>
                  ) : (
                    <div className="actions">
                      <button
                        className="primary"
                        onClick={() => setPhase("approved")}
                      >
                        Approve sample design
                      </button>
                      <button
                        className="inline-link"
                        onClick={() => setEditing(true)}
                      >
                        Request a revision
                      </button>
                    </div>
                  )}
                </>
              )}
              {phase === "approved" && (
                <form
                  className="form-stack"
                  onSubmit={(e) => {
                    e.preventDefault();
                    setDelivery(
                      String(new FormData(e.currentTarget).get("address")),
                    );
                    setPhase("delivery");
                  }}
                >
                  <p>
                    Sample design approved. In a live project, the studio would
                    confirm the specification, quotation and dispatch plan with
                    you.
                  </p>
                  <label>
                    Sample delivery address
                    <textarea
                      required
                      rows={2}
                      name="address"
                      maxLength={600}
                    />
                  </label>
                  <button className="primary">
                    Preview delivery handoff <ArrowUpRightIcon />
                  </button>
                </form>
              )}
              {phase === "delivery" && (
                <>
                  <p>
                    <strong>Delivery handoff</strong>
                    <br />
                    {brief?.name}
                    <br />
                    {delivery}
                  </p>
                  <p>
                    You’ve reached the end of the project preview. Production
                    and shipping require confirmation from the studio.
                  </p>
                  <a className="inline-link" href="/">
                    Return to the studio
                  </a>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => {
                      setBrief(null);
                      setFiles([]);
                      setFileError("");
                      setPhase("brief");
                      setEditing(false);
                      setNote("");
                      setRevision("");
                      setDelivery("");
                    }}
                  >
                    Start a new sample brief
                  </button>
                </>
              )}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
