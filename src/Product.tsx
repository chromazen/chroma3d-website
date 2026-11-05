import { useState } from "react";
import { ArrowUpRightIcon, CubeIcon } from "@phosphor-icons/react";
import { collection, rupees, navigate } from "./collection";
import type { CartLine, Format } from "./collection";
import SculptureViewer from "./components/SculptureViewer";

export default function Product({
  id,
  digital,
  add,
}: {
  id: string;
  digital: boolean;
  add: (line: CartLine) => void;
}) {
  const item = collection.find((p) => p.id === id);
  const [format, setFormat] = useState<Format>(
    digital ? "STL file" : "Printed piece",
  );
  const [qty, setQty] = useState(1);
  const [finish, setFinish] = useState("As printed");
  const [view, setView] = useState(0);
  const [details, setDetails] = useState("The object");
  if (!item)
    return (
      <main id="main" className="page wrap">
        <h1>Piece unavailable</h1>
        <a className="inline-link" href="/shop">
          Return to store
        </a>
      </main>
    );
  const physical = format === "Printed piece";
  const price = physical ? item.printed : item.digital;
  const image = item.gallery[view];
  const validQty =
    !physical || (Number.isInteger(qty) && qty > 0 && qty <= 100000);

  return (
    <main className="wrap product-page" id="main">
      <p className="product-crumb">
        <a href="/shop">Store</a>
        <span>/</span>Sculpture<span>/</span>
        {item.name}
      </p>
      <div className="product-layout">
        <div className="product-gallery">
          <div className="product-stage">
            {image ? (
              <figure className="product-image" key={image.src}>
                <img src={image.src} alt={item.name + " · " + image.label} />
                <figcaption className="micro">{image.label}</figcaption>
              </figure>
            ) : (
              <SculptureViewer sculpture={item} />
            )}
          </div>
          <div
            className="gallery-rail"
            role="group"
            aria-label="Sculpture gallery"
          >
            {item.gallery.map((img, i) => (
              <button
                key={img.src}
                aria-pressed={view === i}
                onClick={() => setView(i)}
              >
                <img src={img.src} alt="" />
                <span>{img.label}</span>
              </button>
            ))}
            {item.modelUrl && (
              <button
                aria-pressed={!image}
                onClick={() => setView(item.gallery.length)}
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
              {(["Printed piece", "STL file"] as const).map((f) => (
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
              <p>
                STL format. Delivery is digital. File contents and licence terms
                are pending catalogue approval.
              </p>
            </div>
          )}
          <div className="purchase-total">
            <span>Sample {physical ? "subtotal" : "price"}</span>
            <strong>
              {validQty ? rupees(price * (physical ? qty : 1)) : "—"}
            </strong>
          </div>
          <button
            className="primary purchase-action"
            disabled={!validQty}
            onClick={() => {
              const detail = physical ? format + " · " + finish : format;
              add({
                key: item.id + "-" + detail,
                title: item.name,
                detail,
                price,
                quantity: physical ? qty : 1,
                physical,
                image: item.cover,
              });
              navigate("/bag");
            }}
          >
            Add to bag <ArrowUpRightIcon />
          </button>
          <p className="fine">
            Sample listing for design review.{" "}
            {physical
              ? "Checkout previews delivery details and takes no payment."
              : "Checkout previews digital delivery. No payment or file transfer."}
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
              : "This sample shows the purchase path for an STL. The file list, licence and download terms must be confirmed before a digital edition goes on sale."}
        </p>
      </section>
    </main>
  );
}
