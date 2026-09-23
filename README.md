# PICKVANTA-v2
PickVanta — Make the smarter pick. Modern discovery and deals platform.

**Stage:** Step 7 — domain model: the catalogue now has an explicit, validated data contract (`js/domain.js`) and a data-access boundary (`js/store.js`) that the pages talk to. This is the structure a real API and database will serve later; neither is built yet.
No database, no backend, no accounts, no payments, no external services, no live pricing.

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

Step 7 gives the project one explicit data contract. Every record the interface sees
has been normalised and validated by `js/domain.js` and handed over by `js/store.js`;
no page, card or controller knows how the record is stored. Today the source is the
demo file `js/data.js`. Tomorrow the same contract can be served by an API backed by a
database — **that backend, database, authentication, seller area and payment flow are
not implemented in this stage**, and this section documents the contract only.

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

### API contract (documented, not implemented)

A future API must satisfy these operations without any change to the pages or
controllers. They all exist today in `js/store.js` over the demo source:

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
Step 6 — `{ ok, items, total, page, pageSize, hasNext, hasPrev, error }` — so paging can
arrive with the API without touching a controller. Replacing the source is one call:
`PV.store.use(adapter)`, where an adapter supplies `catalogue()` (and optionally
`meta()`); `js/store.js` is the only file that mentions `js/data.js`.

### The demo dataset behind the model

The catalogue is deliberately mid-sized and unchanged by the migration:
**51 published listings (31 products, 20 services), 19 attached offers and 10 guide
outlines**, 45 providers, eight categories, 37 subcategories and 106 tags. Twelve
listings state a service area. Everything is demonstration data — no real products,
prices, sellers, offers or availability — and the homepage shows a *curated* slice
(`homeFeaturedIds`, `homeDealIds`, `homeGuideIds`).

## Architecture

### Current (Step 7)

```
page (HTML)
   ↓
controller (js/app.js, discover.js, deals.js, detail.js, compare.js, guides.js, listing.js)
   ↓
data access layer (js/store.js)      ← the only module that knows where records come from
   ↓
domain model (js/domain.js)          ← canonical shapes, vocabularies, normalisers, validators
   ↓
demo data source (js/data.js)
```

The interface layer (`js/core.js`) renders what the data layer returns and owns
browser-local user state (compare selection, recently viewed). No page reads
`js/data.js` directly, and no page knows which fields the file happens to use.

### Future (when the backend arrives)

```
page (HTML)
   ↓
controller
   ↓
data access layer (js/store.js)
   ↓
domain model (js/domain.js)
   ↓
API
   ↓
database
```

`js/store.js` already exposes the shape an API needs: the documented operations above,
the `{ ok, items, total, page, pageSize, hasNext, hasPrev, error }` envelope, and an
adapter seam (`store.use(adapter)`, `store.source()`, `store.isAsync()`). A backend
adapter is the only new code; pages, cards, comparison, deals, guides and search keep
working unchanged. **Step 7 does not implement that API** — there is still no server,
database, account, dashboard or payment anywhere in this project.

## Frontend structure (`js/`)

| File | Role |
| ---- | ---- |
| `data.js` | The demo catalogue only: `taxonomy`, `locations`, `sellers`, `listings`, `offers`, `guides` and the Step 5 decision-support config (`considerations`, `goodToKnow`, `compareFocus`, `compareGroups`, `needs`, `popularTags`). It is the *source*, not an API the pages use. |
| `domain.js` | **The domain model.** Canonical vocabularies, shape normalisers, label/format helpers (`money`, `priceText`, `locationLabel`, `availabilityInfo`, …) and the validators used by the store. No DOM, no network, no data. |
| `store.js` | **Data access layer.** Owns the demo adapter, normalises and validates every record against `js/domain.js`, and implements retrieval, search, filtering, sorting, related options, offers, guides, taxonomy, the homepage selections and the paged `query()` envelope. No DOM, no network, no user state. |
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

## Running it

Any static file server works, e.g.:

```bash
python3 -m http.server 8000
# then open http://localhost:8000/index.html
```

Opening `index.html` directly from the filesystem also works (no build step, no
bundler, no dependencies). The site is plain static HTML/CSS/JS, so it deploys to
Vercel (or any static host) without configuration.

## Deliberately not built in this stage

Accounts, authentication, seller/agent/admin areas, dashboards, database, API,
payments, checkout, messaging, real seller contact, favourites, notifications,
subscriptions, affiliate/referral tracking, commissions, recommendation
algorithm, AI, external product APIs, scraping, live pricing, real-time
inventory, reviews, ratings, testimonials, sales or popularity statistics.

The domain model is the *contract* those pieces will satisfy — it is not an
implementation of them.
