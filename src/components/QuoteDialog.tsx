import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  XIcon,
  ArrowUpRightIcon,
  WhatsappLogoIcon,
  ArrowLeftIcon,
} from "@phosphor-icons/react";
import { business } from "../content";

export default function QuoteDialog({
  open,
  onClose,
  brief,
  qty,
}: {
  open: boolean;
  onClose: () => void;
  brief: string;
  qty: number;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [prepared, setPrepared] = useState("");
  useEffect(() => {
    if (open) {
      setPrepared("");
      formRef.current?.reset();
      ref.current?.showModal();
    } else ref.current?.close();
  }, [open]);

  function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const message = `Hello Chroma3D!\n\nName: ${data.get("name")}\nEnquiry: ${data.get("type")}\nQuantity: ${data.get("quantity") || "To discuss"}\n\n${data.get("requirement")}\n\nI’ll attach any relevant STL or 3MF files in this chat.`;
    setPrepared(
      `https://wa.me/${business.whatsapp}?text=${encodeURIComponent(message)}`,
    );
  }

  return (
    <dialog
      ref={ref}
      className="quote-dialog"
      aria-labelledby="quote-title"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const r = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < r.left ||
            event.clientX > r.right ||
            event.clientY < r.top ||
            event.clientY > r.bottom
          )
            onClose();
        }
      }}
    >
      <button
        type="button"
        className="dialog-close icon-button"
        aria-label="Close enquiry"
        onClick={onClose}
      >
        <XIcon size={22} />
      </button>
      <h2 id="quote-title">Personal print quote</h2>
      {prepared ? (
        <div className="prepared-enquiry" aria-live="polite">
          <WhatsappLogoIcon size={40} weight="light" />
          <h3>Your enquiry is ready.</h3>
          <p>
            Open WhatsApp to review and send it. Attach your STL or 3MF directly
            in the chat. Nothing has been sent yet.
          </p>
          <a
            className="button button-copper"
            href={prepared}
            target="_blank"
            rel="noopener noreferrer"
          >
            Continue in WhatsApp <ArrowUpRightIcon size={20} />
          </a>
          <button
            type="button"
            className="text-button"
            onClick={() => setPrepared("")}
          >
            <ArrowLeftIcon size={16} /> Edit details
          </button>
        </div>
      ) : null}
      <form ref={formRef} onSubmit={prepare} hidden={!!prepared}>
        <p className="dialog-intro">
          A few details help us understand what you need. Continue in WhatsApp
          to share your model and discuss a quote.
        </p>
        <label>
          Your name
          <input
            name="name"
            autoComplete="name"
            required
            maxLength={100}
            placeholder="How should we address you?"
          />
        </label>
        <div className="form-row">
          <label>
            I’m interested in
            <select name="type" defaultValue="Small-batch printing">
              <option>Custom 3D printing</option>
              <option>Physical products</option>
              <option>Small-batch printing</option>
            </select>
          </label>
          <label>
            Quantity <span>(optional)</span>
            <input
              name="quantity"
              defaultValue={qty}
              type="number"
              min={1}
              max={100000}
              placeholder="e.g. 2"
            />
          </label>
        </div>
        <label>
          What are you making?
          <textarea
            name="requirement"
            defaultValue={brief}
            required
            minLength={10}
            maxLength={3000}
            rows={3}
            placeholder="Tell us about the object, its intended use and any preferred timing."
          />
        </label>
        <p className="form-note">
          Your details stay in this browser until you choose to send them
          through WhatsApp. Files are attached in the chat, not on this website.
        </p>
        <button className="button button-copper" type="submit">
          Prepare enquiry <ArrowUpRightIcon size={20} />
        </button>
      </form>
    </dialog>
  );
}
