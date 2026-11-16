import { db, operation } from "./backend";
import { renderAlt } from "./catalog";
import {
  basePreviewLabel,
  modelPartName,
  partLabels,
  studioNeutral,
} from "./previewColour";

export type PreviewFiles = {
  file: File;
  front: File;
  threeQuarter: File;
  sha256: string;
  colour: string;
};

export async function saveProductModel(
  productId: string,
  editionId: string,
  original: File,
  requestedVersion: number | null,
  preview: PreviewFiles,
  stage: (message: string) => void,
  progress: (pct: number) => void,
) {
  const filename = original.name.trim();
  const client = db!;
  const assets = await client
    .from("digital_assets")
    .select("filename,version,sha256")
    .eq("variant_id", editionId);
  if (assets.error) throw assets.error;
  if (
    assets.data.some(
      (a) =>
        a.filename !== filename &&
        a.filename.toLowerCase() === filename.toLowerCase(),
    )
  )
    throw Error(
      "Use the existing part’s exact filename to upload a new version.",
    );
  const versions = assets.data.filter((a) => a.filename === filename);
  const latest = versions.sort((a, b) => b.version - a.version)[0];
  const version =
    requestedVersion ??
    (latest?.sha256 === preview.sha256
      ? latest.version
      : (latest?.version ?? 0) + 1);
  const existing = versions.find(
    (a) => a.version === version && a.filename === filename,
  );
  if (versions.some((a) => a.version > version))
    throw Error(
      "A newer version of " +
        filename +
        " is already attached. Choose a newer version.",
    );
  if (existing && existing.sha256 !== preview.sha256)
    throw Error(
      "That version already has a different STL. Choose a new version.",
    );
  if (!existing) {
    stage("Saving private STL…");
    await operation(
      {
        action: "admin-file",
        id: editionId,
        bucket: "digital-products",
        version,
      },
      [original],
      progress,
    );
  }

  const alt =
    filename.replace(/\.stl$/i, "") + " · 3D preview (v" + version + ")";
  await savePresentation(
    productId,
    editionId,
    alt,
    -version,
    preview,
    stage,
    progress,
  );
}

export function recolourProductModel(
  productId: string,
  editionId: string,
  model: { id: string; alt: string; display_order: number },
  preview: PreviewFiles,
  stage: (message: string) => void,
  progress: (pct: number) => void,
) {
  return savePresentation(
    productId,
    editionId,
    basePreviewLabel(model.alt),
    model.display_order,
    preview,
    stage,
    progress,
  );
}

async function savePresentation(
  productId: string,
  editionId: string,
  baseAlt: string,
  position: number,
  preview: PreviewFiles,
  stage: (message: string) => void,
  progress: (pct: number) => void,
) {
  const client = db!;
  try {
    const media = await client
      .from("product_media")
      .select("kind,alt,display_order,is_primary")
      .eq("product_id", productId);
    if (media.error) throw media.error;
    // Existing uncoloured previews were generated with the studio-neutral material.
    const alt =
      preview.colour === studioNeutral &&
      media.data.some((m) => m.kind === "preview" && m.alt === baseAlt)
        ? baseAlt
        : baseAlt + preview.colour;
    const outputs = [
      {
        key: "file",
        kind: "preview",
        label: alt,
        status: "Saving interactive preview…",
      },
      {
        key: "front",
        kind: "photo",
        label: renderAlt(alt, "Front"),
        status: "Saving front view…",
      },
      {
        key: "threeQuarter",
        kind: "photo",
        label: renderAlt(alt, "Three-quarter"),
        status: "Saving three-quarter view…",
      },
    ] as const;
    for (const output of outputs) {
      if (
        media.data.some(
          (m) =>
            m.kind === output.kind &&
            m.alt === output.label &&
            m.display_order === position,
        )
      )
        continue;
      stage(output.status);
      await operation(
        {
          action: "admin-file",
          id: productId,
          bucket: "draft-media",
          alt: output.label,
          position,
          primary:
            output.key === "front" && !media.data.some((m) => m.is_primary),
        },
        [preview[output.key]],
        progress,
      );
    }
    // Select a complete set in one write. Retrying or switching back reuses saved assets.
    const edition = await client
      .from("variants")
      .select("attributes")
      .eq("id", editionId)
      .single();
    if (edition.error) throw edition.error;
    const attrs = edition.data.attributes;
    const parts = partLabels(attrs);
    if (!parts.length) {
      const legacy = media.data
        .filter(
          (m) => m.kind === "preview" && / · 3D preview \(v\d+\)$/.test(m.alt),
        )
        .sort((a, b) => a.display_order - b.display_order)[0];
      if (legacy) parts.push(legacy.alt);
    }
    const index = parts.findIndex(
      (label) => modelPartName(label) === modelPartName(alt),
    );
    if (index < 0) parts.push(alt);
    else parts[index] = alt;
    if (
      attrs.preview_media !== parts[0] ||
      (parts.length > 1 &&
        JSON.stringify(attrs.preview_parts) !== JSON.stringify(parts))
    ) {
      const result = await client
        .from("variants")
        .update({
          attributes: {
            ...attrs,
            preview_media: parts[0],
            ...(parts.length > 1 ? { preview_parts: parts } : {}),
          },
        })
        .eq("id", editionId)
        .eq("attributes", JSON.stringify(attrs))
        .select("id")
        .maybeSingle();
      if (result.error) throw result.error;
      if (!result.data)
        throw Error("The edition changed while saving. Try again.");
    }
  } catch (error) {
    throw Error(
      "Private STL saved. Retry to finish the product media. " +
        (error && typeof error === "object" && "message" in error
          ? error.message
          : ""),
    );
  }
}
