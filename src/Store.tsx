import { useState } from "react";
import { ArrowUpRightIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { collection, rupees } from "./collection";
import type { Format } from "./collection";

const formats = ["All objects", "Printed piece", "STL file"] as const;

export default function Store() {
  const [filter, setFilter] = useState<"All objects" | Format>("All objects");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("featured");
  const digital = filter === "STL file";
  const items = collection.filter((item) =>
    item.name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  if (sort === "name") items.sort((a, b) => a.name.localeCompare(b.name));
  if (sort === "price")
    items.sort((a, b) =>
      digital ? a.digital - b.digital : a.printed - b.printed,
    );

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
      <section aria-label="Sample catalogue">
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
              <option value="price">Sample price ↑</option>
            </select>
          </div>
        </div>
        <div className="catalog-note">
          <span>Design preview · sample collection and prices</span>
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
                "/shop/" + item.id + "?format=" + (digital ? "stl" : "print")
              }
            >
              <div className="object-photo">
                <span className="micro">Object / {item.number}</span>
                <img src={item.cover} loading="lazy" alt={item.name + " sculpture"} />
                <span className="image-arrow">
                  <ArrowUpRightIcon />
                </span>
              </div>
              <div className="object-info">
                <div>
                  <h2>{item.name}</h2>
                  <p>
                    {filter === "All objects"
                      ? "Printed object  /  Digital STL"
                      : digital
                        ? "Digital STL edition"
                        : "Printed sculpture"}
                  </p>
                </div>
                <span>
                  {filter === "All objects" ? "Print · " : ""}
                  {rupees(digital ? item.digital : item.printed)}
                </span>
              </div>
            </a>
          ))}
        </div>
        {!items.length && (
          <div className="empty">
            <h2>No matching objects</h2>
            <button className="inline-link" onClick={() => setQuery("")}>
              Clear search
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
