import { unzipSync, strFromU8 } from "npm:fflate@0.8.2";

import { Invalid } from "./errors.ts";
export function requireValue(value: unknown, message: string): asserts value {
  if (!value) throw new Invalid(message);
}
export function field(
  value: unknown,
  max: number,
  label: string,
  required = true,
) {
  if (!required && (value == null || value === "")) return "";
  requireValue(
    typeof value === "string" &&
      value.trim().length <= max &&
      (!required || value.trim().length > 0),
    "Invalid " + label,
  );
  return value.trim();
}
export function uuid(value: unknown) {
  requireValue(
    typeof value === "string" &&
      /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value),
    "Invalid record ID",
  );
  return value;
}
export async function digest(bytes: ArrayBuffer | string) {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes,
  );
  return [...new Uint8Array(hash)]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
const mime: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  pdf: "application/pdf",
  glb: "model/gltf-binary",
  stl: "application/octet-stream",
  "3mf": "application/octet-stream",
};
const formats: Record<string, string[]> = {
  "print-uploads": ["stl", "3mf"],
  "studio-files": ["jpg", "jpeg", "png", "pdf"],
  "digital-products": ["stl"],
  "draft-media": ["jpg", "jpeg", "png", "webp", "glb"],
};
export async function inspectFile(
  file: File,
  bucket: string,
  studioDelivery = false,
) {
  const filename = field(file.name, 160, "filename");
  requireValue(!/[\\/\u0000-\u001f]/.test(filename), "Invalid filename");
  const ext = filename.split(".").pop()!.toLowerCase();
  requireValue(
    formats[bucket]?.includes(ext) ||
      (bucket === "studio-files" && studioDelivery && ext === "stl"),
    "Unsupported file format",
  );
  requireValue(
    file.size > 0 &&
      file.size <= (bucket === "studio-files" ? 10 : 25) * 1048576,
    "File exceeds the upload limit",
  );
  const buffer = await file.arrayBuffer(),
    bytes = new Uint8Array(buffer),
    view = new DataView(buffer);
  const text = new TextDecoder(),
    start = text.decode(bytes.subarray(0, 150));
  let valid = false;
  switch (ext) {
    case "png":
      valid =
        bytes.length >= 33 &&
        [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v) &&
        text.decode(bytes.slice(12, 16)) === "IHDR" &&
        view.getUint32(16) > 0 &&
        view.getUint32(20) > 0;
      break;
    case "jpeg":
    case "jpg":
      valid =
        bytes[0] === 255 &&
        bytes[1] === 216 &&
        bytes[2] === 255 &&
        bytes.at(-2) === 255 &&
        bytes.at(-1) === 217;
      break;
    case "webp":
      valid =
        start.startsWith("RIFF") &&
        text.decode(bytes.subarray(8, 12)) === "WEBP" &&
        view.getUint32(4, true) + 8 === bytes.length;
      break;
    case "pdf":
      valid =
        start.startsWith("%PDF-") &&
        text.decode(bytes.slice(-1024)).includes("%%EOF");
      break;
    case "glb": {
      if (
        bytes.length < 24 ||
        !start.startsWith("glTF") ||
        view.getUint32(4, true) !== 2 ||
        view.getUint32(8, true) !== bytes.length ||
        view.getUint32(16, true) !== 0x4e4f534a
      )
        break;
      const size = view.getUint32(12, true);
      if (size > 4 * 1048576 || size > bytes.length - 20) break;
      try {
        const gltf = JSON.parse(text.decode(bytes.slice(20, 20 + size)));
        valid =
          gltf.asset?.version === "2.0" &&
          gltf.meshes?.length > 0 &&
          [...(gltf.buffers ?? []), ...(gltf.images ?? [])].every(
            (x) => !x.uri,
          );
      } catch {
        valid = false;
      }
      break;
    }
    case "stl": {
      if (
        bytes.length >= 84 &&
        view.getUint32(80, true) > 0 &&
        84 + 50 * view.getUint32(80, true) === bytes.length
      ) {
        valid = true;
        break;
      }
      if (start.trimStart().startsWith("solid")) {
        const ascii = text.decode(bytes);
        valid =
          /\bfacet\s+normal\s/.test(ascii) &&
          /\bvertex\s+[-+\d.]/.test(ascii) &&
          /\bendfacet\b/.test(ascii) &&
          /\bendsolid\b/.test(ascii.slice(-300));
      }
      break;
    }
    case "3mf": {
      let expanded = 0,
        entries = 0;
      let contentTypes = false,
        relationships = false;
      try {
        const models = unzipSync(bytes, {
          filter(entry) {
            expanded += entry.originalSize;
            entries++;
            if (
              expanded > 72 * 1048576 ||
              entries > 500 ||
              entry.name.split(/[\\/]/).includes("..")
            )
              throw new Error("Archive limit");
            if (entry.name === "[Content_Types].xml") contentTypes = true;
            if (entry.name === "_rels/.rels") relationships = true;
            return /^3D\/.+\.model$/i.test(entry.name);
          },
        });
        valid =
          contentTypes &&
          relationships &&
          Object.values(models).some((v) => {
            const s = strFromU8(v.subarray(0, 8192));
            const model = s.match(/<(?:[\w.-]+:)?model\b[^>]*>/)?.[0];
            return (
              !!model &&
              /\bxmlns(?::[\w.-]+)?\s*=\s*["']http:\/\/schemas\.microsoft\.com\/3dmanufacturing\/core\/2015\/02["']/.test(
                model,
              )
            );
          });
      } catch {
        valid = false;
      }
      break;
    }
  }
  requireValue(valid, "File contents do not match the selected format");
  return {
    filename,
    bytes: file.size,
    ext,
    mime: mime[ext],
    buffer,
    hash: await digest(buffer),
  };
}
