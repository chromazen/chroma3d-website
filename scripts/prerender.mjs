import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createServer } from "vite";

const output = "dist";
const template = await readFile(join(output, "index.html"), "utf8");
const server = await createServer({
  configFile: false,
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true, hmr: false, watch: null },
  appType: "custom",
});
try {
  const { publicPaths, sitemapUrls, renderPage } = await server.ssrLoadModule("/src/prerender.tsx");
  for (const path of [...publicPaths, "/bag", "/checkout", "/404"]) {
    const { head, body } = await renderPage(path);
    const html = template
      .replace(/<!--route-head-->[\s\S]*?<!--\/route-head-->/, () => head)
      .replace('<div id="root"></div>', () => body);
    const file = join(output, (path === "/" ? "index" : path.slice(1)) + ".html");
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, html);
  }
  const urls = sitemapUrls.map(url => `  <url><loc>${url}</loc></url>`).join("\n");
  await writeFile(join(output, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`);
  console.log(`Rendered ${publicPaths.length} public pages and ${sitemapUrls.length} sitemap entries.`);
} finally {
  await server.close();
}
