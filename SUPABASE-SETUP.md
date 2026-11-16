# Chroma3D development backend

[Development dashboard](https://supabase.com/dashboard/project/mbilemzzpoxdwujyswfk) · [Chroma3D organization](https://supabase.com/dashboard/org/pufuvmorvrnpwhrkdaqn)

| Setting | Development value |
| --- | --- |
| Organization | Chroma3D’s Org, `pufuvmorvrnpwhrkdaqn` |
| Project | `chroma3d-dev`, ref `mbilemzzpoxdwujyswfk` |
| Region and plan | Mumbai, `ap-south-1`, Free |
| Public API | `https://mbilemzzpoxdwujyswfk.supabase.co` |
| Connector for management | Chroma3D’s Supabase, `link_6af9bbdb39988191894d36e6d26cca3a` |

## Run the connected frontend

Install locked dependencies with `npm ci`. Copy `.env.example` to the ignored `.env.local` and fill `VITE_SUPABASE_PUBLISHABLE_KEY` from this project's API keys. Only the project URL and publishable key belong in Vite. Run `npm run dev`, or `npm run build` to generate the static pages. The hosted development project supplies the data in both cases.

The existing Vercel testing site has its own build environment. To connect it, scope the two public variables above to the approved test deployment, verify the target branch and domain assignments, then rebuild. The official-domain canonical and test-host noindex rules still come from the existing SEO configuration.

## Owner access

1. The authorized owner is `chromazen.zen@gmail.com`. A single invitation was issued through **Authentication → Users**. Check the existing identity and confirmation before sending any further email. The development invitation opens `http://localhost:5209/admin` on the computer running the site. The owner sets their own password.
2. After confirmation, verify the Auth UUID independently. In this project's SQL Editor, grant only the verified identity. Replace the UUID placeholder before running this statement.

```sql
insert into private.admin_members(user_id)
select id from auth.users
where id = '<verified-owner-user-uuid>'::uuid
  and lower(email) = 'chromazen.zen@gmail.com'
  and email_confirmed_at is not null
  and not exists (select 1 from private.admin_members where user_id <> auth.users.id)
on conflict do nothing;
```

3. Open `/admin`, sign in, enroll an authenticator, and enter the six-digit code. The database checks membership and an AAL2 session. A regular signup has customer permissions. Remove the exact membership to revoke administrative access.
4. **Authentication → URL Configuration** uses `http://localhost:5209/admin` as the default. Admin callbacks allow localhost and 127.0.0.1 on port 5209 and the Vercel testing origin. Customer confirmation and password recovery use the exact `/account` path on localhost and 127.0.0.1 on ports 5173 and 5209, and on `https://chroma3d-website.vercel.app`. Use a local callback until the account page is deployed. Public customer emails require a verified custom SMTP sender. Supabase’s built-in sender is restricted to organization team addresses.
5. To recover a password, enter the account email at `/admin`, choose **Reset password**, and open the latest recovery email. Use the authenticator when required. A password reset preserves MFA. For a lost authenticator, a trusted administrator of the Supabase project must independently verify the owner, review and revoke existing sessions, and remove only the lost factor through Supabase Auth administration. Keep the business membership gated by AAL2 and enroll a replacement factor privately. Never share recovery links or authenticator secrets.

## Data and operations

Migrations in `supabase/migrations/` match the hosted migration history. Apply subsequent changes as new migrations. The only public catalog write interface is for authorized administrators. Status publication, file handling, price snapshots and state transitions have separate server-side checks.

| Area | Operation |
| --- | --- |
| Catalog | The store and prerender read genuine published products. All four initial sculptures are published. Their printed and digital editions have pricing pending. Set each price and enable **Available** in **Studio desk → Catalogue → Editions** when ready to sell. |
| Printing | Geometry inspection is local. Explicit submission sends the selected file, contact information, measured bounds and manufacturing preferences to the studio. An operator can enter the reviewed total material mass and an indicative amount, then send a dated quotation. The database calculates the PLA material component at 100,000 paise/kg (₹1,000/kg or ₹1/g). Other rates come from controlled pricing settings. The quote and material cost are separate. No automatic slicing or calculated print time is provided. |
| Studio | Submit a reviewed brief and references. The owner reviews, discusses, uploads revisions and identifies the exact revision for customer approval. Manufacturing, shipping, final files and completion are recorded with request history. |
| Orders | Genuine available variants create unpaid orders and immutable item-price snapshots in paise. The database reads catalog prices, validates quantities, physical shipping details and fixed variant dimensions, and handles repeated submissions atomically. Custom sizes require a quote. |
| Customer access | Customers sign up, sign in, and recover passwords at `/account`. Orders, purchased downloads, print requests and studio projects are scoped to the signed-in customer. Guest submissions can still be reopened at `/requests` using their per-record receipt stored in the browser tab. The bag persists in IndexedDB. Signing in merges guest items into that customer's bag on the same browser and origin. |
| Payments and files | `private.record_verified_payment` is the integration point for a future trusted payment verifier. There is no public payment-confirmation endpoint. Verified order, currency and amount permit entitlements to specific file versions. Authorized downloads receive audited 60-second signed URLs. |
| Live changes and messages | Realtime publishes authorized inserts and updates on orders and requests. The admin desk refreshes its list on changes. The private notifications table records business events. Assign a transactional sender before enabling external delivery. |

### Testing email and checkout

In Supabase Auth email settings use sender **Chroma3D** and `chromazen.zen@gmail.com` as both sender address and SMTP username. Gmail uses `smtp.gmail.com` on port 465 (SSL/TLS). Enter the Chroma3D Google App Password directly into the SMTP password field. Customer signup and recovery return to `/account`. The dashboard’s default invitation callback also routes customers there after checking membership.

For Razorpay Test Mode, set `CHROMA_RAZORPAY_TEST_KEY_ID`, `CHROMA_RAZORPAY_TEST_KEY_SECRET`, and `CHROMA_RAZORPAY_TEST_WEBHOOK_SECRET` in the development project's Edge Function secrets. Subscribe the test webhook to `payment_link.paid` at `https://mbilemzzpoxdwujyswfk.supabase.co/functions/v1/chroma-api/razorpay-webhook`. Use the same webhook secret in both dashboards. The customer opens the hosted test link from the saved order and can check its status there. Retries reuse the order reference. The server verifies the signature and independently reads the capture using the merchant's test credentials. Test captures have a separate private ledger and confer no download or fulfilment rights. Live-mode keys are rejected.

### Storage and Edge

Only `product-media` is public. It holds approved display assets. `draft-media`, `digital-products`, `print-uploads` and `studio-files` are private. Keep paid originals out of the website's static directory. Withdrawing a listing removes its managed public origin copies. Previously distributed display images can remain in browser or CDN caches.

The hosted `chroma-api` function accepts guest submissions and verifies supplied session tokens through Auth. Privileged operations additionally require MFA membership. Server-side checks cover data shape, file signatures and package structure, upload sizes, quotas, ownership and workflow states. Customers can upload one model up to 25 MiB, or up to three studio references totaling 10 MiB. Private object keys are generated server-side. The desk's cleanup action removes abandoned uploads older than two hours through the Storage API. File inspection checks format and limits. Manufacturing review remains a separate step.

### Publishing and SEO

The build reads published listings from Supabase, produces product-specific HTML and metadata, and embeds the same catalog snapshot for hydration. Only genuine published products enter the sitemap. Drafts are absent, and samples carry noindex. For automatic rebuilding, configure the test branch's Vercel deployment hook as the Edge secret `CHROMA_VERCEL_DEPLOY_HOOK`. Publishing and changes to already-published product or variant details request a rebuild when that hook is present. The desk also provides a retry. Until a rebuild completes, static HTML and the sitemap reflect the preceding build.

## Verification and boundaries

- Run `npm run build` and `node supabase/tests/prerender.mjs` for HTML, canonical, metadata, private routes and sitemap checks. The genuine-listing SEO fixture exists only in memory.
- `supabase/tests/hosted_workflows.py` exercises actual Auth, MFA, PostgREST, the Edge Function, Storage, Realtime and expiring downloads. It creates disposable sample data and identities, then removes them. A positive order fixture uses transaction-local catalog changes and a synthetic trusted payment record. Live payment processing is outside the test.
- The suite is pinned to this project and organization. It can run using the explicitly selected connector as its SQL adapter. For a standalone run, use Python with `bcrypt` and `requests`, the repo's Node dependencies and `.env.local`. Supply `CHROMA_TEST_PROJECT=mbilemzzpoxdwujyswfk` and a development-scoped `SUPABASE_ACCESS_TOKEN` through the environment, then run `python supabase/tests/hosted_workflows.py`. Never put that token in a Vite variable or repository file.
- Browser verification used the local production build against the hosted backend. It covered the rotating sculpture, zoom/reset, digital product selection, sample checkout, STL review, bulk contact link, guest studio submission and reopening the private receipt, admin login screen and mobile navigation.
- Security Advisor reported eight intentionally closed server-only tables with RLS and no client policies. Leaked-password detection is disabled on the Free plan. Administrative privileges require MFA. [Supabase password security](https://supabase.com/docs/guides/auth/password-security)
- The development catalogue has four genuine listings awaiting owner pricing. Public email delivery, merchant acceptance, and Vercel deployment each require testing with their configured services.
