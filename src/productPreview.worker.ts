import {
  BufferAttribute,
  BufferGeometry,
  Mesh,
  MeshStandardMaterial,
} from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { MeshoptSimplifier } from "meshoptimizer/simplifier";
import { readStlGeometry } from "./printModel";
import { renderProductStill } from "./productStills";

function compactPositions(indices: Uint32Array, positions: Float32Array) {
  const [remap, count] = MeshoptSimplifier.compactMesh(indices);
  const packed = new Float32Array(count * 3);
  for (let i = 0; i < remap.length; i++) {
    const dest = remap[i];
    if (dest === 0xffffffff) continue;
    packed[dest * 3] = positions[i * 3];
    packed[dest * 3 + 1] = positions[i * 3 + 1];
    packed[dest * 3 + 2] = positions[i * 3 + 2];
  }
  return packed;
}

// Work on a display copy. The File selected by the owner is uploaded intact.
async function prepareStl(source: ArrayBuffer) {
  const geometry = readStlGeometry(source);
  const positions = geometry.getAttribute("position").array as Float32Array;
  if (
    !positions.length ||
    positions.length % 9 ||
    !positions.every(Number.isFinite)
  )
    throw Error(
      "The STL contains incomplete triangles or invalid coordinates.",
    );

  await MeshoptSimplifier.ready;
  // Weld the triangle soup before simplifying so adjacent faces stay connected.
  let indices = MeshoptSimplifier.generatePositionRemap(positions, 3);
  let packed = compactPositions(indices, positions);
  const target = Math.min(65000, Math.ceil((indices.length / 3) * 0.45));
  if (indices.length > 1500 * 3) {
    [indices] = MeshoptSimplifier.simplify(
      indices,
      packed,
      3,
      target * 3,
      0.007,
    );
    // Disconnected STL shells can stall the topology-preserving pass.
    if (indices.length > target * 6) {
      const [spatial] = MeshoptSimplifier.simplifySloppy(
        indices,
        packed,
        3,
        null,
        target * 3,
        0.015,
      );
      if (spatial.length) indices = spatial;
    }
    packed = compactPositions(indices, packed);
  }
  if (!indices.length) throw Error("The STL contains no visible surface.");
  const display = new BufferGeometry();
  display.setAttribute("position", new BufferAttribute(packed, 3));
  display.setIndex(
    new BufferAttribute(
      packed.length / 3 <= 65535 ? new Uint16Array(indices) : indices,
      1,
    ),
  );
  display.center();
  display.rotateX(-Math.PI / 2); // STL Z-up to glTF Y-up.
  display.computeBoundingSphere();
  const radius = display.boundingSphere!.radius;
  if (!(radius > 0) || !Number.isFinite(radius))
    throw Error("The STL has no measurable surface.");
  display.scale(1 / radius, 1 / radius, 1 / radius);
  display.computeVertexNormals();
  if (
    !display
      .getAttribute("normal")
      .array.some((n) => n !== 0 && Number.isFinite(n))
  )
    throw Error("The STL contains no visible surface.");
  return display;
}

// A desk preview sends one source, then colours. Keep its prepared mesh in this worker.
let display: BufferGeometry | undefined;
let sha256 = "";
// Storefront GLBs can contain several transformed or quantized meshes.
async function readShopModel(bytes: ArrayBuffer) {
  const { scene } = await new GLTFLoader()
    .setMeshoptDecoder(MeshoptDecoder)
    .parseAsync(bytes, "");
  scene.updateMatrixWorld(true);
  const pieces: BufferGeometry[] = [];
  scene.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    const original = node.geometry as BufferGeometry;
    const piece = new BufferGeometry();
    for (const name of ["position", "normal"]) {
      const attr = original.getAttribute(name);
      if (!attr) continue;
      const floats = new BufferAttribute(new Float32Array(attr.count * 3), 3);
      for (let i = 0; i < attr.count; i++)
        floats.setXYZ(i, attr.getX(i), attr.getY(i), attr.getZ(i));
      piece.setAttribute(name, floats);
    }
    if (!piece.hasAttribute("position")) return;
    const count = piece.getAttribute("position").count;
    piece.setIndex(
      original.index ??
        new BufferAttribute(
          Uint32Array.from({ length: count }, (_, i) => i),
          1,
        ),
    );
    if (!piece.hasAttribute("normal")) piece.computeVertexNormals();
    piece.applyMatrix4(node.matrixWorld);
    pieces.push(piece);
  });
  const geometry =
    pieces.length === 1
      ? pieces[0]
      : pieces.length
        ? mergeGeometries(pieces)
        : null;
  if (!geometry) throw Error("Could not render this model.");
  return geometry;
}
self.onmessage = async ({
  data,
}: MessageEvent<{
  file?: File;
  colour: string;
  savedPreview: boolean;
  photosOnly?: boolean;
}>) => {
  try {
    if (!/^#[0-9a-f]{6}$/.test(data.colour))
      throw Error("Choose a valid preview colour.");
    if (data.file) {
      const source = await data.file.arrayBuffer();
      if (data.photosOnly) {
        display = await readShopModel(source);
      } else if (data.savedPreview) {
        const { scene } = await new GLTFLoader().parseAsync(source, "");
        const mesh = scene.getObjectByProperty("isMesh", true) as
          Mesh | undefined;
        if (!mesh?.geometry.index)
          throw Error("The saved model preview could not be read.");
        display = mesh.geometry;
      } else {
        const digest = await crypto.subtle.digest("SHA-256", source);
        sha256 = Array.from(new Uint8Array(digest), (v) =>
          v.toString(16).padStart(2, "0"),
        ).join("");
        display = await prepareStl(source);
      }
    }
    if (!display) throw Error("Choose a model to preview.");
    const front = await renderProductStill(display, 0, data.colour);
    const threeQuarter = await renderProductStill(display, 38, data.colour);
    if (data.photosOnly) {
      self.postMessage({ front, threeQuarter, colour: data.colour });
      return;
    }
    const mesh = new Mesh(
      display,
      new MeshStandardMaterial({
        color: data.colour,
        roughness: 0.54,
        metalness: 0.12,
      }),
    );
    const buffer = (await new GLTFExporter().parseAsync(mesh, {
      binary: true,
    })) as ArrayBuffer;
    if (buffer.byteLength > 25 * 1024 * 1024)
      throw Error("The generated preview exceeds 25 MiB.");
    self.postMessage(
      { buffer, sha256, front, threeQuarter, colour: data.colour },
      { transfer: [buffer] },
    );
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : "Could not read the STL.",
    });
  }
};
