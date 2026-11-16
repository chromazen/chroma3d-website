import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "vite";

const server = await createServer({
  configFile: false,
  appType: "custom",
  server: { middlewareMode: true, hmr: false, watch: null },
});
try {
  const catalog = await server.ssrLoadModule("/src/catalog.ts");
  const { prepareCatalog, renderPage } =
    await server.ssrLoadModule("/src/prerender.tsx");
  const { headTags, origin } = await server.ssrLoadModule("/src/seo.ts");
  const { collection } = await server.ssrLoadModule("/src/collection.ts");
  const sample = { ...collection[0], id: "sample-test-only", uid: "sample-test-only", sample: true,
    featured: false, category: "Sculpture", variants: [] };
  const listing = {
    ...sample,
    id: "verified-prerender-fixture",
    name: "Prerender specimen",
    sample: false,
    seoTitle: "Specimen title",
    description: "Prepared for the prerender test.",
  };
  catalog.setCatalog([sample, listing]);
  const { sitemapUrls, publicPaths } = await prepareCatalog();
  const path = "/shop/" + listing.id;
  assert(sitemapUrls.includes(origin + path));
  assert(!sitemapUrls.includes(origin + "/shop/" + sample.id));
  assert(!publicPaths.includes("/shop/absent-draft"));
  const { head, body } = await renderPage(path);
  assert(
    head.includes('href="' + origin + path + '"') &&
      head.includes("Specimen title") &&
      head.includes('"@type":"Product"'),
  );
  assert(body.includes(listing.name) && body.includes(listing.description));
  assert(
    !head.includes("noindex") &&
      headTags(path, false).some((t) => t.attrs?.content === "noindex, follow"),
  );
  for (const privatePath of ["/admin", "/account", "/requests", "/bag", "/checkout"]) {
    assert(
      headTags(privatePath, true).some(
        (t) => t.attrs?.content === "noindex, follow",
      ),
    );
  }
  const sitemap = await readFile("dist/sitemap.xml", "utf8");
  assert(!sitemap.includes("/shop/" + sample.id));
  const realSlug = collection[0].id;
  assert(sitemap.includes("/shop/" + realSlug));
  const raw = await readFile("dist/shop/" + realSlug + ".html", "utf8");
  assert(
    raw.includes(sample.name) &&
      raw.includes('"@type":"Product"') &&
      raw.includes('id="catalog-data"'),
  );
  console.log(
    "PASS published product raw HTML, metadata, canonical, structured data, sitemap filtering and private routes",
  );
} finally {
  await server.close();
}
