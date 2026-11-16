import { useSyncExternalStore } from "react";
import { collection } from "./collection";
import { basePreviewLabel, isColouredMedia, modelPartName, partLabels, previewColour, type PartSelection } from "./previewColour";

export type Variant = {
  id: string;
  price_minor: number;
  format: "print" | "stl";
  available: boolean;
  attributes: { height_mm?: number } & PartSelection;
};
export type CatalogItem = Omit<(typeof collection)[number], "modelUrl"> & {
  parts?: { name: string; modelUrl: string; gallery: { src: string; label: string }[] }[];
  groupPreview?: boolean;
  defaultColour?: string;
  modelUrl: string;
  uid: string;
  sample: boolean;
  featured: boolean;
  category: string;
  seoTitle?: string;
  seoDescription?: string;
  variants: Variant[];
};
export const backendUrl = import.meta.env.VITE_SUPABASE_URL || "";
export const publishableKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
export const connected = !!backendUrl && !!publishableKey;

type MediaRow = {
  kind: string;
  path: string;
  alt: string;
  display_order: number;
  is_primary: boolean;
};
export function renderAlt(previewAlt: string, view: "Front" | "Three-quarter") {
  return previewAlt.replace(/ · 3D preview (?=\(v\d+\)(?:#[0-9a-f]{6})?$)/, " · " + view + " render ");
}
// Colour changes become visible together after all three derivatives have been saved.
export function selectedMedia<T extends { kind: string; alt: string }>(media: T[], active?: string): T[] {
  if (!active) return media.filter(m => !isColouredMedia(m.alt));
  const selected = new Set([active, renderAlt(active, "Front"), renderAlt(active, "Three-quarter")]);
  if (!media.some(m => m.kind === "preview" && m.alt === active)) return media.filter(m => !isColouredMedia(m.alt));
  return media.flatMap(m => {
    if (selected.has(m.alt)) return [{ ...m, alt: basePreviewLabel(m.alt) }];
    if (m.kind === "preview" || isColouredMedia(m.alt) || / · (Front|Three-quarter) render \(v\d+\)$/.test(m.alt)) return [];
    return [m];
  });
}
function renderView(photo: MediaRow) {
  return photo.display_order < 0 ? photo.alt.match(/ · (Front|Three-quarter) render \(v\d+\)$/)?.[1] : undefined;
}

// Keep custom photography and show the most recent complete pair of model renders.
export function cataloguePhotos<T extends MediaRow>(media: T[]): T[] {
  const photos = media.filter(m => m.kind === "photo").sort((a,b) =>
    Number(b.is_primary) - Number(a.is_primary) || a.display_order - b.display_order);
  const manual = photos.filter(m => !renderView(m));
  for (const preview of media.filter(m => m.kind === "preview" && / · 3D preview \(v\d+\)$/.test(m.alt))
    .sort((a,b) => a.display_order - b.display_order || a.path.localeCompare(b.path))) {
    const front = photos.find(m => m.display_order === preview.display_order && m.alt === renderAlt(preview.alt, "Front"));
    const angle = photos.find(m => m.display_order === preview.display_order && m.alt === renderAlt(preview.alt, "Three-quarter"));
    if (front && angle) return [
      ...manual.filter(m => m.is_primary), front, angle, ...manual.filter(m => !m.is_primary),
    ];
  }
  return photos;
}
export type CatalogRow = {
  id: string;
  slug: string;
  name: string;
  description: string;
  sample: boolean;
  featured: boolean;
  display_order: number;
  seo_title: string;
  seo_description: string;
  categories: { name: string };
  variants: Variant[];
  product_media: MediaRow[];
};
export const catalogFields =
  "id,slug,name,description,sample,featured,display_order,seo_title,seo_description,categories(name),variants(id,format,price_minor,available,attributes),product_media(kind,path,alt,display_order,is_primary)";
export async function fetchCatalog(
  url: string,
  key: string,
): Promise<CatalogItem[]> {
  const query = new URLSearchParams({
    select: catalogFields,
    status: "eq.published",
    sample: "eq.false",
    order: "featured.desc,display_order.asc,slug.asc",
  });
  const rows: CatalogRow[] = [];
  for (let start = 0; ; start += 200) {
    const response = await fetch(
      url + "/rest/v1/products?" + query + "&limit=200&offset=" + start,
      { headers: { apikey: key } },
    );
    if (!response.ok) throw Error("The studio catalogue could not be loaded.");
    const page: CatalogRow[] = await response.json();
    rows.push(...page);
    if (page.length < 200) break;
  }
  const asset = (path: string) =>
    path.startsWith("/")
      ? path
      : url + "/storage/v1/object/public/product-media/" + path;
  return rows.map((row, i) => catalogItem(row, i, asset));
}
export function catalogItem(
  row: CatalogRow,
  i: number,
  asset: (path: string) => string,
): CatalogItem {
  const selection = row.variants.find(v => v.format === "stl")?.attributes;
  const group = selection?.group_preview;
  const groupModel = group && row.product_media.find(m => m.kind === "preview" && m.alt === group);
  const groupPreview = !!groupModel && (["Front", "Three-quarter"] as const).every(view =>
    row.product_media.some(m => m.kind === "photo" && m.alt === renderAlt(groupModel.alt, view) && m.display_order === groupModel.display_order));
  const media = selectedMedia(row.product_media, groupPreview ? group : selection?.preview_media);
  const photos = cataloguePhotos(media);
  const gallery = photos.map((x) => {
    const view = renderView(x);
    return { src: asset(x.path), label: view ? view + " view · Model render" : x.alt };
  }),
    model = media.filter((x) => x.kind === "preview")
      .sort((a, b) => a.display_order - b.display_order || a.path.localeCompare(b.path))[0];
  return {
    id: row.slug,
    uid: row.id,
    name: row.name,
    description: row.description,
    number: String(i + 1).padStart(2, "0"),
    cover: gallery[0]?.src ?? "",
    image: gallery[0]?.src ?? "",
    gallery,
    groupPreview,
    defaultColour: groupPreview ? previewColour(group!) : undefined,
    parts: partLabels(selection).flatMap(label => {
      const model = row.product_media.find(m => m.kind === "preview" && m.alt === label);
      if (!model) return [];
      const views = (["Front", "Three-quarter"] as const).flatMap(view => {
        const photo = row.product_media.find(m => m.kind === "photo" && m.alt === renderAlt(label, view) && m.display_order === model.display_order);
        return photo ? [{ src: asset(photo.path), label: view + " view · Model render" }] : [];
      });
      return [{ name: modelPartName(label), modelUrl: asset(model.path), gallery: views }];
    }),
    modelUrl: model ? asset(model.path) : "",
    neutralLighting: row.slug === "adiyogi" || groupPreview,
    category: row.categories.name,
    caption: row.categories.name,
    sample: row.sample,
    featured: row.featured,
    seoTitle: row.seo_title,
    seoDescription: row.seo_description,
    variants: row.variants,
    printed:
      (row.variants.find((x) => x.format === "print")?.price_minor ?? 0) / 100,
    digital:
      (row.variants.find((x) => x.format === "stl")?.price_minor ?? 0) / 100,
  };
}
const initial =
  typeof document !== "undefined"
    ? document.getElementById("catalog-data")?.textContent
    : null;
let state: { items: CatalogItem[]; error: string; loading: boolean } = {
  items: initial ? JSON.parse(initial) : [],
  error: "",
  loading: connected && !initial,
};
const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};
export const catalogState = () => state;
export function setCatalog(items: CatalogItem[]) {
  state = { items, error: "", loading: false };
  listeners.forEach((cb) => cb());
}
export function useCatalog() {
  return useSyncExternalStore(subscribe, catalogState, catalogState);
}
export async function refreshCatalog() {
  if (!connected) return;
  try {
    setCatalog(await fetchCatalog(backendUrl, publishableKey));
  } catch {
    state = {
      ...state,
      error:
        "Catalogue refresh failed. Retry to check prices and availability.",
      loading: false,
    };
    listeners.forEach((cb) => cb());
  }
}
