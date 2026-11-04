import { useEffect, useRef, useState } from "react";
import * as T from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { readPrintModel, disposeModel, GUIDE_MM } from "./printModel";
import type { Inspection } from "./printModel";

function dimensionLabel(axis: string, x: number, y: number, z: number) {
  const surface = document.createElement("canvas");
  surface.width = 256;
  surface.height = 64;
  const ctx = surface.getContext("2d")!;
  ctx.fillStyle = "#171a18";
  ctx.fillRect(0, 0, surface.width, surface.height);
  ctx.fillStyle = "#e8ceae";
  ctx.font = "500 40px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(axis + "  " + GUIDE_MM, 128, 33);
  const map = new T.CanvasTexture(surface);
  map.colorSpace = T.SRGBColorSpace;
  const label = new T.Sprite(
    new T.SpriteMaterial({
      map,
      toneMapped: false,
      depthWrite: false,
      sizeAttenuation: false,
    }),
  );
  label.position.set(x, y, z);
  return label;
}

export default function FileViewer({
  file,
  onReport,
}: {
  file: File | null;
  onReport: (report: Inspection) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const frame = useRef<(modelOnly: boolean) => void>(() => {});
  const [status, setStatus] = useState("");
  const [hasModel, setHasModel] = useState(false);
  useEffect(() => {
    const el = host.current!;
    let closed = false;
    let model: T.Group | undefined;
    setHasModel(false);
    setStatus(file ? "Reading model…" : "");
    const half = GUIDE_MM / 2;
    const volume = new T.Box3(
      new T.Vector3(-half, 0, -half),
      new T.Vector3(half, GUIDE_MM, half),
    );
    const modelBounds = new T.Box3();
    const scene = new T.Scene();
    const guide = new T.Box3Helper(volume.clone(), new T.Color(0xd99a65));
    const grid = new T.GridHelper(GUIDE_MM, 10, 0x676258, 0x454944);
    grid.position.y = -0.2;
    const labels = [
      dimensionLabel("X", 0, 0, half + 16),
      dimensionLabel("Y", half + 16, 0, 0),
      dimensionLabel("Z", -half - 8, half, half + 12),
    ];
    scene.add(...labels);
    scene.add(guide, grid, new T.HemisphereLight(0xffffff, 0x88766a, 1.2));
    const key = new T.DirectionalLight(0xffffff, 2.1);
    key.position.set(2, 4, 5);
    scene.add(key);

    let renderer: T.WebGLRenderer | undefined;
    let controls: OrbitControls | undefined;
    try {
      renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
      renderer.toneMapping = T.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 0.95;
      el.appendChild(renderer.domElement);
    } catch {
      setStatus("3D display unavailable on this device.");
    }
    const camera = new T.PerspectiveCamera(36, 1, 0.1, 5000);
    const direction = new T.Vector3(1, 0.78, 1.2).normalize();
    const render = () => renderer?.render(scene, camera);
    if (renderer) {
      controls = new OrbitControls(camera, renderer.domElement);
      controls.enablePan = false;
      controls.addEventListener("change", render);
    }
    let focusOnPart = false;
    function fit(modelOnly: boolean) {
      if (!controls) return;
      focusOnPart = modelOnly && !modelBounds.isEmpty();
      const bounds = focusOnPart
        ? modelBounds
        : volume.clone().union(modelBounds);
      const center = bounds.getCenter(new T.Vector3());
      const radius = Math.max(
        0.01,
        bounds.getSize(new T.Vector3()).length() / 2,
      );
      const slope =
        Math.tan(T.MathUtils.degToRad(camera.fov / 2)) *
        Math.min(1, camera.aspect);
      const distance = (radius / Math.sin(Math.atan(slope))) * 1.04;
      camera.position.copy(center).addScaledVector(direction, distance);
      controls.target.copy(center);
      const extent = volume
        .clone()
        .union(modelBounds)
        .getSize(new T.Vector3())
        .length();
      controls.minDistance = Math.min(radius * 0.2, 10);
      controls.maxDistance = Math.max(distance * 3, extent * 5);
      camera.near = Math.max(0.001, controls.minDistance / 100);
      camera.far = controls.maxDistance + extent * 2;
      camera.updateProjectionMatrix();
      controls.update();
      render();
    }
    frame.current = fit;
    function resize() {
      const { clientWidth: w, clientHeight: h } = el;
      if (!w || !h) return;
      renderer?.setSize(w, h);
      camera.aspect = w / h;
      const pixelScale =
        (2 * Math.tan(T.MathUtils.degToRad(camera.fov / 2))) / h;
      for (const label of labels)
        label.scale.set(68 * pixelScale, 17 * pixelScale, 1);
      fit(focusOnPart);
    }
    const keys = (e: KeyboardEvent) => {
      if (!controls) return;
      switch (e.key) {
        case "ArrowLeft":
          controls.rotateLeft(0.15);
          break;
        case "ArrowRight":
          controls.rotateLeft(-0.15);
          break;
        case "ArrowUp":
          controls.rotateUp(0.15);
          break;
        case "ArrowDown":
          controls.rotateUp(-0.15);
          break;
        case "+":
        case "=":
          controls.dollyIn(0.85);
          break;
        case "-":
          controls.dollyOut(0.85);
          break;
        case "Home":
          fit(false);
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    el.addEventListener("keydown", keys);
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();

    if (file)
      file
        .arrayBuffer()
        .then((data) => {
          if (closed) return;
          const result = readPrintModel(data, file.name);
          model = result.model;
          scene.add(model);
          modelBounds.setFromObject(model, true);
          onReport(result.report);
          setStatus(
            renderer
              ? ""
              : "File measured. 3D display unavailable on this device.",
          );
          setHasModel(!!renderer);
          fit(false);
        })
        .catch((error) => {
          if (closed) return;
          onReport({
            valid: false,
            message:
              error instanceof Error
                ? error.message
                : "The file could not be read.",
          });
          setStatus("Model preview unavailable");
        });
    return () => {
      closed = true;
      frame.current = () => {};
      observer.disconnect();
      el.removeEventListener("keydown", keys);
      controls?.dispose();
      guide.dispose();
      grid.dispose();
      for (const label of labels) {
        label.material.map?.dispose();
        label.material.dispose();
      }
      if (model) disposeModel(model);
      renderer?.dispose();
      renderer?.forceContextLoss();
      renderer?.domElement.remove();
    };
  }, [file, onReport]);
  return (
    <>
      <div className="viewer build-view">
        <div
          ref={host}
          className="viewer-canvas"
          role="group"
          tabIndex={0}
          aria-label={
            (file ? file.name + ". " : "") +
            "250 millimetre working volume. Drag or use arrow keys to rotate, plus and minus to zoom, Home to reset."
          }
        />
        {status && <span className="viewer-status">{status}</span>}
      </div>
      {hasModel && (
        <div className="volume-controls">
          <small>Drag to orbit</small>
          <button onClick={() => frame.current(true)}>Frame model</button>
          <button onClick={() => frame.current(false)}>Reset view</button>
        </div>
      )}
    </>
  );
}
