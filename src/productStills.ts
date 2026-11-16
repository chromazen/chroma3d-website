import type { BufferGeometry } from "three";

// Orthographic catalogue exposures in the conversion worker. A depth buffer also
// renders concavities and overlapping shells on machines without WebGL.
export async function renderProductStill(
  geometry: BufferGeometry,
  yaw: number,
  colour: string,
) {
  const rgb = [1, 3, 5].map((start) =>
    parseInt(colour.slice(start, start + 2), 16),
  );
  // Reuse a shaded palette for every pixel. Dark finishes retain a neutral highlight.
  const palette = new Uint8ClampedArray(256 * 3);
  for (let tone = 0; tone < 256; tone++) {
    for (let ch = 0; ch < 3; ch++) {
      palette[tone * 3 + ch] =
        (tone * rgb[ch]) / 184 +
        Math.max(0, tone - 125) * 0.26 * (1 - rgb[ch] / 255);
    }
  }
  const side = 1200,
    raster = 1800;
  const positions = geometry.getAttribute("position");
  const normals = geometry.getAttribute("normal");
  const indices = geometry.index!;
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const { min, max } = geometry.boundingBox!;
  const width = max.x - min.x,
    height = max.y - min.y,
    length = max.z - min.z;
  // Thin plates can face edge-on in the default STL orientation.
  const sideFacing =
    width < 0.08 * Math.min(height, length) ||
    length > 6 * Math.max(width, height);
  const flat = height < 0.08 * Math.min(width, length);
  const angle = ((yaw + (sideFacing ? 90 : 0)) * Math.PI) / 180;
  const elevation = flat ? (yaw ? 40 : 80) : yaw ? 12 : 5;
  const pitch = (elevation * Math.PI) / 180;
  const c = Math.cos(angle),
    s = Math.sin(angle),
    up = Math.sin(pitch),
    forward = Math.cos(pitch);
  const vertices = new Float32Array(positions.count * 4);
  let left = Infinity,
    right = -Infinity,
    top = Infinity,
    bottom = -Infinity;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i),
      y = positions.getY(i),
      z = positions.getZ(i);
    const horizontal = s * x + c * z;
    const vx = c * x - s * z,
      vy = -forward * y + up * horizontal;
    left = Math.min(left, vx);
    right = Math.max(right, vx);
    top = Math.min(top, vy);
    bottom = Math.max(bottom, vy);
    const nx = normals.getX(i),
      ny = normals.getY(i),
      nz = normals.getZ(i);
    const h = s * nx + c * nz;
    const a = c * nx - s * nz,
      b = forward * ny - up * h,
      v = forward * h + up * ny;
    // Broad upper-left key, soft fill and a narrower rim on the far shoulder.
    const key = Math.max(0, -0.54 * a + 0.68 * b + 0.49 * v);
    const rim = Math.max(0, 0.81 * a + 0.35 * b - 0.47 * v);
    const sheen = Math.pow(Math.max(0, -0.31 * a + 0.4 * b + 0.86 * v), 18);
    const k = i * 4;
    vertices[k] = vx;
    vertices[k + 1] = vy;
    vertices[k + 2] = forward * horizontal + up * y;
    vertices[k + 3] = 43 + 132 * key + 34 * rim + 25 * sheen + 12 * (b + 1);
  }
  const scale = (raster * 0.86) / Math.max(right - left, bottom - top);
  const cx = (left + right) / 2,
    cy = (top + bottom) / 2;
  for (let i = 0; i < vertices.length; i += 4) {
    vertices[i] = raster / 2 + (vertices[i] - cx) * scale;
    vertices[i + 1] = raster / 2 + (vertices[i + 1] - cy) * scale;
  }
  const surface = new OffscreenCanvas(raster, raster);
  const ctx = surface.getContext("2d");
  if (!ctx) throw Error("The browser could not create a product image.");
  const image = ctx.createImageData(raster, raster);
  const depth = new Float32Array(raster * raster).fill(-Infinity);
  for (let i = 0; i < indices.count; i += 3) {
    const p = indices.getX(i) * 4,
      q = indices.getX(i + 1) * 4,
      r = indices.getX(i + 2) * 4;
    const x = vertices[p],
      y = vertices[p + 1];
    const dx1 = vertices[q] - x,
      dy1 = vertices[q + 1] - y;
    const dx2 = vertices[r] - x,
      dy2 = vertices[r + 1] - y;
    const det = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(det) < 1e-6) continue;
    const minX = Math.max(0, Math.floor(Math.min(x, vertices[q], vertices[r])));
    const maxX = Math.min(
      raster - 1,
      Math.ceil(Math.max(x, vertices[q], vertices[r])),
    );
    const minY = Math.max(
      0,
      Math.floor(Math.min(y, vertices[q + 1], vertices[r + 1])),
    );
    const maxY = Math.min(
      raster - 1,
      Math.ceil(Math.max(y, vertices[q + 1], vertices[r + 1])),
    );
    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const sx = px + 0.5 - x,
          sy = py + 0.5 - y;
        const u = (sx * dy2 - sy * dx2) / det,
          v = (sy * dx1 - sx * dy1) / det;
        if (u < 0 || v < 0 || u + v > 1) continue;
        const w = 1 - u - v,
          pixel = py * raster + px;
        const z =
          w * vertices[p + 2] + u * vertices[q + 2] + v * vertices[r + 2];
        if (z <= depth[pixel]) continue;
        depth[pixel] = z;
        const tone =
          w * vertices[p + 3] + u * vertices[q + 3] + v * vertices[r + 3];
        const offset = pixel * 4;
        const shade = Math.min(255, Math.round(tone)) * 3;
        image.data[offset] = palette[shade];
        image.data[offset + 1] = palette[shade + 1];
        image.data[offset + 2] = palette[shade + 2];
        image.data[offset + 3] = 255;
      }
    }
  }
  ctx.putImageData(image, 0, 0);
  const output = new OffscreenCanvas(side, side);
  const downsample = output.getContext("2d")!;
  downsample.imageSmoothingQuality = "high";
  downsample.drawImage(surface, 0, 0, side, side);
  const blob = await output.convertToBlob({
    type: "image/webp",
    quality: 0.94,
  });
  const extension = blob.type === "image/webp" ? "webp" : "png";
  return new File([blob], (yaw ? "three-quarter." : "front.") + extension, {
    type: blob.type,
  });
}
