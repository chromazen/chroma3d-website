import { useEffect, useRef, useState } from "react";
import {
  ArrowCounterClockwiseIcon,
  ArrowUpRightIcon,
  CubeIcon,
  MinusIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
} from "@phosphor-icons/react";
import type { SculptureScene } from "./sculptureScene";
import { collection } from "../collection";

export default function SculptureViewer({
  portrait = false,
  makingOfUrl,
  sculpture = collection[0],
}: {
  portrait?: boolean;
  makingOfUrl?: string;
  sculpture?: (typeof collection)[number];
}) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<SculptureScene | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">(
    "loading",
  );
  const [spinning, setSpinning] = useState(
    () => typeof window !== "undefined" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const changed = () => setSpinning(!preference.matches);
    preference.addEventListener("change", changed);
    return () => preference.removeEventListener("change", changed);
  }, []);
  useEffect(() => {
    scene.current?.setSpinning(status === "ready" && spinning);
  }, [status, spinning]);

  useEffect(() => {
    const el = host.current!;
    const controller = new AbortController();
    async function mount() {
      const { createSculptureScene } = await import("./sculptureScene");
      if (controller.signal.aborted) return;
      scene.current = await createSculptureScene(
        el,
        controller.signal,
        () => setStatus("unavailable"),
        sculpture.modelUrl,
        sculpture.neutralLighting,
      );
      if (!controller.signal.aborted) setStatus("ready");
    }
    mount().catch(() => {
      if (!controller.signal.aborted) setStatus("unavailable");
    });
    return () => {
      controller.abort();
      scene.current?.dispose();
      scene.current = null;
    };
  }, [sculpture.modelUrl, sculpture.neutralLighting]);

  const ready = status === "ready";
  return (
    <figure
      className={portrait ? "sculpture-view portrait" : "sculpture-view"}
      aria-label={`Interactive ${sculpture.name} sculpture`}
    >
      <div className="sculpture-bed">
        <img
          className="sculpture-still"
          src={sculpture.cover}
          alt={`Front view of ${sculpture.name}`}
          fetchPriority={portrait ? "high" : "auto"}
          hidden={ready}
        />
        <div
          className="sculpture-canvas"
          ref={host}
          tabIndex={ready ? 0 : -1}
          role="group"
          aria-label={`${sculpture.name} 3D model. Drag or use the arrow keys to rotate. Use plus and minus to zoom and Home to reset.`}
          style={{ visibility: ready ? "visible" : "hidden" }}
        />
        {!portrait && (
          <span className="sculpture-label">
            <CubeIcon size={16} /> Model view
          </span>
        )}
        {ready && (
          <div className="sculpture-actions">
            <button
              type="button"
              aria-label={spinning ? "Pause rotation" : "Start rotation"}
              title={spinning ? "Pause rotation" : "Start rotation"}
              onClick={() => setSpinning(!spinning)}
            >
              {spinning ? <PauseIcon /> : <PlayIcon />}
            </button>
            <button
              aria-label="Reset model view"
              title="Reset model view"
              onClick={() => scene.current?.reset()}
            >
              <ArrowCounterClockwiseIcon />
            </button>
          </div>
        )}
      </div>
      <figcaption className="sculpture-tools">
        <span className="sculpture-caption">
          {portrait && <strong>{sculpture.name}</strong>}
          <span role="status">
            {ready
              ? "Drag to rotate"
              : status === "loading"
                ? "Loading sculpture…"
                : "Front view · 3D unavailable"}
          </span>
        </span>
        {makingOfUrl && (
          <a
            className="making-of-link"
            href={makingOfUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            See in the making <ArrowUpRightIcon aria-hidden="true" />
          </a>
        )}
        {ready && (
          <div className="sculpture-zoom" role="group" aria-label="Model zoom">
            <button
              aria-label="Zoom out"
              onClick={() => scene.current?.zoom(false)}
            >
              <MinusIcon />
            </button>
            <button
              aria-label="Zoom in"
              onClick={() => scene.current?.zoom(true)}
            >
              <PlusIcon />
            </button>
          </div>
        )}
      </figcaption>
    </figure>
  );
}
