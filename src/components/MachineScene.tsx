import { useEffect, useRef, useState } from "react";
import {
  PauseIcon,
  PlayIcon,
  ArrowsOutIcon,
  ArrowsInIcon,
  ArrowClockwiseIcon,
} from "@phosphor-icons/react";
import { useReducedMotion } from "motion/react";
import type { MotionValue } from "motion/react";
import type * as Three from "three";
import { createAssembly } from "./assembly";

export default function MachineScene({
  progress,
  focusOnReady = false,
}: {
  progress: MotionValue<number>;
  focusOnReady?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const [paused, setPaused] = useState(false);
  const [exploded, setExploded] = useState(false);
  const [status, setStatus] = useState("loading");
  const controlsRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (focusOnReady && status === "ready")
      controlsRef.current?.focus({ preventScroll: true });
  }, [focusOnReady, status]);
  const params = useRef({
    paused: false,
    reduce: false,
    exploded: false,
    progress: 0,
  });
  const wake = useRef(() => {});
  const rotate = useRef(() => {});
  useEffect(() => {
    params.current = {
      paused,
      reduce: !!reduce,
      exploded,
      progress: progress.get(),
    };
    wake.current();
  }, [paused, reduce, exploded, progress]);
  useEffect(
    () =>
      progress.on("change", (value) => {
        params.current.progress = value;
        wake.current();
      }),
    [progress],
  );
  useEffect(() => {
    const container = host.current;
    if (!container) return;
    let disposed = false;
    let clean: (() => void) | undefined;
    Promise.all([
      import("three"),
      import("three/addons/environments/RoomEnvironment.js"),
    ])
      .then(([T, { RoomEnvironment }]) => {
        if (disposed) return;
        let renderer: Three.WebGLRenderer;
        try {
          renderer = new T.WebGLRenderer({
            alpha: true,
            antialias: true,
            powerPreference: "low-power",
          });
        } catch {
          setStatus("fallback");
          return;
        }
        renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
        renderer.setClearColor(0x000000, 0);
        renderer.toneMapping = T.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 0.9;
        renderer.domElement.setAttribute("aria-hidden", "true");
        container.appendChild(renderer.domElement);
        const scene = new T.Scene();
        const camera = new T.OrthographicCamera(-5, 5, 5, -5, 0.1, 60);
        camera.position.set(0, 0, 15);
        camera.lookAt(0, 0, 0);
        const pmrem = new T.PMREMGenerator(renderer);
        const room = new RoomEnvironment();
        const environment = pmrem.fromScene(room, 0.04).texture;
        scene.environment = environment;
        room.dispose();
        pmrem.dispose();
        scene.add(new T.HemisphereLight(0xe8f0e7, 0x191d19, 0.6));
        const key = new T.DirectionalLight(0xffe2c2, 2.2);
        key.position.set(-4, 5, 6);
        const rim = new T.DirectionalLight(0xe2eeff, 2.3);
        rim.position.set(4, 0, -3);
        scene.add(key, rim);
        const assembly = createAssembly(T);
        scene.add(assembly.group);
        assembly.group.rotation.set(0.68, -0.42, -0.42);
        assembly.group.position.set(0.15, -0.05, 0);
        let frame = 0;
        let last = 0;
        let time = 0;
        let visible = true;
        let dragging = false;
        let pointer = 0;
        let userRotation = 0;
        let smoothRotation = 0;
        let spread = 0;
        function size() {
          const { width, height } = container!.getBoundingClientRect();
          if (!width || !height) return;
          const view = 7.7;
          const aspect = width / height;
          camera.left = (-view * aspect) / 2;
          camera.right = (view * aspect) / 2;
          camera.top = view / 2;
          camera.bottom = -view / 2;
          camera.updateProjectionMatrix();
          renderer.setSize(width, height);
          renderer.render(scene, camera);
        }
        function start() {
          if (!disposed && visible && !document.hidden && !frame)
            frame = requestAnimationFrame(render);
        }
        function render(now: number) {
          frame = 0;
          if (disposed || !visible || document.hidden) return;
          const dt = Math.min((now - last) / 1000, 0.05);
          last = now;
          const p = params.current;
          if (!p.paused && !p.reduce && !dragging) time += dt;
          const sc = p.reduce ? 0 : p.progress;
          const targetSpread = p.exploded ? 1 : sc * 0.8;
          spread = p.reduce
            ? targetSpread
            : spread + (targetSpread - spread) * 0.075;
          smoothRotation += (userRotation - smoothRotation) * 0.14;
          assembly.group.rotation.set(
            0.68 - sc * 0.2,
            -0.42 + Math.sin(time * 0.22) * 0.13 + smoothRotation + sc * 0.35,
            -0.42 - sc * 0.12,
          );
          for (const part of assembly.parts)
            part.position.z =
              part.userData.closed +
              (part.userData.open - part.userData.closed) * spread;
          renderer.render(scene, camera);
          if (
            (!p.paused && !p.reduce) ||
            dragging ||
            Math.abs(spread - targetSpread) > 0.0001 ||
            Math.abs(userRotation - smoothRotation) > 0.0001
          )
            start();
        }
        function down(event: PointerEvent) {
          if (event.pointerType === "touch") return;
          dragging = true;
          pointer = event.clientX;
          container!.setPointerCapture(event.pointerId);
          start();
        }
        function move(event: PointerEvent) {
          if (!dragging) return;
          userRotation += (event.clientX - pointer) * 0.008;
          pointer = event.clientX;
          start();
        }
        function up() {
          dragging = false;
          start();
        }
        function visibility() {
          if (!document.hidden) start();
        }
        const resize = new ResizeObserver(size);
        resize.observe(container);
        const observer = new IntersectionObserver((entries) => {
          visible = entries[0].isIntersecting;
          if (visible) start();
        });
        observer.observe(container);
        container.addEventListener("pointerdown", down);
        container.addEventListener("pointermove", move);
        container.addEventListener("pointerup", up);
        container.addEventListener("lostpointercapture", up);
        document.addEventListener("visibilitychange", visibility);
        wake.current = start;
        rotate.current = () => {
          userRotation += Math.PI / 3;
          start();
        };
        size();
        start();
        setStatus("ready");
        clean = () => {
          cancelAnimationFrame(frame);
          resize.disconnect();
          observer.disconnect();
          container.removeEventListener("pointerdown", down);
          container.removeEventListener("pointermove", move);
          container.removeEventListener("pointerup", up);
          container.removeEventListener("lostpointercapture", up);
          document.removeEventListener("visibilitychange", visibility);
          assembly.dispose();
          environment.dispose();
          renderer.dispose();
          renderer.domElement.remove();
          wake.current = () => {};
          rotate.current = () => {};
        };
      })
      .catch(() => {
        if (!disposed) setStatus("fallback");
      });
    return () => {
      disposed = true;
      clean?.();
    };
  }, []);
  return (
    <div className={`machine-scene ${status}`}>
      <div
        ref={host}
        className="machine-canvas"
        role="img"
        aria-label="Original illustrative assembly of orange and white helical gears."
      />
      {status !== "ready" && (
        <img className="machine-fallback" src="/form-study.jpg" alt="" />
      )}
      <div className="scene-bottom">
        <span>ORIGINAL DIGITAL ASSEMBLY STUDY</span>
        {status === "ready" && (
          <div className="scene-controls">
            <button
              type="button"
              className="explode-control"
              ref={controlsRef}
              aria-pressed={exploded}
              onClick={() => setExploded(!exploded)}
            >
              {exploded ? (
                <ArrowsInIcon size={18} />
              ) : (
                <ArrowsOutIcon size={18} />
              )}
              <span>{exploded ? "Bring together" : "Take it apart"}</span>
            </button>
            <button
              type="button"
              onClick={() => rotate.current()}
              aria-label="Rotate assembly view"
            >
              <ArrowClockwiseIcon size={18} />
            </button>
            {!reduce && (
              <button
                type="button"
                onClick={() => setPaused(!paused)}
                aria-label={
                  paused ? "Play object motion" : "Pause object motion"
                }
              >
                {paused ? <PlayIcon size={17} /> : <PauseIcon size={17} />}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
