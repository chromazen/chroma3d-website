import { useRef, useState } from "react";
import { ArrowUpRightIcon, CubeIcon } from "@phosphor-icons/react";
import {useCatalog,type CatalogItem} from "./catalog";
import { collection as studioObjects, rupees, navigate } from "./collection";
import type { CartLine, Format } from "./collection";
import SculptureViewer from "./components/SculptureViewer";
import PreviewColourField from "./PreviewColourField";
import { previewColours } from "./previewColour";
import { useProductMediaPreview } from "./useProductMediaPreview";

export default function Product({
  id,
  digital,
  add,
  preview,
}: {
  id: string;
  digital: boolean;
  add: (line: CartLine) => void;
  preview?: CatalogItem;
}) {
  const {items:collection,error,loading}=useCatalog();
  const item = preview || collection.find((p) => p.id === id);
  const [preferred, setFormat] = useState<Format>(
    digital ? "STL file" : "Printed piece",
  );
  const [qty, setQty] = useState(1);
  const [finish, setFinish] = useState("As printed");
  const [view, setView] = useState(0);
  const [details, setDetails] = useState("The object");
  const [partName, setPart] = useState("");
  const [chosenColour, setColour] = useState("");
  const frontThumb = useRef<HTMLImageElement>(null);
  const parts = item?.parts ?? [];
  const part = parts.find(p => p.name === partName) ?? (item?.groupPreview ? undefined : parts[0]);
  const colour = chosenColour || item?.defaultColour || "";
  const recoloured = !!colour && colour !== item?.defaultColour;
  const modelUrl = part?.modelUrl || item?.modelUrl || "";
  const proof = useProductMediaPreview(recoloured && modelUrl ? modelUrl : null, colour, true);
  if (!item && (error || loading)) return <main id="main" className="wrap page" role="status">{error || "Loading object…"}</main>;
  if (!item)
    return (
      <main id="main" className="page wrap">
        <h1>Piece unavailable</h1>
        <a className="inline-link" href="/shop">
          Return to store
        </a>
      </main>
    );
  const variant=item.variants.find(v=>v.format===(preferred==="Printed piece"?"print":"stl")) || item.variants[0];
  const physical=variant?.format==="print";
  const format:Format=physical?"Printed piece":"STL file";
  const price = physical ? item.printed : item.digital;
  const originalGallery = part && (item.groupPreview || part !== parts[0]) ? part.gallery : item.gallery;
  const rendered = proof.rendered?.colour === colour ? proof.rendered : undefined;
  const studioRenders = studioObjects.find(p => p.modelUrl === modelUrl)?.gallery.filter(photo => photo.label !== "Print photo");
  const gallery = recoloured ? [
    {src:rendered?.front ?? "", label:"Front view · Model render"},
    {src:rendered?.threeQuarter ?? "", label:"Three-quarter view · Model render"},
    ...originalGallery.filter(photo => !part?.gallery.some(g => g.src === photo.src) &&
      !photo.label.endsWith(" view · Model render") && !studioRenders?.some(g => g.src === photo.src)),
  ] : originalGallery;
  const image = view === -1 ? undefined : gallery[view] ?? gallery[0];
  const modelName = part && parts.length > 1 ? item.name + " · " + part.name : item.name;
  function chooseColour(value: string) {
    if (view !== -1 && (!colour || !value || view > 1))
      setView(/three-quarter/i.test(image?.label ?? "") && value ? 1 : 0);
    setColour(value);
  }
  const validQty =
    !physical || (Number.isInteger(qty) && qty > 0 && qty <= 100000);

  const Container=preview?"section":"main";
  return (
    <Container className="wrap product-page" id={preview?undefined:"main"}>
      <p className="product-crumb">
        <a href="/shop">Store</a>
        <span>/</span>{item.category}<span>/</span>
        {item.name}
      </p>
      <div className="product-layout">
        <div className="product-gallery">
          {parts.length > 1 && <label className="product-part-picker">View a part
            <select value={part?.name ?? ""} onChange={e => {setPart(e.target.value); setView(view > 1 ? 0 : view);}}>
              {item.groupPreview && <option value="">Complete set ({parts.length} figures)</option>}
              {parts.map(p => <option key={p.name}>{p.name}</option>)}
            </select>
          </label>}
          <div className="product-stage">
            {image ? (
              <figure className="product-image" key={image.src}>
                {image.src ? <img src={image.src} alt={modelName + " · " + image.label} /> :
                  <div className="product-render-status" role="status">{proof.error ?
                    <>{proof.error} <button type="button" onClick={proof.retry}>Retry images</button></> : "Rendering this colour…"}</div>}
                <figcaption className="micro">{image.label}</figcaption>
              </figure>
            ) : modelUrl ? (
              <SculptureViewer key={modelUrl} colour={colour || undefined} sculpture={{...item, name:modelName, modelUrl, cover: rendered?.front || originalGallery[0]?.src || item.cover}} />
            ) : <p>Photograph pending.</p>}
          </div>
          <div
            className="gallery-rail"
            role="group"
            aria-label="Sculpture gallery"
          >
            {gallery.map((img, i) => (
              <button
                key={i + "-" + img.label}
                aria-pressed={view === i}
                onClick={() => setView(i)}
              >
                {img.src ? <img ref={i === 0 ? frontThumb : undefined} src={img.src} alt="" /> : <CubeIcon aria-hidden="true" />}
                <span>{img.label}</span>
              </button>
            ))}
            {modelUrl && (
              <button
                aria-pressed={!image}
                onClick={() => setView(-1)}
              >
                <CubeIcon />
                <span>3D model</span>
              </button>
            )}
          </div>
        </div>
        <div className="purchase">
          <p className="kicker">
            Studio collection <i /> Object {item.number}
          </p>
          <h1 className="display-title">
            {item.name}
            <em>.</em>
          </h1>
          <p className="purchase-intro">{item.description}</p>
          <fieldset>
            <legend className="micro">Choose a format</legend>
            <div className="edition-options">
              {item.variants.map(v=>v.format==="print"?"Printed piece" as const:"STL file" as const).map((f) => (
                <button
                  aria-pressed={format === f}
                  key={f}
                  onClick={() => setFormat(f)}
                >
                  <span aria-hidden="true" className="radio-mark" />
                  {f === "Printed piece"
                    ? "Printed object"
                    : "Digital STL file"}
                </button>
              ))}
            </div>
          </fieldset>
          {modelUrl && <PreviewColourField colour={colour} change={chooseColour} storefront hasDefaultColour={!!item.defaultColour} />}
          {physical && variant.attributes.height_mm && <p>Printed height · {variant.attributes.height_mm} mm</p>}
          {physical ? (
            <div className="preferences">
              <label>
                Finish preference
                <select
                  value={finish}
                  onChange={(e) => setFinish(e.target.value)}
                >
                  <option>As printed</option>
                  <option>Studio to advise</option>
                </select>
              </label>
              <label>
                Quantity
                <input
                  type="number"
                  min="1"
                  max="100000"
                  value={qty || ""}
                  onChange={(e) => setQty(Number(e.target.value))}
                />
              </label>
            </div>
          ) : (
            <div className="edition-note">
              <strong>Digital edition</strong>
              {parts.length > 1 && <p>{parts.length} STL files included · {parts.map(p => p.name).join(", ")}</p>}
              <p>
                {item.sample?"STL format. Delivery is digital. File contents and licence terms are pending catalogue approval.":"STL format. Downloads become available after payment verification."}
              </p>
            </div>
          )}
          <div className="purchase-total">
            <span>{item.sample?"Sample ":""}{physical ? "subtotal" : "price"}</span>
            <strong>
              {!variant?.available && price === 0 ? "Pricing pending" : validQty ? rupees(price * (physical ? qty : 1)) : "—"}
            </strong>
          </div>
          <button
            className="primary purchase-action"
            disabled={!!preview || !validQty || !variant?.available || !!error}
            onClick={() => {
              const colourName = previewColours.find(([,hex]) => hex === colour)?.[0] ?? colour;
              const detail = physical ? [format, finish, colourName].filter(Boolean).join(" · ") : format;
              let bagImage: string | undefined = item.cover;
              if (physical && recoloured) {
                // The gallery releases its blob URLs when leaving this page.
                bagImage = undefined;
                const thumb = frontThumb.current;
                if (rendered && thumb?.currentSrc === rendered.front && thumb.naturalWidth > 0) {
                  const canvas = document.createElement("canvas");
                  canvas.width = canvas.height = 144;
                  const context = canvas.getContext("2d");
                  if (context) {
                    context.drawImage(thumb, 0, 0, 144, 144);
                    bagImage = canvas.toDataURL("image/webp");
                  }
                }
              }
              add({
                key: item.id + "-" + detail,
                variantId:variant.id,sample:item.sample,heightMm:physical?variant.attributes.height_mm:undefined,
                title: item.name,
                detail,
                price,
                quantity: physical ? qty : 1,
                physical,
                image: bagImage,
              });
              navigate("/bag");
            }}
          >
            {preview?"Studio preview":variant?.available?"Add to bag":"Currently unavailable"} <ArrowUpRightIcon />
          </button>
          <p className="fine">
            {item.sample?"Sample listing for design review.":"Development orders are recorded as unpaid."}{" "}
            {item.sample && (physical
              ? "Checkout previews delivery details and takes no payment."
              : "Checkout previews digital delivery. No payment or file transfer.")}
          </p>
        </div>
      </div>
      <section className="object-details" aria-label="Product information">
        <div role="group" aria-label="Read about this object">
          {["The object", "Printed format", "Digital file / licence"].map(
            (tab) => (
              <button
                key={tab}
                aria-pressed={details === tab}
                onClick={() => setDetails(tab)}
              >
                {tab}
              </button>
            ),
          )}
        </div>
        <p>
          {details === "The object"
            ? item.description
            : details === "Printed format"
              ? "Physical orders need a delivery address. Final dimensions, available finishes and shipping terms require confirmation before sale."
              : item.sample?"This sample shows the purchase path for an STL. The file list, licence and download terms must be confirmed before a digital edition goes on sale.":"Private STL files are delivered through time-limited links after verified payment. Contact the studio about licensing."}
        </p>
      </section>
    </Container>
  );
}
