# Chroma3D search migration

The original GitHub Pages code uses React Router, a shared HTML head and a seven-URL sitemap. On 5 November 2026 the original homepage returned a JavaScript shell and a direct request to `/services` returned HTTP 404. The Vercel test homepage also returned a shell, with no indexing restriction visible in its response, and its direct `/shop` URL returned 404.

| SEO component | Original website | New website before migration | Required action | Priority |
|---|---|---|---|---|
| Initial content and deep links | Partial. Routes in React and sitemap, empty HTML root | Partial. In-app routes, empty HTML root | Emit HTML for each public route | P0 |
| Titles, descriptions, canonical | Partial. Sitewide tags point to the homepage | Partial. Client titles, one description, missing canonical | Generate from the route and update on navigation | P0 |
| Test hostname policy | Not applicable | Missing | Send noindex on nonofficial hosts and permit crawling | P0 |
| Robots and sitemap | Partial. Valid files, at least one listed route returned 404 | Partial. Allow rule only | List canonical, eligible URLs that return 200 | P0 |
| Business and service data | Needs verification. LocalBusiness includes historical street and phone | Missing | Use city-level LocalBusiness, WebSite, page, service and breadcrumb data | P1 |
| Social cards and images | Partial. Shared SVG logo, OG and Twitter tags | Partial. OG text, descriptive asset names and an existing model poster | Supply route-specific raster previews and expose real images in initial HTML | P1 |
| Legacy catalogue and claims | Outdated for this build. Meta keywords and older material, sustainability and precision claims | Not applicable | Omit unsupported capabilities, commercial offers and historical street details | P1 |
| Search-console ownership and local listings | Needs verification | Needs verification | Confirm in owner accounts at launch | P2 |

Google can render JavaScript. Static HTML also exposes headings, links, images and service text on the first request to crawlers and social preview clients. The build renders the existing components with empty public state. Product pages describe real models but currently show sample prices. They receive noindex and no Product or Offer markup. Revisit eligibility when rights, fulfilment, licence, pricing and delivery terms are approved. Bag and checkout receive empty application shells.

The wildcard robots group permits crawling, including search retrieval by OAI-SearchBot. GPTBot is a separate training crawler. The inherited allow-all policy also permits it. An explicit training opt-out is an independent owner decision. Host-based indexing restrictions use the HTTP response header since a robots block could prevent discovery of a noindex directive. [OpenAI crawler roles](https://platform.openai.com/docs/bots) · [Google JavaScript SEO](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics)

## Legacy routes at cutover

Paths below are relative to `https://www.chroma3d.in`. They cover all seven entries in the original sitemap. Redirects require a separate cutover.

| Old URL | Proposed new URL | Decision | Before launch |
|---|---|---|---|
| `/` | `/` | Keep | Existing homepage. |
| `/services` | `/services` | Replace | Provide a directory linking to printing and project intake. Preserve the legacy upload anchor. |
| `/products` | `/shop` | Redirect | Activate a permanent redirect at cutover. |
| `/contact` | `/contact` | Replace | Confirm contact details and publish the contact page. |
| `/get-quote` | `/get-quote` | Replace | Provide a general enquiry entry point and retain product-specific enquiries. |
| `/privacy-policy` | `/privacy-policy` | Replace | Approve and publish a policy reflecting actual data handling. |
| `/terms` | `/terms` | Replace | Approve and publish terms for the services actually offered. |

At cutover, route `/get-quote?service=custom-3d-printing` to `/print`. Route the service IDs `prototype-development`, `3d-design-support` and `product-development-support` to `/studio`. Review other service IDs, product parameters, indexed URLs and backlinks before enabling redirects.

## Owner checklist

1. Confirm the public business name, contact channel, service area and customer-facing location policy. Review the existing WhatsApp links. Publish a street address or hours only after explicit confirmation. Confirm any service claims before extending structured data.
2. In Google Search Console, confirm ownership of the existing domain property. Export indexed URLs, top landing pages, search queries and important backlinks before cutover. Verify the official site in Bing Webmaster Tools or import the verified Search Console property.
3. Before moving the domain, resolve the unmapped routes above. Test the candidate deployment with direct HTTP requests to every sitemap route, known redirects, a private route and a missing URL. Check HTML, canonical, HTTP status and `X-Robots-Tag` on both hostnames. The test hostname must return noindex. Eligible pages on the official hostname must allow indexing.
4. After the authorized switch, submit `https://www.chroma3d.in/sitemap.xml` in both consoles. Inspect the homepage and two service pages, review rendered HTML and the selected canonical, and request indexing for these pages. Validate the published graph in Schema.org Validator and check applicable Google rich-result eligibility.
5. Verify the existing Google Business Profile. Set the accurate category, website and service area. Use the service-area address visibility setting if customers do not visit a public studio. Align verified contact details and the official URL across real business directories.
6. Monitor both consoles weekly during the first month for 404s, redirect failures, unexpected noindex, duplicate canonicals, and traffic changes on previous landing pages. Track relevant Chennai printing and prototyping queries against the pre-migration baseline.
