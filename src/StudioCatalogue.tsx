import { useEffect, useRef, useState } from "react";
import { db, operation } from "./backend";
import { recolourProductModel, saveProductModel } from "./productModelUpload";
import { ProductMediaPreview } from "./ProductMediaPreview";
import { renderPart, useProductMediaPreview } from "./useProductMediaPreview";
import PreviewColourField from "./PreviewColourField";
import {
  previewColour,
  partLabels,
  modelPartName,
  type PartSelection,
  isColouredMedia,
} from "./previewColour";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CaretDownIcon,
  CubeIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  SlidersHorizontalIcon,
} from "@phosphor-icons/react";
import Product from "./Product";
import {
  catalogFields,
  cataloguePhotos,
  refreshCatalog,
  selectedMedia,
  backendUrl,
  catalogItem,
  type CatalogItem,
  type CatalogRow,
} from "./catalog";
type Row = {
  id: string;
  name: string;
  slug: string;
  description: string;
  status: string;
  sample: boolean;
  featured: boolean;
  category_id: string;
  seo_title: string;
  seo_description: string;
};
type Variant = {
  id: string;
  format: string;
  sku: string;
  price_minor: number;
  available: boolean;
  attributes: { height_mm?: number } & PartSelection;
  digital_assets: { filename: string; version: number }[];
};
type LibraryRow = Row & {
  variants: Pick<Variant, "format" | "attributes">[];
  product_media: {
    kind: string;
    alt: string;
    path: string;
    is_primary: boolean;
    display_order: number;
  }[];
};
function thumbnail(row: LibraryRow) {
  const selection = row.variants.find((v) => v.format === "stl")?.attributes;
  const active = selection?.group_preview ?? selection?.preview_media;
  const path = cataloguePhotos(selectedMedia(row.product_media, active))[0]
    ?.path;
  if (path?.startsWith("/") && !path.startsWith("//")) return path;
  if (row.status === "published" && path && !path.includes(":"))
    return (
      backendUrl +
      "/storage/v1/object/public/product-media/" +
      path.split("/").map(encodeURIComponent).join("/")
    );
}
const empty: Row = {
  id: "",
  name: "",
  slug: "",
  description: "",
  status: "draft",
  sample: false,
  featured: false,
  category_id: "",
  seo_title: "",
  seo_description: "",
};
const fileTypes = {
  photo: {
    label: "Product photo",
    accept: ".jpg,.jpeg,.png,.webp",
    formats: "JPG, PNG or WebP",
  },
  preview: { label: "Custom GLB preview", accept: ".glb", formats: "GLB" },
  stl: { label: "Product model (STL)", accept: ".stl", formats: "STL" },
} as const;
type FileKind = keyof typeof fileTypes;
const catalogueFiles = ["photo", "preview", "stl"] as const;
const draftFileKinds = ["photo", "stl"] as const;
const editionFormats = ["print", "stl"] as const;
const noFiles: { photo: File | null; stl: File[] } = { photo: null, stl: [] };
function fileIssue(file: File, kind: FileKind) {
  if (file.name.trim().length > 160) return "Use a filename of 160 characters or fewer.";
  if (
    !fileTypes[kind].accept
      .split(",")
      .some((ext) => file.name.toLowerCase().endsWith(ext))
  )
    return "Choose a " + fileTypes[kind].formats + " file.";
  if (!file.size || file.size > 25 * 1024 * 1024)
    return "Choose a non-empty file of 25 MiB or less.";
  return "";
}
function checkFile(input: HTMLInputElement, kind: FileKind) {
  const file = input.files?.[0];
  const message = file ? fileIssue(file, kind) : "";
  input.setCustomValidity(message);
  if (message) input.reportValidity();
  return file ?? null;
}
function uploadCatalogueFile(
  id: string,
  file: File,
  fields: {
    alt?: string;
    position?: number;
    primary?: boolean;
  },
  progress: (pct: number) => void,
) {
  return operation(
    {
      action: "admin-file",
      id,
      bucket: "draft-media",
      ...fields,
    },
    [file],
    progress,
  );
}
export default function StudioCatalogue() {
  const client = db!;
  const [rows, rowsSet] = useState<LibraryRow[]>([]),
    [cats, catsSet] = useState<{ id: string; name: string }[]>([]),
    [p, set] = useState<Row>(empty),
    [vars, setVars] = useState<Variant[]>([]);
  const [rev, refresh] = useState(0),
    [msg, feedback] = useState(""),
    [busy, busySet] = useState(false),
    [preview, setPreview] = useState("");
  const [media, setMedia] = useState<
      { id: string; alt: string; kind: string; display_order: number }[]
    >([]),
    [progress, setProgress] = useState(0);
  const [listing, setListing] = useState<CatalogItem>();
  const [editing, setEditing] = useState(false);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [load, setLoad] = useState<"loading" | "ready" | "error">("loading");
  const [partsState, setPartsState] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [dirty, setDirty] = useState(false);
  const [chosenColour, setChosenColour] = useState<string | null>(null);
  const [pickedModels, setPickedModels] = useState<File[]>([]);
  const [partName, setPartName] = useState("");
  const [draftFiles, setDraftFiles] = useState(noFiles);
  const [uploading, setUploading] = useState("");
  const hasDraftFiles = Boolean(draftFiles.photo || draftFiles.stl.length);
  const [panel, setPanel] = useState("Details");
  const editorTitle = useRef<HTMLHeadingElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (editing) editorTitle.current?.focus();
    else opener.current?.focus();
  }, [editing]);
  function openEditor(row: Row, button: HTMLButtonElement) {
    opener.current = button;
    set(row);
    setDirty(false);
    setDraftFiles(noFiles);
    setChosenColour(null);
    setPickedModels([]);
    setPartName("");
    setPreview("");
    setListing(undefined);
    feedback("");
    setPanel("Details");
    setFileKind("stl");
    setEditing(true);
  }
  useEffect(() => {
    setListing(undefined);
    setPreview("");
  }, [p.id]);
  const saved = async (label: string, status: string) =>
    status === "published"
      ? label +
        " " +
        (await operation<{ seo: string }>({ action: "refresh-seo" })).seo
      : label;
  const [fileKind, setFileKind] = useState<FileKind>("photo");
  useEffect(() => {
    let live = true;
    Promise.all([
      client
        .from("products")
        .select(
          "*,variants(format,attributes),product_media(kind,path,alt,is_primary,display_order)",
        )
        .order("display_order")
        .order("slug"),
      client.from("categories").select("id,name").order("name"),
    ]).then(([a, b]) => {
      if (!live) return;
      if (a.error || b.error) {
        setLoad("error");
        feedback("Unable to read the catalog.");
        return;
      }
      setLoad("ready");
      rowsSet(a.data);
      catsSet(b.data);
    });
    return () => {
      live = false;
    };
  }, [client, rev]);
  useEffect(() => {
    let live = true;
    setPartsState("loading");
    if (!editing || !p.id) {
      setVars([]);
      setMedia([]);
      return;
    }
    Promise.all([
      client
        .from("variants")
        .select("*,digital_assets(filename,version)")
        .eq("product_id", p.id),
      client
        .from("product_media")
        .select("id,alt,kind,display_order")
        .eq("product_id", p.id),
    ]).then(([v, m]) => {
      if (live) {
        setVars(v.data ?? []);
        setMedia(m.data ?? []);
        setPartsState(v.error || m.error ? "error" : "ready");
      }
    });
    return () => {
      live = false;
    };
  }, [editing, p.id, client, rev]);
  async function work(f: () => Promise<string>) {
    busySet(true);
    setProgress(0);
    feedback("");
    try {
      feedback(await f());
      refresh((v) => v + 1);
    } catch (e) {
      feedback((e as Error).message || "Unable to save changes.");
    } finally {
      busySet(false);
      setUploading("");
    }
  }
  const setField = (k: keyof Row, v: string | boolean) => {
    setDirty(true);
    set({ ...p, [k]: v });
  };
  const digitalEdition = vars.find((v) => v.format === "stl");
  async function saveEditions(form: FormData) {
    const changes = editionFormats.flatMap((format) => {
      const current = vars.find((edition) => edition.format === format);
      const price = String(form.get(format + "-price") ?? "");
      const sku = String(form.get(format + "-sku") ?? "").trim();
      const available = form.has(format + "-available");
      const height = Number(form.get("height")) || null;
      if (!current && price === "") {
        if (available || sku !== p.slug + "-" + format || (format === "print" && height))
          throw Error("Enter a price for the " + (format === "print" ? "printed" : "STL") + " edition.");
        return [];
      }
      const priceMinor = Math.round(Number(price) * 100);
      const heightChanged = format === "print" && height !== (current?.attributes.height_mm ?? null);
      if (current && priceMinor === current.price_minor && available === current.available &&
          sku === current.sku && !heightChanged) return [];
      return [{ format, sku, price_minor: priceMinor, available, ...(heightChanged ? { height_mm: height } : {}) }];
    });
    if (!changes.length) return "No edition changes to save.";
    const { error } = await client.rpc("save_product_editions", {
      p_product_id: p.id,
      p_editions: changes,
    });
    if (error) throw error;
    if (p.status === "published") await refreshCatalog();
    return saved("Editions saved.", p.status).catch(() => "Editions saved. The search publishing refresh needs a retry.");
  }
  const primaryModel =
    media.find(
      (m) =>
        m.kind === "preview" &&
        m.alt === digitalEdition?.attributes?.preview_media,
    ) ??
    media
      .filter(
        (m) =>
          m.kind === "preview" &&
          !isColouredMedia(m.alt) &&
          / · 3D preview \(v\d+\)$/.test(m.alt),
      )
      .sort((a, b) => a.display_order - b.display_order)[0];
  const labels = partLabels(digitalEdition?.attributes);
  const savedModels = labels.length
    ? labels.flatMap((label) =>
        media.filter((m) => m.kind === "preview" && m.alt === label),
      )
    : primaryModel
      ? [primaryModel]
      : [];
  const savedModel =
    savedModels.find((m) => modelPartName(m.alt) === partName) ?? primaryModel;
  const pendingModels = panel === "Details" ? draftFiles.stl : pickedModels;
  const pickedModel =
    pendingModels.find((f) => f.name === partName) ?? pendingModels[0];
  const savedColour = previewColour(savedModel?.alt ?? "");
  const colour = chosenColour ?? savedColour;
  const uploadAllowed =
    p.status === "draft" && (fileKind !== "stl" || Boolean(digitalEdition));
  const previewSource =
    editing && panel === "Details"
      ? (pickedModel ?? null)
      : editing &&
          panel === "Files" &&
          partsState === "ready" &&
          uploadAllowed &&
          fileKind === "stl"
        ? (pickedModel ?? savedModel?.id ?? null)
        : null;
  const validSource =
    previewSource &&
    typeof previewSource !== "string" &&
    fileIssue(previewSource, "stl")
      ? null
      : previewSource;
  const livePreview = useProductMediaPreview(validSource, colour);
  function pickModels(input: HTMLInputElement, draft: boolean) {
    const next = Array.from(input.files ?? []);
    if (!next.length) return;
    const issue =
      next.map((f) => fileIssue(f, "stl")).find(Boolean) ||
      (new Set(next.map((f) => f.name.trim().toLowerCase())).size !==
      next.length
        ? "Give each part a distinct filename."
        : "");
    input.setCustomValidity(issue || "");
    if (issue) {
      input.reportValidity();
      feedback(issue);
      input.value = "";
      input.setCustomValidity("");
      return;
    }
    feedback("");
    const queued = new Map(
      pendingModels.map((file) => [file.name.trim().toLowerCase(), file]),
    );
    next.forEach((file) => queued.set(file.name.trim().toLowerCase(), file));
    const files = [...queued.values()];
    if (draft) setDraftFiles((previous) => ({ ...previous, stl: files }));
    else setPickedModels(files);
    setPartName(next[0].name);
  }
  async function saveParts(
    productId: string,
    editionId: string,
    files: File[],
    version: number | null,
  ) {
    for (const [index, file] of files.entries()) {
      const stage = (message: string) =>
        modelStage(
          files.length > 1
            ? file.name +
                " (" +
                (index + 1) +
                "/" +
                files.length +
                ") \u00b7 " +
                message
            : message,
        );
      stage("Preparing preview...");
      try {
        const generated =
          file === pickedModel && livePreview.files
            ? livePreview.files
            : await renderPart(file, colour);
        await saveProductModel(
          productId,
          editionId,
          file,
          version,
          generated,
          stage,
          setProgress,
        );
      } catch (e) {
        throw Error(file.name + " - " + (e as Error).message);
      }
    }
  }
  const partOptions = pendingModels.length
    ? pendingModels.map((f) => f.name)
    : savedModels.map((m) => modelPartName(m.alt));
  const colourControls = validSource && (
    <>
      {partOptions.length > 1 && (
        <div>
          <label>
            Preview part
            <select
              value={pickedModel?.name ?? modelPartName(savedModel?.alt ?? "")}
              onChange={(e) => {
                setPartName(e.target.value);
                if (!pendingModels.length) setChosenColour(null);
              }}
            >
              {partOptions.map((name) => (
                <option key={name}>{name}</option>
              ))}
            </select>
          </label>
          {pendingModels.length > 1 && (
            <button
              type="button"
              onClick={() => {
                const remaining = pendingModels.filter(
                  (file) => file !== pickedModel,
                );
                if (panel === "Details")
                  setDraftFiles((previous) => ({
                    ...previous,
                    stl: remaining,
                  }));
                else setPickedModels(remaining);
                setPartName(remaining[0].name);
              }}
            >
              Remove selected part
            </button>
          )}
        </div>
      )}
      <PreviewColourField colour={colour} change={setChosenColour} />
      <ProductMediaPreview
        preview={livePreview}
        colour={colour}
        name={
          partOptions.length > 1
            ? (pickedModel?.name.replace(/\.stl$/i, "") ??
              modelPartName(savedModel?.alt ?? ""))
            : p.name.trim() || "Product model"
        }
        neutralLighting={p.slug === "adiyogi"}
      />
    </>
  );
  function modelStage(message: string) {
    setProgress(0);
    setUploading(message);
  }
  const visible = rows.filter(
    (r) =>
      (filter === "all" || filter === r.status) &&
      (r.name + " " + r.slug)
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  return (
    <section className="desk-catalogue">
      <div hidden={editing}>
        <header className="desk-heading">
          <h2>Catalogue</h2>
          <button
            className="desk-primary"
            disabled={busy || load !== "ready"}
            onClick={(e) => openEditor(empty, e.currentTarget)}
          >
            <PlusIcon aria-hidden />
            New product
          </button>
        </header>
        <div className="desk-toolbar">
          <label className="desk-search">
            <MagnifyingGlassIcon aria-hidden />
            <input
              type="search"
              aria-label="Search products"
              placeholder="Search products"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <select
            aria-label="Filter by publication status"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">All statuses</option>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="archived">Archived</option>
          </select>
        </div>
        {load === "ready" ? (
          <>
            <div
              className="desk-list-head catalogue-columns"
              aria-hidden="true"
            >
              <span>Product · {visible.length}</span>
              <span>Category</span>
              <span>Status</span>
              <span />
            </div>
            <ul className="desk-list">
              {visible.map((row) => {
                const cover = thumbnail(row);
                return (
                  <li key={row.id}>
                    <button
                      className="desk-row catalogue-columns"
                      onClick={(e) => openEditor(row, e.currentTarget)}
                    >
                      <span className="desk-product">
                        <span className="desk-thumb">
                          {cover ? (
                            <img src={cover} alt="" loading="lazy" />
                          ) : (
                            <CubeIcon aria-hidden />
                          )}
                        </span>
                        <span className="desk-row-copy">
                          <strong>{row.name}</strong>
                          <small>
                            {row.sample ? "Sample listing" : "/" + row.slug}
                          </small>
                        </span>
                      </span>
                      <span className="desk-category">
                        {cats.find((cat) => cat.id === row.category_id)?.name}
                      </span>
                      <span className="desk-status" data-state={row.status}>
                        {row.status}
                      </span>
                      <ArrowRightIcon className="desk-arrow" aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>
            {!visible.length && (
              <p className="desk-empty">
                {rows.length
                  ? "No products match these filters."
                  : "Your catalogue is empty. Create a product to start a draft."}
              </p>
            )}
          </>
        ) : (
          <p className="desk-empty" role="status">
            {load === "loading" ? (
              "Loading products…"
            ) : (
              <button onClick={() => refresh((v) => v + 1)}>
                Retry loading products
              </button>
            )}
          </p>
        )}
      </div>
      {editing && (
        <>
          <button
            className="desk-back"
            disabled={busy}
            onClick={() => {
              if (
                (dirty || hasDraftFiles) &&
                !window.confirm(
                  "Discard unsaved product changes and file selections?",
                )
              )
                return;
              setEditing(false);
              setListing(undefined);
              feedback("");
            }}
          >
            <ArrowLeftIcon aria-hidden />
            Catalogue
          </button>
          <header className="desk-heading">
            <h2 ref={editorTitle} tabIndex={-1}>
              {p.id
                ? rows.find((row) => row.id === p.id)?.name || p.name
                : "New product"}
            </h2>
            <span className="desk-status" data-state={p.status}>
              {p.status}
            </span>
          </header>
          {p.id && (
            <div
              className="desk-switch"
              role="group"
              aria-label="Product editor sections"
            >
              {["Details", "Editions", "Files", "Publishing"].map((name) => (
                <button
                  key={name}
                  aria-pressed={panel === name}
                  disabled={busy}
                  onClick={() => setPanel(name)}
                >
                  {name === "Files" ? "Images & 3D files" : name}
                </button>
              ))}
            </div>
          )}
          <div hidden={panel !== "Details"} className="desk-sheet">
            <h3>Product details</h3>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (busy || (draftFiles.stl.length > 0 && !livePreview.files))
                  return;
                const form = e.currentTarget;
                const values = new FormData(form);
                const photoDescription = String(
                  values.get("photoDescription") || "",
                ).trim();
                const draftStlPrice = values.get("draftStlPrice");
                void work(async () => {
                  const { id, status: _, ...fields } = p;
                  const editable = {
                    name: fields.name,
                    description: fields.description,
                    category_id: fields.category_id,
                    featured: fields.featured,
                    seo_title: fields.seo_title,
                    seo_description: fields.seo_description,
                  };
                  const q = id
                    ? client.from("products").update(editable).eq("id", id)
                    : client.from("products").insert({
                        ...editable,
                        slug: p.slug,
                        sample: p.sample,
                      });
                  const res = await q.select("*").single();
                  if (res.error) throw res.error;
                  set(res.data);
                  setDirty(false);
                  if (hasDraftFiles) {
                    for (const kind of draftFileKinds) {
                      const file =
                        kind === "stl" ? draftFiles.stl[0] : draftFiles.photo;
                      if (!file) continue;
                      setUploading("Uploading " + file.name + "…");
                      setProgress(0);
                      try {
                        if (kind === "stl") {
                          if (draftStlPrice !== null) {
                            // A partial-upload retry must retain the existing SKU, price and availability.
                            const edition = await client
                              .from("variants")
                              .upsert(
                                {
                                  product_id: res.data.id,
                                  format: "stl",
                                  sku:
                                    (p.slug.length <= 96
                                      ? p.slug
                                      : res.data.id) + "-stl",
                                  price_minor: Math.round(
                                    Number(draftStlPrice) * 100,
                                  ),
                                  available: false,
                                },
                                {
                                  onConflict: "product_id,format",
                                  ignoreDuplicates: true,
                                },
                              );
                            if (edition.error) throw edition.error;
                          }
                          const edition = await client
                            .from("variants")
                            .select("id")
                            .eq("product_id", res.data.id)
                            .eq("format", "stl")
                            .single();
                          if (edition.error) throw edition.error;
                          await saveParts(
                            res.data.id,
                            edition.data.id,
                            draftFiles.stl,
                            null,
                          );
                        } else {
                          await uploadCatalogueFile(
                            res.data.id,
                            file,
                            {
                              alt: photoDescription || p.name,
                              primary: true,
                              position: 0,
                            },
                            setProgress,
                          );
                        }
                      } catch (error) {
                        refresh((v) => v + 1);
                        throw new Error(
                          "Draft saved. " +
                            file.name +
                            " — " +
                            (error as Error).message,
                        );
                      } finally {
                        setUploading("");
                      }
                      const input = form.elements.namedItem(
                        kind,
                      ) as HTMLInputElement | null;
                      if (input) input.value = "";
                      setDraftFiles((files) =>
                        kind === "stl"
                          ? { ...files, stl: [] }
                          : { ...files, photo: null },
                      );
                    }
                    setFileKind(draftFiles.stl.length ? "stl" : "photo");
                    setPanel("Files");
                    return draftFiles.stl.length
                      ? draftFiles.stl.length === 1
                        ? "Draft saved with two product images, a 3D preview and the private STL."
                        : "Draft saved with " +
                          draftFiles.stl.length +
                          " private STL parts and their previews."
                      : "Draft saved and selected files uploaded.";
                  }
                  return saved("Product saved.", res.data.status);
                });
              }}
            >
              <fieldset
                className="desk-upload-form desk-fields"
                disabled={busy}
                aria-label="Product details"
              >
                <label>
                  Product name
                  <input
                    required
                    maxLength={160}
                    value={p.name}
                    onChange={(e) => setField("name", e.target.value)}
                  />
                </label>
                <label>
                  URL slug
                  <input
                    required
                    disabled={!!p.id}
                    maxLength={100}
                    pattern="[a-z0-9]+(-[a-z0-9]+)*"
                    title="Use lowercase letters, numbers and single hyphens."
                    value={p.slug}
                    onChange={(e) => setField("slug", e.target.value)}
                  />
                </label>
                <label className="desk-span">
                  Description
                  <textarea
                    rows={4}
                    required
                    maxLength={8000}
                    value={p.description}
                    onChange={(e) => setField("description", e.target.value)}
                  />
                </label>
                <label>
                  Category
                  <select
                    required
                    value={p.category_id}
                    onChange={(e) => setField("category_id", e.target.value)}
                  >
                    <option value="">Choose category</option>
                    {cats.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="desk-checks">
                  <label>
                    <input
                      type="checkbox"
                      checked={p.featured}
                      onChange={(e) => setField("featured", e.target.checked)}
                    />{" "}
                    Featured
                  </label>
                </div>
                {!p.id || hasDraftFiles ? (
                  <fieldset
                    className="desk-media-fields desk-span"
                    disabled={busy}
                  >
                    <legend>Images &amp; 3D files</legend>
                    <p>
                      Select one or more STLs. Each file gets its own 3D preview
                      and two product images. All parts belong to one digital
                      edition.
                    </p>
                    <div className="desk-fields">
                      {(["stl", "photo"] as const).map((kind) => (
                        <div key={kind}>
                          <label>
                            {kind === "photo"
                              ? "Custom cover (optional)"
                              : fileTypes[kind].label}
                            <input
                              type="file"
                              name={kind}
                              multiple={kind === "stl"}
                              accept={fileTypes[kind].accept}
                              aria-describedby={"draft-" + kind + "-formats"}
                              onChange={(e) => {
                                if (kind === "stl")
                                  return pickModels(e.currentTarget, true);
                                const file = checkFile(e.currentTarget, kind);
                                setDraftFiles((files) => ({
                                  ...files,
                                  [kind]: file,
                                }));
                              }}
                            />
                            <small id={"draft-" + kind + "-formats"}>
                              {fileTypes[kind].formats} · up to 25 MiB
                            </small>
                          </label>
                          {(kind === "stl"
                            ? draftFiles.stl.length > 0
                            : !!draftFiles.photo) && (
                            <button
                              type="button"
                              className="desk-remove-file"
                              aria-label={
                                "Remove " + fileTypes[kind].label.toLowerCase()
                              }
                              onClick={(e) => {
                                const input =
                                  e.currentTarget.form!.elements.namedItem(
                                    kind,
                                  ) as HTMLInputElement;
                                input.value = "";
                                input.setCustomValidity("");
                                setDraftFiles((files) => ({
                                  ...files,
                                  [kind]: kind === "stl" ? [] : null,
                                }));
                              }}
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      ))}
                      {draftFiles.photo && (
                        <label className="desk-span">
                          Photo description (optional)
                          <input
                            name="photoDescription"
                            maxLength={200}
                            placeholder={p.name}
                          />
                        </label>
                      )}
                      {draftFiles.stl.length > 0 && !digitalEdition && (
                        <label>
                          Digital edition price (₹)
                          <input
                            name="draftStlPrice"
                            type="number"
                            min="0"
                            max="1000000"
                            step="0.01"
                            required
                          />
                          <small>
                            Enable this edition for sale in Editions when it’s
                            ready.
                          </small>
                        </label>
                      )}
                      {panel === "Details" && colourControls}
                    </div>
                  </fieldset>
                ) : (
                  <div className="desk-span">
                    <button type="button" onClick={() => setPanel("Files")}>
                      Manage images &amp; 3D files{" "}
                      <ArrowRightIcon aria-hidden />
                    </button>
                  </div>
                )}
                <details className="desk-disclosure desk-span">
                  <summary>
                    Search appearance
                    <CaretDownIcon aria-hidden />
                  </summary>
                  <div className="desk-fields">
                    <label className="desk-span">
                      SEO title
                      <input
                        maxLength={180}
                        value={p.seo_title || ""}
                        onChange={(e) => setField("seo_title", e.target.value)}
                      />
                    </label>
                    <label className="desk-span">
                      SEO description
                      <textarea
                        rows={2}
                        maxLength={500}
                        value={p.seo_description || ""}
                        onChange={(e) =>
                          setField("seo_description", e.target.value)
                        }
                      />
                    </label>
                  </div>
                </details>
                <div className="desk-actions desk-span">
                  <button
                    className="desk-primary"
                    disabled={
                      busy || (draftFiles.stl.length > 0 && !livePreview.files)
                    }
                  >
                    {hasDraftFiles
                      ? "Save draft and upload files"
                      : "Save product"}
                  </button>
                  {dirty && <small>Unsaved details</small>}
                </div>
              </fieldset>
            </form>
          </div>
          {p.id && (
            <>
              {partsState === "ready" ? (
                <>
                  <section hidden={panel !== "Editions"} className="desk-sheet">
                    <h3>Product editions</h3>
                    <form className="desk-fields" key={p.id + rev} onSubmit={(event) => {
                      event.preventDefault();
                      if (busy) return;
                      const form = new FormData(event.currentTarget);
                      void work(() => saveEditions(form));
                    }}>
                      {editionFormats.map((format) => {
                        const edition = vars.find((v) => v.format === format);
                        const printed = format === "print";
                        const set = labels.length > 1;
                        const title = printed ? (set ? "Printed set" : "Printed object")
                          : (set ? "Downloadable STL set" : "Downloadable STL");
                        return (
                          <fieldset className="desk-edition" key={format} disabled={busy}>
                            <legend>{title}</legend>
                            <label>
                              Price in INR
                              <input type="number" name={format + "-price"} min="0" max="1000000" step=".01"
                                required={!!edition} placeholder="Enter price"
                                defaultValue={edition ? edition.price_minor / 100 : ""} />
                            </label>
                            <label>
                              <input type="checkbox" name={format + "-available"} defaultChecked={edition?.available} />
                              Available
                            </label>
                            <label>
                              SKU
                              <input name={format + "-sku"} required maxLength={100}
                                defaultValue={edition?.sku ?? p.slug + "-" + format} />
                            </label>
                            {printed && (
                              <label>
                                Fixed printed height in mm (optional)
                                <input type="number" min=".1" step=".1" name="height" defaultValue={edition?.attributes.height_mm} />
                              </label>
                            )}
                            {!edition && <small>Enter a price to add this edition.</small>}
                          </fieldset>
                        );
                      })}
                      <div className="desk-actions desk-span">
                        <button type="submit" className="desk-primary" disabled={busy}>
                          {busy ? "Saving…" : "Save editions"}
                        </button>
                      </div>
                    </form>
                  </section>
                  <section hidden={panel !== "Files"} className="desk-sheet">
                    <h3>Images &amp; 3D files</h3>
                    <form
                      className="desk-fields"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const form = e.currentTarget;
                        const f = new FormData(form);
                        if (
                          !uploadAllowed ||
                          busy ||
                          (fileKind === "stl" && !livePreview.files)
                        )
                          return;
                        void work(async () => {
                          const file = f.get("file") as File;
                          if (fileKind === "stl") {
                            if (!pickedModels.length && savedModel) {
                              await recolourProductModel(
                                p.id,
                                digitalEdition!.id,
                                savedModel,
                                livePreview.files!,
                                modelStage,
                                setProgress,
                              );
                              setChosenColour(null);
                              return "Preview colour saved for the 3D model and both product images.";
                            }
                            await saveParts(
                              p.id,
                              digitalEdition!.id,
                              pickedModels,
                              f.get("version")
                                ? Number(f.get("version"))
                                : null,
                            );
                            (
                              form.elements.namedItem(
                                "file",
                              ) as HTMLInputElement
                            ).value = "";
                            setPickedModels([]);
                            setPartName("");
                            setChosenColour(null);
                            return pickedModels.length > 1
                              ? pickedModels.length +
                                  " private STL parts and their previews saved."
                              : "Product images, interactive preview and private STL saved.";
                          }
                          await uploadCatalogueFile(
                            p.id,
                            file,
                            {
                              alt: String(f.get("alt") || p.name),
                              primary: fileKind === "photo" && f.has("primary"),
                              position: Number(f.get("position")),
                            },
                            setProgress,
                          );
                          return "File saved.";
                        });
                      }}
                    >
                      <label>
                        File purpose
                        <select
                          value={fileKind}
                          disabled={busy}
                          onChange={(e) => {
                            setPreview("");
                            setPickedModels([]);
                            setPartName("");
                            setFileKind(e.target.value as FileKind);
                          }}
                        >
                          {catalogueFiles.map((kind) => (
                            <option key={kind} value={kind}>
                              {fileTypes[kind].label}
                            </option>
                          ))}
                        </select>
                      </label>
                      {uploadAllowed ? (
                        <fieldset
                          key={fileKind}
                          disabled={busy}
                          className="desk-upload-form desk-fields desk-span"
                        >
                          <label>
                            Product file
                            <input
                              required={
                                fileKind !== "stl" ||
                                (!savedModel && !pickedModels.length)
                              }
                              aria-label="Product file"
                              name="file"
                              multiple={fileKind === "stl"}
                              type="file"
                              accept={fileTypes[fileKind].accept}
                              aria-describedby="product-upload-formats"
                              onChange={(e) => {
                                if (fileKind === "stl")
                                  pickModels(e.currentTarget, false);
                                else checkFile(e.currentTarget, fileKind);
                              }}
                            />
                            <small id="product-upload-formats">
                              {fileTypes[fileKind].formats} · up to 25 MiB
                            </small>
                          </label>
                          {fileKind !== "stl" ? (
                            <>
                              <label>
                                {fileKind === "photo"
                                  ? "Photo description"
                                  : "Model description"}
                                <input
                                  required
                                  name="alt"
                                  maxLength={200}
                                  defaultValue={p.name}
                                />
                              </label>
                              <label>
                                Display order
                                <input
                                  type="number"
                                  name="position"
                                  defaultValue={0}
                                />
                              </label>
                              {fileKind === "photo" && (
                                <label>
                                  <input type="checkbox" name="primary" />{" "}
                                  Primary photograph
                                </label>
                              )}
                            </>
                          ) : (
                            <>
                              {panel === "Files" && colourControls}
                              {(pickedModel || !savedModel) && (
                                <label>
                                  File version (optional)
                                  <input
                                    name="version"
                                    type="number"
                                    min="1"
                                    max="2147483647"
                                    placeholder="Automatic"
                                  />
                                  <small>
                                    Select multiple STLs to add parts to this
                                    product. Use the same filename to upload a
                                    new version of a part.
                                  </small>
                                </label>
                              )}
                            </>
                          )}
                          <div className="desk-actions desk-span">
                            <button
                              className="desk-primary"
                              disabled={
                                busy ||
                                (fileKind === "stl" && !livePreview.files) ||
                                (fileKind === "stl" &&
                                  !!savedModel &&
                                  !pickedModel &&
                                  savedColour === colour)
                              }
                            >
                              {fileKind === "stl" && savedModel && !pickedModel
                                ? "Apply preview colour"
                                : "Upload file"}
                            </button>
                          </div>
                          {busy && progress > 0 && (
                            <progress
                              aria-label="File upload progress"
                              value={progress}
                              max={100}
                            />
                          )}
                        </fieldset>
                      ) : (
                        <div className="desk-upload-note desk-span">
                          {fileKind === "stl" && p.status === "draft" ? (
                            <>
                              <p>
                                Save a Digital STL edition to attach its
                                protected download.
                              </p>
                              <button
                                type="button"
                                onClick={() => {
                                  setPanel("Editions");
                                }}
                              >
                                Set up digital STL edition{" "}
                                <ArrowRightIcon aria-hidden />
                              </button>
                            </>
                          ) : (
                            <>
                              <p>
                                Return this product to draft to update its
                                images or model. Publish it again when the
                                preview is ready.
                              </p>
                              <button
                                type="button"
                                onClick={() => setPanel("Publishing")}
                              >
                                Open publishing options{" "}
                                <ArrowRightIcon aria-hidden />
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </form>
                    {fileKind === "stl" ? (
                      <div className="desk-file-list">
                        <h4>Customer download files</h4>
                        {digitalEdition?.digital_assets?.length ? (
                          <ul>
                            {digitalEdition.digital_assets.map((asset) => (
                              <li key={asset.filename + "/" + asset.version}>
                                {asset.filename} · v{asset.version}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p>No private STL attached.</p>
                        )}
                      </div>
                    ) : (
                      media
                        .filter((m) => m.kind === fileKind)
                        .map((m) => (
                          <button
                            key={m.id}
                            onClick={() =>
                              work(async () => {
                                const r = await operation<{
                                  signedUrl: string;
                                }>({
                                  action: "preview-media",
                                  id: m.id,
                                });
                                setPreview(r.signedUrl);
                                return "Preview link ready.";
                              })
                            }
                          >
                            Preview {m.kind === "preview" ? "GLB" : "photo"} ·{" "}
                            {m.alt}
                          </button>
                        ))
                    )}
                    {fileKind !== "stl" && preview && (
                      <a href={preview} target="_blank" rel="noreferrer">
                        Open preview
                      </a>
                    )}
                  </section>
                </>
              ) : (
                (panel === "Files" || panel === "Editions") && (
                  <div className="desk-empty" role="status">
                    {partsState === "error" ? (
                      <>
                        Couldn’t load editions and files.
                        <button onClick={() => refresh((v) => v + 1)}>
                          Try again
                        </button>
                      </>
                    ) : (
                      "Loading editions and files…"
                    )}
                  </div>
                )
              )}
              <section hidden={panel !== "Publishing"} className="desk-sheet">
                <h3>Publication</h3>
                <p>
                  {p.status === "published"
                    ? "This product is visible in the store."
                    : "This product is hidden from the store."}
                </p>
                {dirty && (
                  <p>
                    Preview and publication use the last saved product details.
                  </p>
                )}
                <div className="desk-actions">
                  <button
                    disabled={busy}
                    onClick={() =>
                      work(async () => {
                        const result = await client
                          .from("products")
                          .select(catalogFields)
                          .eq("id", p.id)
                          .single();
                        if (result.error) throw result.error;
                        const links = await operation<{
                          urls: Record<string, string>;
                        }>({ action: "preview-listing", id: p.id });
                        setListing(
                          catalogItem(
                            result.data as unknown as CatalogRow,
                            0,
                            (path) =>
                              path.startsWith("/") ? path : links.urls[path],
                          ),
                        );
                        return "Preview of saved listing.";
                      })
                    }
                  >
                    Preview saved listing
                  </button>
                  {["published", "draft", "archived"]
                    .filter((s) => s !== p.status)
                    .map((s) => (
                      <button
                        disabled={busy}
                        key={s}
                        onClick={() =>
                          work(async () => {
                            const r = await operation<{ seo: string }>({
                              action: "publish",
                              id: p.id,
                              status: s,
                            });
                            set({ ...p, status: s });
                            await refreshCatalog();
                            return s + " · " + r.seo;
                          })
                        }
                      >
                        {
                          {
                            published: "Publish product",
                            draft: "Return to draft",
                            archived: "Archive product",
                          }[s]
                        }
                      </button>
                    ))}
                </div>
                {listing && (
                  <div className="desk-preview">
                    <button onClick={() => setListing(undefined)}>
                      Close listing preview
                    </button>
                    <Product
                      key={listing.uid}
                      id={listing.id}
                      preview={listing}
                      digital={false}
                      add={() => {}}
                    />
                  </div>
                )}
              </section>
            </>
          )}
        </>
      )}
      {(!editing || panel === "Details") && (
        <details className="desk-disclosure desk-tools" key={String(editing)}>
          <summary>
            <SlidersHorizontalIcon aria-hidden />
            {editing ? "Manage categories" : "Catalogue tools"}
            <CaretDownIcon aria-hidden />
          </summary>
          <div className="desk-tools-body">
            <form
              className="desk-inline-form"
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const name = new FormData(form).get("category");
                void work(async () => {
                  const result = await client
                    .from("categories")
                    .insert({ name });
                  if (result.error) throw result.error;
                  form.reset();
                  return "Category added.";
                });
              }}
            >
              <label>
                New category
                <input required name="category" maxLength={80} />
              </label>
              <button disabled={busy}>Add category</button>
            </form>
            {!editing && (
              <div className="desk-actions">
                <button
                  disabled={busy}
                  onClick={() =>
                    work(
                      async () =>
                        (
                          await operation<{ seo: string }>({
                            action: "refresh-seo",
                          })
                        ).seo,
                    )
                  }
                >
                  Rebuild public product pages
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    work(
                      async () =>
                        "Unused uploads removed: " +
                        (await operation({ action: "cleanup" })).removed,
                    )
                  }
                >
                  Clean up incomplete uploads
                </button>
              </div>
            )}
          </div>
        </details>
      )}
      <p className="desk-feedback" role="status">
        {uploading || (busy ? "Working…" : msg)}
      </p>
    </section>
  );
}
