import * as T from "three";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { ThreeMFLoader } from "three/addons/loaders/3MFLoader.js";
import { unzipSync } from "three/addons/libs/fflate.module.js";

export const GUIDE_MM = 250;
export const MAX_MM = 256;

export type Inspection = {
  valid: boolean;
  message: string;
  dimensions?: string;
  beyondMax?: boolean;
};
// Check the ZIP directory before handing a 3MF archive to the decompressor.
function checkArchive(buffer: ArrayBuffer) {
  const v = new DataView(buffer);
  let end = buffer.byteLength - 22;
  for (; end >= Math.max(0, buffer.byteLength - 65557); end--)
    if (v.getUint32(end, true) === 0x06054b50) break;
  if (end < 0 || v.getUint32(end, true) !== 0x06054b50)
    throw Error("This is not a readable 3MF archive.");
  const count = v.getUint16(end + 10, true);
  let offset = v.getUint32(end + 16, true),
    expanded = 0;
  if (count > 500)
    throw Error("This 3MF has too many embedded files to preview.");
  for (let i = 0; i < count; i++) {
    if (
      offset + 46 > buffer.byteLength ||
      v.getUint32(offset, true) !== 0x02014b50
    )
      throw Error("The 3MF directory is damaged.");
    const nameLength = v.getUint16(offset + 28, true),
      size = v.getUint32(offset + 24, true),
      start = v.getUint32(offset + 42, true);
    if (
      start + 30 > buffer.byteLength ||
      v.getUint32(start, true) !== 0x04034b50
    )
      throw Error("The 3MF entry is invalid.");
    expanded += Math.max(size, v.getUint32(start + 22, true));
    offset +=
      46 +
      nameLength +
      v.getUint16(offset + 30, true) +
      v.getUint16(offset + 32, true);
    if (expanded > 80 * 1024 * 1024)
      throw Error(
        "This 3MF is too large after unpacking. Export a smaller model.",
      );
  }
}

// The Three.js loader reads vertex coordinates without applying the 3MF unit.
function threeMFScale(data: ArrayBuffer) {
  const factors: Record<string, number> = {
    micron: 0.001,
    millimeter: 1,
    centimeter: 10,
    inch: 25.4,
    foot: 304.8,
    meter: 1000,
  };
  const parts = unzipSync(new Uint8Array(data), {
    filter: (entry) => /\.model$/i.test(entry.name),
  });
  const units = new Set<string>();
  for (const bytes of Object.values(parts)) {
    const header = new TextDecoder()
      .decode(bytes.subarray(0, 65536))
      .replace(/<!--[\s\S]*?-->/g, "");
    const tag = header.match(/<model\b[^>]*>/i)?.[0];
    if (!tag) throw Error("Could not read the 3MF model units.");
    const unit =
      tag.match(/\sunit\s*=\s*["']([^"']+)["']/i)?.[1] ?? "millimeter";
    if (!Object.hasOwn(factors, unit))
      throw Error("Unsupported 3MF unit. Export the model in millimetres.");
    units.add(unit);
  }
  if (units.size !== 1)
    throw Error("For a scaled preview, export all 3MF parts in the same unit.");
  return factors[[...units][0]];
}

export function readStlGeometry(data: ArrayBuffer) {
  if (data.byteLength < 84) throw Error("This STL is empty or incomplete.");
  const triangles = new DataView(data).getUint32(80, true);
  const loader = new STLLoader();
  if (triangles && 84 + triangles * 50 === data.byteLength) return loader.parse(data);
  const decoder = new TextDecoder();
  const header = decoder.decode(data.slice(0, 150)).trimStart();
  if (!header.startsWith("solid") || header.includes("\0"))
    throw Error("The binary STL has an invalid triangle count.");
  const ascii = decoder.decode(data).trimStart();
  if (ascii.length < 84) throw Error("This ASCII STL is incomplete.");
  return loader.parse(ascii);
}

function readSTL(data: ArrayBuffer) {
  return new T.Mesh(
    readStlGeometry(data),
    new T.MeshStandardMaterial({
      color: 0xcaa17a,
      roughness: 0.66,
      side: T.DoubleSide,
    }),
  );
}

export function disposeModel(object: T.Object3D) {
  object.traverse((part) => {
    if (!(part instanceof T.Mesh)) return;
    part.geometry.dispose();
    for (const material of [part.material].flat()) {
      for (const value of Object.values(material))
        if (value instanceof T.Texture) value.dispose();
      material.dispose();
    }
  });
}

export function readPrintModel(data: ArrayBuffer, name: string) {
  const is3MF = name.toLowerCase().endsWith(".3mf");
  let scale = 1;
  if (is3MF) {
    checkArchive(data);
    scale = threeMFScale(data);
  }
  const object = is3MF ? new ThreeMFLoader().parse(data) : readSTL(data);
  const box = new T.Box3().setFromObject(object, true);
  const size = box.getSize(new T.Vector3()).multiplyScalar(scale);
  const axes = size.toArray();
  if (box.isEmpty() || !axes.every(Number.isFinite) || Math.max(...axes) <= 0) {
    disposeModel(object);
    throw Error("The file contains no measurable geometry.");
  }
  // The file is Z-up. Centre it on the bed and put its lowest vertex at Y = 0.
  const center = box.getCenter(new T.Vector3()).multiplyScalar(scale);
  const model = new T.Group();
  model.add(object);
  model.scale.setScalar(scale);
  model.rotation.x = -Math.PI / 2;
  model.position.set(-center.x, -box.min.z * scale, center.y);
  const longest = Math.max(...axes);
  const beyondMax = longest > MAX_MM + 0.00001;
  const fit = beyondMax
    ? "Exceeds the 256 mm maximum in this orientation. Request a quote for alternatives."
    : longest > GUIDE_MM + 0.00001
      ? "Outside the 250 mm guide, within the 256 mm maximum. Clearance needs review."
      : "Inside the 250 mm guide in this orientation.";
  const report: Inspection = {
    valid: true,
    dimensions: axes.map((n) => Number(n.toFixed(2))).join(" × ") + " mm",
    beyondMax,
    message: (is3MF ? "" : "STL units assumed to be millimetres. ") + fit,
  };
  return { model, report };
}
