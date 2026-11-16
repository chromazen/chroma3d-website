import { lazy, Suspense, useRef, useState } from "react";
import { ArrowUpRightIcon, UploadSimpleIcon } from "@phosphor-icons/react";
import {connected} from "./catalog";
import SubmitRequest from "./SubmitRequest";
import { business } from "./content";
import { printMaterials, rupees, navigate } from "./collection";
import type { CartLine } from "./collection";
import type { Inspection } from "./printModel";

const FileViewer = lazy(() => import("./FileViewer"));

export default function Printing({
  add,
}: {
  add: (line: CartLine) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<Inspection>({
    valid: false,
    message: "",
  });
  const [material, setMaterial] = useState(0);
  const [custom, setCustom] = useState("");
  const [colour, setColour] = useState("Studio to advise");
  const [finish, setFinish] = useState("Standard");
  const [qty, setQty] = useState(1);
  const [over, setOver] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [review, setReview] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const choice = printMaterials[material];
  const other = choice.name === "Other material";
  const selected = other ? custom.trim() : choice.name;
  const quoteOnly = other || report.beyondMax === true;
  const ready =
    !!file &&
    report.valid &&
    !!selected &&
    Number.isInteger(qty) &&
    qty >= 1 &&
    qty <= 100000;
  const step = review ? 4 : !file ? 1 : configured && report.valid ? 3 : 2;

  function choose(next?: File) {
    if (!next) return;
    setReview(false);
    setConfigured(false);
    if (
      !/\.(stl|3mf)$/i.test(next.name) ||
      !next.size ||
      next.size > 25 * 1024 * 1024
    ) {
      setFile(null);
      setReport({
        valid: false,
        message: "Choose a non-empty STL or 3MF up to 25 MB.",
      });
      return;
    }
    setReport({ valid: false, message: "Reading geometry…" });
    setFile(next);
  }

  function addPrint() {
    if (!file || !ready || quoteOnly || !review) return;
    add({
      key: "print-" + crypto.randomUUID(),
      title: file.name,
      detail: [selected, colour, finish].join(" · "),
      price: choice.price,
      quantity: qty,
      physical: true,
      file,
    });
    navigate("/bag");
  }

  return (
    <main className="wrap config-page" id="main">
      <header className="config-header">
        <div>
          <p className="kicker">02 / Custom 3D printing in Chennai</p>
          <h1 className="display-title">
            Upload. Configure. <em>Print.</em>
          </h1>
        </div>
        <ol className="step-track" aria-label="Print workflow">
          {["Upload", "Inspect", "Configure", "Review"].map((s, i) => (
            <li key={s} aria-current={i + 1 === step ? "step" : undefined}>
              <b>{i + 1}</b>
              {s}
            </li>
          ))}
        </ol>
      </header>
      <div className="config-layout">
        <section
          className="config-inputs"
          aria-label="File and manufacturing preferences"
        >
          <input
            ref={input}
            type="file"
            className="sr-only"
            tabIndex={-1}
            accept=".stl,.3mf"
            aria-label="Choose a 3D model"
            onChange={(e) => {
              choose(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <button
            className={"file-drop" + (over ? " over" : "")}
            onClick={() => input.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              choose(e.dataTransfer.files[0]);
            }}
          >
            <UploadSimpleIcon size={44} weight="light" />
            <strong>{file ? file.name : "Drop your 3D file here"}</strong>
            <small>STL or 3MF · up to 25 MB · processed on this device</small>
            <span>
              {file ? "Replace file" : "Choose a file"} <ArrowUpRightIcon />
            </span>
          </button>
          {file && (
            <a className="inspect-jump" href="#model-preview">
              Inspect this file ↓
            </a>
          )}
          <div
            className="config-settings"
            onChange={() => {
              setConfigured(true);
              setReview(false);
            }}
          >
            <h2>Manufacturing preferences</h2>
            <div className="preferences">
              <label>
                Material preference
                <select
                  value={material}
                  onChange={(e) => setMaterial(Number(e.target.value))}
                >
                  {printMaterials.map((m, i) => (
                    <option key={m.name} value={i}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Colour preference
                <select
                  value={colour}
                  onChange={(e) => setColour(e.target.value)}
                >
                  {[
                    "Studio to advise",
                    "Graphite",
                    "White",
                    "Black",
                    "Natural",
                    "Custom colour",
                  ].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label>
                Layer / finish
                <select
                  value={finish}
                  onChange={(e) => setFinish(e.target.value)}
                >
                  {["Standard", "Fine detail", "Studio to advise"].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label>
                Quantity
                <input
                  type="number"
                  min="1"
                  max="100000"
                  value={qty || ""}
                  onChange={(e) => setQty(Number(e.target.value))}
                />
              </label>
              {other && (
                <label className="full-width">
                  Requested filament
                  <input
                    value={custom}
                    maxLength={80}
                    onChange={(e) => setCustom(e.target.value)}
                  />
                </label>
              )}
            </div>
          </div>
        </section>
        <section
          id="model-preview"
          tabIndex={-1}
          className="inspection-panel"
          aria-label="Geometry inspection and review"
        >
          <div className="inspection-label">
            <span className="micro">Model preview</span>
            <span>{file ? "Local file" : "Build space"}</span>
          </div>
          <Suspense
            fallback={<div className="viewer">Opening build volume…</div>}
          >
            <FileViewer file={file} onReport={setReport} />
          </Suspense>
          <div className="review-panel">
            <h2>
              {review
                ? "Review your specification"
                : "Production feasibility review"}
            </h2>
            <p className="fine" role="status">
              {report.dimensions
                ? "Bounds: " + report.dimensions + ". " + report.message
                : report.message || "Choose/Upload a file and inspect"}
            </p>
            {review && (
              <div className="review-spec">
                <strong>
                  {selected} · {colour} · {finish} · Qty {qty}
                </strong>
                <span>
                  {connected
                    ? "The studio will review the model and material before quoting."
                    : quoteOnly
                    ? "The studio will review your requirements for a quotation."
                    : "Illustrative subtotal " +
                      rupees(choice.price * qty) +
                      ". Production pricing requires review and slicing."}
                </span>
              </div>
            )}
            {connected&&review&&ready&&file&&<SubmitRequest key={file.name+"-"+file.lastModified} kind="print" title={file.name} files={[file]} specification={{material:selected,colour,finish,quantity:qty,inspected_bounds:report.dimensions}}/>}
            <div className="review-actions">
              <a
                className="secondary"
                href={`https://api.whatsapp.com/send/?phone=${business.whatsapp}&text&type=phone_number&app_absent=0`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Request bulk quote <ArrowUpRightIcon />
              </a>
              {!review ? (
                <button
                  className="primary"
                  disabled={!ready}
                  onClick={() => setReview(true)}
                >
                  Continue to review <ArrowUpRightIcon />
                </button>
              ) : (
                !quoteOnly && (
                  <button
                    className="primary"
                    disabled={!ready}
                    onClick={addPrint}
                  >
                    Add sample print to bag <ArrowUpRightIcon />
                  </button>
                )
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
