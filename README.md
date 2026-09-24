# PICKVANTA-v2
PickVanta — Make the smarter pick. Modern discovery and deals platform.

**Stage:** Step 8 — the catalogue lives in a real database. PostgreSQL (on Supabase)
holds the tables, relationships and constraints; Row Level Security exposes published
records to anonymous readers and nothing else; `js/store.js` reads it through the
read-only data API. The interface, the domain contract (`js/domain.js`) and the data
access boundary are unchanged in shape — the source behind them is not.
No accounts, no seller area, no payments, no browser writes, no live pricing.

---

## Views

| View | File | Purpose |
| ---- | ---- | ------- |
| Home | `index.html` | Landing page and primary entry point: search → Discover results, categories → Discover (pre-filtered), **Explore by need** shortcuts, featured options, a compare call-to-action that reflects the tray, demo deals, how-it-works, guides, and a **Recently viewed on this device** strip that only appears once the device has opened a detail page. |
| Discover | `discover.html` | Browse the whole demo catalogue: search, category strip, **popular tags** (`?tag=`), filters (category, subcategory, type, **tag**, price range, location, availability), sort, result cards, active-filter chips and contextual empty states with recovery paths. |
| Deals | `deals.html` | Offers attached to products and services: offer price, original price, discount, seller, location, validity and conditions. Each card states that the offer belongs to the listing underneath it. |
| Detail | `detail.html?id=…` | One reusable template ordered as breadcrumb → identity → visual → type/category/subcategory → illustrative price → seller/provider → location or service area → availability → **Quick facts** → highlights → **What to consider** → actions → offer (**Price / Offer / Important context**) → specifications → **Good to know** → **Related options**. Products and services lead with different facts and prompts. Related records explain *why* they appear (“Why this appears: same subcategory · similar price · Nairobi”). |
| Compare | `compare.html?ids=a,b,c` | Up to three options side by side with a **Compare focus** selector (price, performance, features, portability, availability, location, specifications, service coverage, included services) that highlights matching rows and says “Your selected comparison areas are highlighted below.” Rows are grouped per category (products and services use different groups; unknown combinations fall back to the generic grouping), rows that are empty for every option are dropped, “Show differences only” hides identical rows, values that no other selected option shares are tinted (tint marks the difference, never superiority), and small screens get a stacked card layout. Equal treatment throughout — no scoring, ranking or winner. |
| Guides | `guides.html` | Guide outlines with category filtering and search. Each card states the question it answers, hides its topics behind a disclosure, and links into the matching slice of the catalogue (for example “How to choose a Wi-Fi router” → `discover.html?category=technology&sub=Networking`). Full articles are intentionally not written yet. |

## PickVanta Domain Model

Step 7 gave the project one explicit data contract, and Step 8 serves it from a real
database. Every record the interface sees has been normalised and validated by
`js/domain.js` and handed over by `js/store.js`; no page, card or controller knows how
the record is stored — or whether it came from PostgreSQL over the read-only API or from
the bundled demonstration catalogue. **Authentication, seller accounts, a write path and
payments are still not implemented**, and this section documents the contract they will
have to satisfy.

### Entities and relationships

```
seller / provider ──1:N──▶ listings              listing.sellerId is the reference
taxonomy ──▶ categories ──1:N──▶ subcategories   the single source of category names
listings ──1:N──▶ offers                         offer.listingId is the reference
guides ──N:M──▶ listings                         guide.relatedListingIds[]
listings ──▶ location                            country · county · city · area · serviceArea · format
```

| Entity | Identity | Where it is defined | Owning fields |
| ------ | -------- | ------------------- | ------------- |
| **Listing** | `id` | `js/domain.js` (model), `js/data.js` `listings[]` (demo) | `type` (`product` \| `service`, always explicit), `name`, `slug`, `shortDescription`, `description`, `brand`, `category`, `subcategory`, `tags[]`, `highlights[]`, `images[]`, `price`, `currency`, `referencePrice`, `location`, `availability`, `sellerId`, `specifications[]`, `status`, `createdAt`, `updatedAt`, `offerId` |
| **Seller / provider** | `id` | `js/data.js` `sellers[]` | `name`, `slug`, `type`, `description`, `location`, `contact` (`email`/`phone`/`website`, all empty in this build), `verificationStatus`, `status` |
| **Category** | `slug` | `js/data.js` `taxonomy[]` | `label`, `icon`, `subcategories[]` — the only place a category name exists |
| **Subcategory** | `id` (slug form) | inside its category | `label`; `id`, not the label, is what listings store |
| **Location** | structured object | on every listing and seller | `country`, `county`, `city`, `area`, `serviceArea[]`, `format` |
| **Deal / offer** | `id` | `js/data.js` `offers[]` | `listingId`, `title`, `description`, `kind`, `originalPrice`, `offerPrice`, `discountPercent`, `currency`, `startsAt`, `endsAt`, `availability`, `sellerId`, `status`, `conditions[]` |
| **Guide** | `id` | `js/data.js` `guides[]` | `title`, `slug`, `category`, `tags[]`, `question`, `summary`, `sections[]`, `relatedListingIds[]`, `cta`, `status`, `createdAt`, `updatedAt` |

An **offer is never a product of its own**: it references a listing, and the store joins
it onto that listing, so a deal page, deal card or detail page always renders the same
record underneath.

### Vocabularies (closed sets)

| Field | Values |
| ----- | ------ |
| `listing.type` | `product`, `service` |
| `listing.status` | `draft`, `published`, `archived` — only `published` is ever readable |
| `listing.availability` | `available`, `limited`, `by-appointment`, `on-request`, `unavailable` |
| `price.priceType` | `fixed`, `range`, `starting-from`, `quote`, `per-item`, `per-person`, `per-hour`, `per-day`, `per-night`, `per-week`, `per-month`, `per-year`, `per-session`, `per-lesson`, `per-visit`, `per-package` |
| `offer.kind` | `percentage`, `fixed-price`, `package`, `bundle`, `limited`, `billing`, `introductory` |
| `offer.status` | `scheduled`, `active`, `ended`, `withdrawn` — derived from `startsAt`/`endsAt`, never invented |
| `seller.type` | `brand-store`, `retailer`, `provider`, `service-provider`, `host`, `seller` |
| `seller.verificationStatus` | `unverified`, `demo-verified` |
| `location.format` | `local`, `nationwide`, `online`, `unspecified` |
| `guide.status` | `draft`, `published`, `archived` |

### Money, locations and presentation

* Money is structured — `price: { amount | min+max, priceType }` plus a listing-level
  `currency` (`KES`). No record contains a formatted price; `KSh 45,000`,
  `KSh 3,500 – KSh 6,500`, `KSh 2,900/month`, `From KSh 1,200` and
  `Price on request` are produced at render time by `PV.domain.priceText()`.
* Locations are structured too: a listing states its own place
  (`country`/`county`/`city`/`area`), whether it is `local`, `nationwide` or `online`,
  and an optional `serviceArea[]` for work that covers several places. The search and
  filter engine reads those structured fields — there is no hard-coded list of towns in
  the search code.
* Service areas moved out of the old `attributes` list into `location.serviceArea`; a
  specification is now anything else the record states about itself.
* No HTML, and no verdict vocabulary, exists in any record: nothing carries
  `best`, `recommended`, `winner`, `score`, `rank` or a similar field.

### Validation before a record is accepted

`PV.domain.validateListing/validateOffer/validateGuide/validateSeller` check identity,
type, category, price structure, currency, status and references. `js/store.js` runs
them on load, keeps what is usable, refuses what is not, and records everything in
`store.diagnostics()`:

* a listing without an `id`, `name`, a valid `type`, a category, a valid `status` or a
  usable price is rejected;
* a duplicate `id`, an offer pointing at a listing that does not exist, or a guide
  referencing an unknown listing is reported and skipped;
* a record that is not an object, a missing array or a malformed price block degrades
  to a warning instead of an exception — **one malformed record can never break the
  catalogue**, and the interface keeps rendering the records that are valid.

### API contract (implemented, read-only)

These operations are what the interface uses. They are implemented in `js/store.js`
over both sources, so no page or controller had to change when the database arrived:

| Operation | Returns |
| --------- | ------- |
| `getListings(params)` | the paged envelope below |
| `getListing(id)` | one published listing, or `null` |
| `searchListings(query, params)` | the paged envelope |
| `filterListings(filters)` | the paged envelope |
| `getCategories()` / `getSubcategories(category?)` | taxonomy records |
| `getDeals()` / `getDeal(id)` | offers with their listing attached |
| `getGuides()` / `getGuide(id)` | guide outlines |
| `getRelatedListings(id, limit)` | matches with the reason each one appears |
| `getListingsBySeller(id)` | everything one provider publishes here |

Every listing-returning call uses the same envelope the interface has used since
Step 6 — `{ ok, items, total, page, pageSize, hasNext, hasPrev, error }` — and every
record is normalised by `js/domain.js` before it reaches a card, whichever source it
came from. The source is one of two adapters inside `js/store.js` (a Supabase REST
adapter, or the bundled demonstration catalogue); `js/store.js` is the only file that
knows which, and `js/data.js` is mentioned nowhere else.

### The demo dataset behind the model

The catalogue is deliberately mid-sized and unchanged by the migration:
**51 published listings (31 products, 20 services), 19 attached offers and 10 guide
outlines**, 45 providers, eight categories, 37 subcategories and 106 tags. Twelve
listings state a service area. Everything is demonstration data — no real products,
prices, sellers, offers or availability — and the homepage shows a *curated* slice
(`homeFeaturedIds`, `homeDealIds`, `homeGuideIds`).

## Architecture

### Current (Step 8)

```
page (HTML)
   ↓
controller (js/app.js, discover.js, deals.js, detail.js, compare.js, guides.js, listing.js)
   ↓
data access layer (js/store.js)      ← the only module that knows where records come from
   ↓
domain model (js/domain.js)          ← canonical shapes, vocabularies, normalisers, validators
   ↓
one of two adapters (both inside js/store.js):
  • Supabase adapter — read-only REST calls, published rows only  →  PostgreSQL on Supabase
  • demo adapter     — the bundled demonstration catalogue in js/data.js, loaded on demand
```

The interface layer (`js/core.js`) renders what the data layer returns and owns
browser-local user state (compare selection, recently viewed). No page reads
`js/data.js`, no page issues a network request, and no page knows which source answered.
The comparison selection and the recently-viewed list stay in the browser: the database
is the catalogue, not a place for personal state.

### Where the data comes from

| Mode | Source | When it is used |
| ---- | ------ | --------------- |
| `demo` (default) | `js/data.js`, loaded on demand by the demo adapter | No project configured. Everything is labelled as a demonstration. |
| `api` | Supabase REST (PostgREST) with the public anon key | A project is configured (`js/config.js` or a local override). |
| fallback `demo` | `js/data.js` again | Only when `onFailure: 'demo'` **and** the live catalogue could not be reached. The page says so in a visible notice (`#fallbackNotice`). |
| fallback `error` (default) | none | The page shows its normal error state with a retry control. A real outage is never disguised as a demo. |

The two adapters implement the same interface, so the pages are identical in both modes;
`PV.store.source()`, `PV.store.fallbackActive()` and `PV.store.catalogue()` are how the
copy knows which one is answering (a live page never calls live data a demo, and a page
that fell back always labels the demonstration catalogue).

### Not in this stage

Writes of any kind, accounts, authentication, seller or admin areas, dashboards,
payments. The database is read-only for the browser: seller management is a later stage
and will need authentication first.

## Database (Supabase / PostgreSQL)

The catalogue is data, not markup: eight tables with real keys and constraints, a
maintained search column, Row Level Security and three read-only functions. Nothing in
the browser can write to it.

| Table | Holds | Relationships |
| ----- | ----- | ------------- |
| `categories` | the eight categories (`id`, `slug`, `name`, `description`, `icon`, `position`, `status`) | referenced by `subcategories`, `listings`, `guides` |
| `subcategories` | 37 subcategories | `category_id → categories(id)`, on delete cascade; at most one parent each |
| `sellers` | 45 demonstration providers (`name`, `slug`, `type`, `description`, location, `verification_status`, `status`) | referenced by `listings` and `deals` |
| `listings` | 51 products and services: explicit `type`, name, slug, pricing (`price_amount`/`price_min`/`price_max`, `currency`, `price_type`), structured location, `tags text[]`, `highlights`, `specifications jsonb`, `images jsonb`, `availability`, `status`, timestamps | `category_id`, `subcategory_id`, `seller_id`; a subcategory must belong to the same category (constraint) |
| `deals` | 19 offers. An offer is never a product of its own | `listing_id → listings(id)` **not null**, on delete cascade; `seller_id` optional |
| `guides` | 10 guide outlines with their sections (`content jsonb`), `tags`, `level`, `read_time`, `cta`, `status` | `category_id → categories(id)` |
| `guide_listings` | which listings a guide discusses — a real many-to-many table (`guide_id`, `listing_id`, `position`) | composite primary key; both sides cascade |
| `catalogue_settings` | 15 curated configuration rows (`key`, `value jsonb`): homepage selections, price bands, sort options, compare groups, considerations, good-to-know notes, needs, popular tags, version notice | none — it is configuration, served by the data API |

JSON is used only where a value genuinely is a document (specification rows, image
entries, guide sections, `service_area text[]`, settings values). Every relationship
that is a relationship is a foreign key; there is no record that stores an array of ids
in place of a join table, and no column holds HTML or a pre-formatted price.

### Applying the schema and the seed

```bash
# in the Supabase dashboard → SQL editor, run in this order:
db/migrations/0001_catalogue.sql     # tables, constraints, indexes, triggers, RLS, functions
db/seed/0001_catalogue.sql           # the catalogue, upserted by primary key

# or from a terminal with a connection string (never committed):
psql "$DATABASE_URL" -f db/migrations/0001_catalogue.sql -f db/seed/0001_catalogue.sql
```

Both files are idempotent: re-running the migration replaces triggers, policies and
functions, and the seed upserts. `db/seed/0001_catalogue.sql` is **generated** — edit
`js/data.js` and regenerate it rather than hand-editing the SQL:

```bash
node db/scripts/build-seed.js           # rewrite the seed from the current catalogue
node db/scripts/build-seed.js --check   # fail if the seed no longer matches (used before commits)
```

### Security

* Row Level Security is enabled on every table, and the only policies that exist are
  `select` policies for `anon` and `authenticated`.
* A visitor may read a `listings` row only while `status = 'published'`; `deals`,
  `guides` and `subcategories` are visible under the same rule, and a deal is visible
  only when its listing is published. Drafts and archived records are unreachable
  through the API, not merely hidden in JavaScript.
* There are no insert, update, delete or truncate policies, and those privileges are
  revoked from `anon` and `authenticated`, so a browser cannot modify the catalogue even
  with a valid session.
* The three functions (`catalogue_stats()`, `catalogue_tags()`, `catalogue_facets()`)
  are `security definer`, `stable`, and return counts only — never rows that a policy
  would have hidden.
* The browser only ever holds the public anon key. The service-role key, the database
  password and the connection string stay out of the repository (see `.gitignore`) and
  out of the browser. Verified by a scan before this stage was committed.

## Configuration

Everything the frontend needs is in `js/config.js`, which is committed and contains
public values only:

| Key | Meaning |
| --- | ------- |
| `mode` | `'demo'` (default) serves the bundled demonstration catalogue; `'api'` reads the Supabase project |
| `supabase.url` | the project URL, e.g. `https://YOUR-PROJECT-REF.supabase.co` — public |
| `supabase.anonKey` | the project's anon (publishable) key — public by design; Row Level Security is what protects the data |
| `onFailure` | `'error'` (default) shows the error state with a retry control; `'demo'` falls back to the demonstration catalogue and says so on the page |
| `poolLimit` | how many records a page may pool for compare suggestions and typeahead |

To point the site at a real project, either set the two values in `js/config.js`, or
keep them out of the file by loading a local override first:

```html
<script src="js/config.local.js"></script>  <!-- git-ignored, your values -->
<script src="js/config.js"></script>        <!-- committed defaults -->
```

`js/config.example.js` is a filled-in template for exactly that file. Never put the
service-role key, a database password, a JWT secret or a personal access token in any of
them — those belong to database operations, not to a static site.

### Deploying to Vercel

A static site cannot read Vercel Environment Variables at runtime — Vercel injects them
into build processes and functions, never into files served to a browser. So the two
public values are materialised into the same git-ignored override file at build time:

| Vercel setting | Value |
| --- | --- |
| `SUPABASE_URL` (environment variable) | your project URL, `https://<project-ref>.supabase.co` |
| `SUPABASE_ANON_KEY` (environment variable) | the project's **publishable/anon** key — never the service-role key |
| Environments | Production, Preview and Development |
| Build command | `node tools/vercel-config.js` (already set in `vercel.json`) |
| Output directory | `.` — the site is authored at the project root; there is no `public/` or `dist/` folder to emit |

`tools/vercel-config.js` is a dependency-free Node script and the whole build step:

* reads only `SUPABASE_URL` and `SUPABASE_ANON_KEY` (every other variable, including
  `SUPABASE_SERVICE_ROLE_KEY`, is ignored);
* writes `js/config.local.js` — the file every page already loads immediately before
  `js/config.js` — with the same `window.PV_CONFIG_OVERRIDE` shape local development uses,
  so the deployment reads the published catalogue from Supabase;
* if either variable is missing or blank, writes nothing and exits successfully: the
  deployment stays in the labelled demonstration mode;
* **fails the build** if a value looks privileged — an `sb_secret_…` key, a service-role
  key or JWT, a `postgres://` connection string or a direct database address — rather than
  shipping it to a browser.

Adding or changing either variable requires a **redeploy**: environment variables are
captured when a deployment is built. Running `node tools/vercel-config.js` locally, with
no variables set, is the safe way to check the wiring. Nothing about this adds a
framework, a bundler, a dependency or a runtime: the deployed site is still plain static
HTML/CSS/JS.

## Frontend structure (`js/`)

| File | Role |
| ---- | ---- |
| `config.js` | Runtime configuration (public values only): which source to use, the Supabase URL and anon key, and the failure policy. Loaded first by every page. `config.example.js` is a template for a local, git-ignored override. |
| `data.js` | The demonstration catalogue only: `taxonomy`, `locations`, `sellers`, `listings`, `offers`, `guides` and the Step 5 decision-support config (`considerations`, `goodToKnow`, `compareFocus`, `compareGroups`, `needs`, `popularTags`). Loaded **on demand** by the demo adapter — it is the fallback, not an API the pages use, and no page includes it as a script. |
| `domain.js` | **The domain model.** Canonical vocabularies, shape normalisers, label/format helpers (`money`, `priceText`, `locationLabel`, `availabilityInfo`, …) and the validators used by the store. No DOM, no network, no data. |
| `store.js` | **Data access layer.** Owns both adapters (Supabase REST and the bundled demo catalogue) and the fallback policy, normalises and validates every record against `js/domain.js`, and implements retrieval, search, filtering, sorting, related options, offers, guides, taxonomy, the homepage selections and the paged `query()` envelope. The only file in the project that talks to the network. No DOM, no user state. |
| `core.js` | Interface layer: DOM/format helpers, cards, loading/error/empty states, header/footer chrome, toast, compare tray, the browser-local compare and recently-viewed stores, and the filter/sort/search controls. It re-exports the data layer's price and label helpers through `PV.util` so view code has one import surface. |
| `listing.js` | The shared listing view behind Discover and Deals. Renders the result envelope from `PV.store.query()`, including the loading, empty and error states. |
| `app.js` | Home page controller. |
| `discover.js`, `deals.js`, `detail.js`, `compare.js`, `guides.js` | One small controller per view. |

### Catalogue model

Every record served by `PV.store` has the same shape, with optional blocks filled in by
the normaliser so the UI never has to test for their absence. The canonical fields are
documented in [PickVanta Domain Model](#pickvanta-domain-model); the notes below cover
what the interface does with them:

| Field | Notes |
| ----- | ----- |
| `id`, `type`, `name`, `category`, `subcategory` | `type` is `"product"` or `"service"` — explicit data, never inferred from a name or category |
| `brand`, `shortDescription`, `description` | Products carry a brand; services commonly leave it empty and are identified by their provider |
| `price`, `currency` | `price` is `{ amount \| min+max, priceType }`; `currency` is a listing-level code. A missing amount renders "Price on request" |
| `referencePrice` | Optional pre-offer price; an attached offer's `originalPrice` wins when both exist |
| `location` | `{ country, county, city, area, serviceArea[], format }` — `format` is `local`, `nationwide` or `online` |
| `sellerId` | The reference a listing carries; `store.getSeller(id)` resolves it to `{ id, name, type, typeLabel, verificationStatus }`. There are no seller accounts |
| `images` | `[{ id, position, icon, gradient, alt, src }]` — `src` is optional; a broken or missing image falls back to the icon tile or the bundled `assets/placeholder.svg` |
| `specifications` | `[{ label, value, group, position }]` — the details shown on detail and compare |
| `tags`, `highlights`, `availability`, `status`, `createdAt`, `updatedAt` | Tags drive discovery; `status` is the lifecycle (`draft`/`published`/`archived`), `availability` is the trading state |
| `offerId`, `offer` | The store joins the offer onto the listing, so offer → listing → details always resolves. An offer is never a second product |

Records that cannot be normalised or validated are refused rather than rendered, and are
reported through `store.diagnostics()` instead of failing silently. The demo catalogue
currently produces zero errors and zero warnings. Ratings, reviews, testimonials, sales
counts and popularity figures are deliberately absent from the model — the interface
shows none and the data carries none.

`css/styles.css` holds the existing design system plus clearly-marked
“STEP 2 — discovery experience”, “STEP 5 — decision support”, “STEP 6 — data-layer
preparation” and “STEP 7 — domain model” sections that reuse the same tokens, buttons,
cards, radii and shadows.

### Search rules

One implementation, in the data-access layer (`js/store.js`), serves the homepage, Discover, Deals, Guides and the Compare page:

* case-insensitive, punctuation-tolerant, and `wi-fi`/`wifi` are treated as the same word;
* filler words (`the`, `best`, `looking for`, …) are ignored, and a few everyday words map onto catalogue vocabulary (`cheap` → `budget`);
* **word-prefix** matching, so `cancel` finds “cancelling” and `phone` finds “Smartphones”;
* every query term must match somewhere (AND). If nothing matches, a relaxed pass keeps records that matched most terms *and* hit a strong field (name, brand, category, subcategory, tag) — which is how “website development” still finds the web design service;
* a query made only of filler words behaves like an empty search instead of filtering everything out;
* fields searched: name, brand, category, subcategory, tags, seller, location, description and specification values.

### Compare tray and related options

* The tray is a compact bar that shows “N of 3 selected”, each selected option, individual remove buttons, Clear and a link into Compare. The page gets bottom padding while it is visible, so it never covers content, and on phones it collapses to a single row that expands on demand.
* A fourth selection is refused with an explanation and a hint to swap an option out.
* Related options on the detail page are deterministic matches on category, subcategory, type, tags, brand, price band and location. They are labelled “Related options” and each card says “Why this appears: …” — there is no scoring, ranking, recommendation or AI anywhere in the path.

### Decision support (Step 5)

Everything here exists to help a visitor understand a choice — never to make it:

* **What to consider** — short category/subcategory prompts (“processor”, “service area”, “what is included”) with a one-line explanation each. Informational only, deterministic, with a graceful fallback when a category has no configuration.
* **Quick facts** — a compact summary above the reading blocks: products lead with type, brand, price, location, availability, a key specification, condition/warranty and offer status; services lead with service type, provider, price, service area (from `location.serviceArea`), turnaround and inclusions. A fact is only rendered when the record actually has it, so no row is ever empty and no `undefined`/`N/A` can appear.
* **Highlights** — taken from the record's own `highlights[]`, or read off its structured specifications when it has none. No invented facts.
* **Good to know** — general educational notes per category (RAM vs storage, advertised router speed vs real coverage, a starting price vs package scope). These are explicitly framed as general context, not claims about the demo provider.
* **Deal understanding** — an attached offer is split into *Price* (offer price, original price, discount), *Offer* (kind, start, end, status) and *Important context*, which states: “This is a demonstration offer. PickVanta does not process the transaction.” There is no checkout and no payment control anywhere.
* **Explore by need** — deterministic shortcuts on the homepage (Technology, Home, Automotive, Services) that map to a tag filter or a search, e.g. `discover.html?tag=student`. No separate page per need.
* **Tags** — `?tag=` integrates with the existing URL state, appears as a popular-tag strip and an in-panel filter group (the long tail sits behind a “More tags” disclosure), and never breaks an existing link.
* **Recently viewed** — up to five ids kept in `localStorage` under `pickvanta.recent.v1`, newest first, no duplicates, stale ids pruned on load, shown on the homepage as “Recently viewed on this device” with a Clear control. It is separate from the comparison selection and is not a favourites system.
* **Empty states** — “Nothing matches these filters” / “No options found” explain what is active, offer the popular categories, related tags, example searches and a one-click reset. Nothing is ever fabricated to fill a grid.
* **Compare focus** — the visitor chooses the areas that matter to them; matching rows are highlighted, and the tool states when a chosen area has nothing to match in the current comparison. It never scores, ranks or picks a winner.

### Conventions

* Filter/sort/search state lives in the URL (`?q=&category=&sub=&tag=&type=&band=&location=&availability=&sort=`), so a filtered view can be linked and reloaded. A subcategory is only honoured together with its category, switching category clears it, and an unknown tag is ignored rather than emptying the page.
* Comparison selection is a browser-only demo list (`localStorage`, max 3). It is not a favourites feature and is not stored on a server. Recently viewed is a separate list with its own key. Both live in `js/core.js` behind `PV.compare` and `PV.recent`, so the storage could later be replaced by authenticated storage without touching a page.
* Catalogue state (records, offers, guides, taxonomy) and interface state (query, filters, sort, comparison focus, recently viewed) never mix: only `js/store.js` reads the catalogue, only `js/core.js` writes browser state. Page controllers never read `js/data.js` or its keys.
* Listing pages render the envelope from `PV.store.query()`. Paging fields are already in that envelope, so a future API can page without changing the interface; with the demo dataset the whole result set is returned, exactly as before.
* Only `published` listings are ever readable. `draft` and `archived` records are excluded from every list, count, search, curated selection and by-id lookup, and there is deliberately no admin interface for changing status.
* Verdict-free by construction: no winner badges, no scores, no rankings, no “recommended for you”. The words only ever appear in copy that denies them, and a checklist asserts that no heading, button or badge carries them.
* Toasts and `aria-live` regions announce selections; nothing is written anywhere else.
* Card actions stay deliberately unequal: one primary action plus the Compare toggle, so no card competes with itself.
* Cards show `Category · Subcategory` and a Product/Service chip; detail pages, search and related-option matching all resolve subcategory labels from the taxonomy, so a name is never duplicated in two places.
* Prices are rendered as `KSh 12,400` (or `KSh 3,500 – KSh 6,500`, `KSh 1,600/month`, `From KSh 1,200`, `Price on request`) by the single formatter in `js/domain.js`, re-exported through `PV.util`.
* Records carry no presentation strings and no HTML, and no verdict fields — nothing can leak a score, rank or "winner" into the interface.

## Layout system

The presentation layer is one stylesheet (`css/styles.css`) and no build step. Six pages share one
spatial system, so a change to the container or the card grid moves every page together.

* **Container.** `.shell` is the only width primitive: `max-width: var(--max)` (2000px) with
  `padding-inline: var(--gutter)`, where the gutter is `clamp(16px, 2.4vw, 44px)`. Pages therefore run
  edge → gutter → content → gutter → edge, and every tested viewport (1920 / 1440 / 1280 / 1024 / 768 /
  390) is filled rather than boxed into a narrow column. Nothing else sets a page-level max-width.
* **Catalogue grids.** `.products-grid`, `.deals-grid` and `.guides-grid` are
  `repeat(auto-fill, minmax(min(100%, Npx), 1fr))`, so the column count follows the space actually
  available: no fixed breakpoint list to keep in sync, and `min(100%, Npx)` guarantees a narrow screen
  can never overflow. `.grid-3` / `.grid-4` remain in the markup purely as hooks.
* **Filter rail.** `.listing-layout` is `280px minmax(0, 1fr)`. Above 900px the rail is
  `position: sticky` under the header with its own scroll (`max-height: calc(100vh - var(--header-h) - 32px)`);
  at 900px and below it becomes the existing fixed drawer. The grid keeps `align-items: start` and no
  ancestor clips, which is what makes the sticky behaviour work.
* **Tokens.** `--max`, `--gutter`, `--header-h` (76px, 64px on phones) and `--card-radius` (18px, shared
  by every card family) sit at the top of the file beside the existing colours, radii and shadows.
  Spacing between sections, the hero and the page heads scales with `clamp()` instead of stepping at
  breakpoints.
* **Cards.** One surface, one radius, a 1px border and no resting shadow; depth only appears on hover.
  Card imagery keeps a fixed proportion (`aspect-ratio: 16 / 10`) so it stays honest at every column width.
* **Positioning.** Normal document flow is the default; the header is `sticky` because a marketplace
  benefits from persistent navigation, and `position: fixed` is used only for the compare tray, the
  toast and the mobile filter drawer. No layout script measures or repositions anything: the stylesheet
  is the whole mechanism, which is why this layer can be restyled without touching a line of JavaScript.

## Running it

Any static file server works, e.g.:

```bash
python3 -m http.server 8000
# then open http://localhost:8000/index.html
```

Opening `index.html` directly from the filesystem also works (no build step, no
bundler, no dependencies). The site is plain static HTML/CSS/JS, so it deploys to
Vercel (or any static host) without configuration.

Out of the box the site serves the bundled demonstration catalogue and labels it as
such — no project, no keys, no network. To read a live catalogue instead: apply the
schema and seed ([Database](#database-supabase--postgresql)), put your project URL and
public anon key in `js/config.js` (or a git-ignored `js/config.local.js` loaded before
it), and set `mode: 'api'`. If the project cannot be reached, the page shows an error
state and a retry control; set `onFailure: 'demo'` only for development and previews,
where a fallback is acceptable as long as it is labelled.

## Deliberately not built in this stage

Accounts, authentication, seller/agent/admin areas, dashboards, any write path into
the database, payments, checkout, messaging, real seller contact, favourites,
notifications, subscriptions, affiliate/referral tracking, commissions, a recommendation
algorithm, AI, external product APIs, scraping, live pricing, real-time inventory,
reviews, ratings, testimonials, sales or popularity statistics.

The database holds the catalogue and nothing about people: no accounts, no sessions, no
personal data, no seller management. Writing to it (seller listings, status changes) is
a later stage and needs authentication first — the tables, keys and policies here are
already shaped for it.
