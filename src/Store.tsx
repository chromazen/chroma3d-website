import { useState } from "react";
import { ArrowUpRightIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import {useCatalog,refreshCatalog} from "./catalog";
import { rupees } from "./collection";
import type { Format } from "./collection";

const formats = ["All objects", "Printed piece", "STL file"] as const;

export default function Store() {
  const [filter, setFilter] = useState<"All objects" | Format>("All objects");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("featured");
  const digital = filter === "STL file";
  const {items:collection,error,loading}=useCatalog();
  const items = collection.filter(item=>filter==="All objects" || item.variants.some(v=>v.format===(digital?"stl":"print"))).filter((item) =>
    item.name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  if (sort === "name") items.sort((a, b) => a.name.localeCompare(b.name));
  const edition=(item:typeof items[number])=>(digital || !item.variants.some(v=>v.format==="print"))?"stl":"print";
  const displayPrice=(item:typeof items[number])=>edition(item)==="stl"?item.digital:item.printed;
  const pricePending=(item:typeof items[number])=>displayPrice(item) === 0 && !item.variants.find(v=>v.format===edition(item))?.available;
  if (sort === "price") items.sort((a,b)=>Number(pricePending(a))-Number(pricePending(b)) || displayPrice(a)-displayPrice(b));
  return (
    <main className="wrap store-page" id="main">
      <header className="collection-intro">
        <div>
          <p className="kicker">01 / The collection</p>
          <h1 className="display-title">
            Objects with
            <br />
            <em>presence.</em>
          </h1>
          <p className="editorial-deck">
            Explore the studio’s sculptures as physical 3D prints or digital
            STL models.
          </p>
        </div>
        <img
          src="/adiyogi-store-1440.webp"
          width={1440}
          height={1017}
          srcSet="/adiyogi-store-720.webp 720w, /adiyogi-store-1440.webp 1440w, /adiyogi-store-2880.webp 2880w"
          sizes="(max-width: 740px) 58vw, (max-width: 1780px) 47vw, 840px"
          alt="Adiyogi in ash grey, seen in three-quarter view"
          fetchPriority="high"
        />
      </header>
      <section aria-label="Studio catalogue">
        {loading && <p role="status">Loading catalogue…</p>}{error && <p role="alert">{error} <button onClick={refreshCatalog}>Retry</button></p>}
        <div className="catalog-bar">
          <div
            className="format-filters"
            role="group"
            aria-label="Browse formats"
          >
            {formats.map((f) => (
              <button
                key={f}
                aria-pressed={f === filter}
                onClick={() => setFilter(f)}
              >
                {f === "STL file"
                  ? "Digital STL"
                  : f === "Printed piece"
                    ? "Printed objects"
                    : f}
              </button>
            ))}
          </div>
          <div className="catalog-options">
            <label className="catalog-search">
              <MagnifyingGlassIcon aria-hidden="true" />
              <input
                type="search"
                aria-label="Search objects"
                placeholder="Find an object"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <select
              aria-label="Sort objects"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="featured">Featured</option>
              <option value="name">Name A–Z</option>
              <option value="price">Price ↑</option>
            </select>
          </div>
        </div>
        <div className="catalog-note">
          <span>Studio collection</span>
          <span aria-live="polite">
            {items.length} {items.length === 1 ? "object" : "objects"}
          </span>
        </div>
        <div className="object-shelf">
          {items.map((item) => (
            <a
              className="object-tile"
              key={item.id}
              href={
                "/shop/" + item.id + "?format=" + edition(item)
              }
            >
              <div className="object-photo">
                <span className="micro">Object / {item.number}</span>
                <img src={item.cover} loading="lazy" alt={item.gallery[0]?.label || item.name} />
                <span className="image-arrow">
                  <ArrowUpRightIcon />
                </span>
              </div>
              <div className="object-info">
                <div>
                  <h2>{item.name}</h2>
                  <p>
                    {filter === "All objects"
                      ? item.variants.map(v=>v.format==="print"?"Printed object":"Digital STL").join(" / ")
                      : digital
                        ? "Digital STL edition"
                        : "Printed sculpture"}
                  </p>
                </div>
                <span>
                  {pricePending(item) ? "Pricing pending" : rupees(displayPrice(item))}
                </span>
              </div>
            </a>
          ))}
        </div>
        {!loading && !error && !items.length && (
          <div className="empty">
            <h2>{collection.length ? "No matching objects" : "The catalogue is currently unavailable."}</h2>
            {query && <button className="inline-link" onClick={() => setQuery("")}>
              Clear search
            </button>}
          </div>
        )}
      </section>
    </main>
  );
}
