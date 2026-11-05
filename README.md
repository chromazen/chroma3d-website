# Chroma3D design preview
Run `npm ci` and `npm run dev` for development. `npm run build` type-checks, builds the client and writes route-specific HTML and a sitemap into `dist`. Use `npm run preview` to inspect the built pages. Serve the generated files at their clean URLs and return HTTP 404 for unknown routes. See [SEO migration and launch checks](SEO-MIGRATION.md).

The homepage displays an interactive web copy of the studio’s textured Mahalakshmi model. The product page includes both the printed piece and the 3D view. The shop uses three sample listings from the local model archive. Confirm ownership, commercial rights, inventory and prices before launch.

- Shop: printed and STL formats, quantities, shopping bag and a sample checkout with physical or digital delivery fields.
- Print a file: local STL/3MF parsing, geometry inspection, material, colour and finish preferences, quantity, sample checkout or a personal WhatsApp quote. Attach the model yourself when sending a WhatsApp enquiry.
- Prototype studio: a local project brief with optional reference files, an optional visitor-initiated WhatsApp enquiry, example design review, revision note, design approval and delivery handoff preview.

Products, prices, customer workspaces and checkout confirmations are for design review. Bag entries and project data live in browser memory. No payments, server uploads, customer notifications, downloads of purchased files, or fulfilment are connected. Before launch, connect verified pricing, catalogue, secure storage, customer/owner accounts, payments and fulfilment.
