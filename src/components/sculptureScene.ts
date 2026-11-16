import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

export type SculptureScene = {
  setColour: (colour?: string) => void;
  setSpinning: (enabled: boolean) => void;
  reset: () => void;
  zoom: (closer: boolean) => void;
  dispose: () => void;
};

export async function createSculptureScene(
  host: HTMLElement,
  signal: AbortSignal,
  onLost: () => void,
  modelUrl: string,
  neutralLighting = false,
): Promise<SculptureScene> {
  const response = await fetch(modelUrl, { signal });
  if (!response.ok) throw new Error("Model unavailable");
  const model = (
    await new GLTFLoader()
      .setMeshoptDecoder(MeshoptDecoder)
      .parseAsync(await response.arrayBuffer(), "")
  ).scene;
  function releaseModel() {
    model.traverse((part) => {
      if (!(part instanceof T.Mesh)) return;
      part.geometry.dispose();
      for (const material of [part.material].flat()) material.dispose();
    });
  }
  let renderer: T.WebGLRenderer;
  try {
    signal.throwIfAborted();
    renderer = new T.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: "low-power",
    });
  } catch (error) {
    releaseModel();
    throw error;
  }

  const canvas = renderer.domElement;
  host.appendChild(canvas);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.78;
  const scene = new T.Scene();
  const box = new T.Box3().setFromObject(model, true);
  const size = box.getSize(new T.Vector3());
  model.position.sub(box.getCenter(new T.Vector3()));
  const pivot = new T.Group();
  pivot.add(model);
  scene.add(pivot);
  const studio = new RoomEnvironment();
  const pmrem = new T.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(studio, 0.04, 0.1, 50, { size: 64 });
  studio.dispose();
  pmrem.dispose();
  scene.environment = environment.texture;
  scene.environmentIntensity = 0.22;
  scene.add(new T.HemisphereLight(neutralLighting ? 0xffffff : 0xfff4df, neutralLighting ? 0x666666 : 0x6e6250, 0.85));
  const keyLight = new T.DirectionalLight(neutralLighting ? 0xffffff : 0xfff2df, 2.35);
  keyLight.position.set(-4, 4, 1.8);
  scene.add(keyLight);
  const rim = new T.DirectionalLight(neutralLighting ? 0xeaf1f5 : 0xff9b45, 3);
  rim.position.set(3, 2, -2);
  scene.add(rim);

  const extent = Math.max(size.x, size.y, size.z);
  const camera = new T.PerspectiveCamera(30, 1, extent * 0.01, extent * 20);
  const controls = new OrbitControls(camera, canvas);
  controls.enablePan = false;
  controls.minPolarAngle = 0.08;
  controls.maxPolarAngle = Math.PI - 0.08;
  const draw = () => renderer.render(scene, camera);
  let spinning = false;
  let inView = false;
  let dragging = false;
  let lastFrame: number | undefined;
  function tick(now: number) {
    if (lastFrame !== undefined) {
      const seconds = Math.min((now - lastFrame) / 1000, 0.1);
      pivot.rotation.y =
        (pivot.rotation.y - (seconds * Math.PI) / 18) % (2 * Math.PI);
      draw();
    }
    lastFrame = now;
  }
  function syncSpin() {
    lastFrame = undefined;
    renderer.setAnimationLoop(
      spinning && inView && !dragging && !document.hidden ? tick : null,
    );
  }
  const visibility = new IntersectionObserver(([entry]) => {
    inView = entry.isIntersecting;
    syncSpin();
  });
  visibility.observe(host);
  document.addEventListener("visibilitychange", syncSpin);
  controls.addEventListener("start", () => {
    dragging = true;
    syncSpin();
  });
  controls.addEventListener("end", () => {
    dragging = false;
    syncSpin();
  });
  const radius = Math.hypot(size.x, size.z) / 2;
  let previousFit = 0;
  const resize = () => {
    const { clientWidth: width, clientHeight: height } = host;
    if (!width || !height) return;
    const aspect = width / height;
    // Allow for the frontmost edge of the pedestal throughout a full revolution.
    const distance =
      radius +
      Math.max(size.y * 0.55, (radius * 1.08) / aspect) /
        Math.tan(T.MathUtils.degToRad(camera.fov / 2));
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    controls.minDistance = distance * 0.45;
    controls.maxDistance = distance * 1.6;
    renderer.setSize(width, height, false);
    if (!previousFit) {
      camera.position.set(0.18, 0.09, 1).normalize().multiplyScalar(distance);
      controls.update();
      controls.saveState();
    } else if (previousFit !== distance) {
      camera.position
        .sub(controls.target)
        .multiplyScalar(distance / previousFit)
        .add(controls.target);
      controls.position0.multiplyScalar(distance / previousFit);
      controls.update();
    }
    previousFit = distance;
    draw();
  };
  const zoom = (closer: boolean) =>
    closer ? controls.dollyIn(0.84) : controls.dollyOut(0.84);
  const reset = () => {
    pivot.rotation.y = 0;
    controls.reset();
    draw();
  };
  const keys = (e: KeyboardEvent) => {
    switch (e.key) {
      case "ArrowLeft":
        controls.rotateLeft(0.16);
        break;
      case "ArrowRight":
        controls.rotateLeft(-0.16);
        break;
      case "ArrowUp":
        controls.rotateUp(0.12);
        break;
      case "ArrowDown":
        controls.rotateUp(-0.12);
        break;
      case "+":
      case "=":
        zoom(true);
        break;
      case "-":
        zoom(false);
        break;
      case "Home":
        reset();
        break;
      default:
        return;
    }
    e.preventDefault();
  };
  host.addEventListener("keydown", keys);
  canvas.addEventListener("webglcontextlost", onLost);
  controls.addEventListener("change", draw);
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();
  const originalColours = new Map<T.Material, T.Color>();
  return {
    setColour(colour) {
      if (!colour && !originalColours.size) return;
      model.traverse((part) => {
        if (!(part instanceof T.Mesh)) return;
        for (const material of [part.material].flat()) {
          if (!(material.color instanceof T.Color)) continue;
          if (!originalColours.has(material)) originalColours.set(material, material.color.clone());
          if (colour) material.color.set(colour);
          else material.color.copy(originalColours.get(material)!);
        }
      });
      draw();
    },
    setSpinning(enabled) {
      spinning = enabled;
      syncSpin();
    },
    reset,
    zoom,
    dispose() {
      renderer.setAnimationLoop(null);
      visibility.disconnect();
      document.removeEventListener("visibilitychange", syncSpin);
      observer.disconnect();
      host.removeEventListener("keydown", keys);
      canvas.removeEventListener("webglcontextlost", onLost);
      controls.dispose();
      releaseModel();
      environment.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
