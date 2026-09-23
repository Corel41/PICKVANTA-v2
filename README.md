# PICKVANTA-v2
PickVanta — Make the smarter pick. Modern discovery and deals platform.

**Stage:** Step 5 — decision-support layer (Find → Discover → Inspect → Compare → Understand → Choose).
No database, no backend, no accounts, no payments, no external services, no live pricing.

---

## Views

| View | File | Purpose |
| ---- | ---- | ------- |
| Home | `index.html` | Landing page and primary entry point: search → Discover results, categories → Discover (pre-filtered), **Explore by need** shortcuts, featured options, a compare call-to-action that reflects the tray, demo deals, how-it-works, guides, and a **Recently viewed on this device** strip that only appears once the device has opened a detail page. |
| Discover | `discover.html` | Browse the whole demo catalogue: search, category strip, **popular tags** (`?tag=`), filters (category, subcategory, type, **tag**, price range, location, availability), sort, result cards, active-filter chips and contextual empty states with recovery paths. |
| Deals | `deals.html` | Offers attached to products and services: deal price, reference price, discount, seller, location, validity and conditions. |
| Detail | `detail.html?id=…` | One reusable template ordered as breadcrumb → identity → visual → type/category/subcategory → illustrative price → seller/provider → location or service area → availability → **Quick facts** → highlights → **What to consider** → actions → offer (**Price / Offer / Important context**) → specifications → **Good to know** → **Related options**. Products and services lead with different facts and prompts. Related records explain *why* they appear (“Why this appears: same subcategory · similar price · Nairobi”). |
| Compare | `compare.html?ids=a,b,c` | Up to three options side by side with a **Compare focus** selector (price, performance, features, portability, availability, location, specifications, service coverage, included services) that highlights matching rows and says “Your selected comparison areas are highlighted below.” Rows are grouped per category (products and services use different groups; unknown combinations fall back to the generic grouping), rows that are empty for every option are dropped, “Show differences only” hides identical rows, values that no other selected option shares are tinted (tint marks the difference, never superiority), and small screens get a stacked card layout. Equal treatment throughout — no scoring, ranking or winner. |
| Guides | `guides.html` | Guide outlines with category filtering and search. Each card states the question it answers, hides its topics behind a disclosure, and links into the matching slice of the catalogue (for example “How to choose a Wi-Fi router” → `discover.html?category=technology&sub=Networking`). Full articles are intentionally not written yet. |

## Data model (`js/data.js`)

All demo content lives in one file, separate from the UI. Each record is shaped
so it can map onto a real database row later:

```
id, name, type ('product' | 'service'), category, subcategory, brand,
shortDescription, description, price { amount | min/max, unit, currency: 'KES' },
referencePrice, location { city, country, format }, seller { name, type, rating, verified },
image { icon | src, gradient, alt }, attributes [{ group, label, value }],
deal { kind, headline, dealPrice, referencePrice, discountPercent,
       validFrom, validTo, conditions[] } | null,
status, badge, tags[], listedAt, rating, highlights[]

guide: { id, title, question, category, icon, summary, readTime, level, covers[] }
```

`deal.kind` records how the offer works — `percentage`, `fixed-price`, `bundle`,
`package`, `limited`, `billing` or `introductory` — so offers are not all phrased
as “20% off”. `deal.headline` carries the offer's own wording and is shown on the
deal card and in the detail-page offer box.

Products and services are distinct `type` values. A **deal** is an offer attached
to a product or a service — it is never modelled as a product on its own.

`tags` are short keywords used only for local search and related-option matching
(e.g. `budget`, `premium`, `student`, `business`, `portable`, `family`, `wireless`,
`fast`, `nairobi`). Products carry brands, models and specifications; services
carry a provider, service area, availability, turnaround or duration, what is
included and how the price is set.

Everything is demonstration data: no real products, prices, sellers, offers or
availability. Prices are illustrative Kenyan-Shilling figures spread across
budget (under KSh 5,000), mid-range (KSh 5,000–30,000) and premium
(KSh 30,000–100,000+) bands, and services are priced per month, night, session or
as a range. Locations are real towns (Nairobi, Mombasa, Kisumu, Nakuru, Eldoret,
plus Kiambu, Machakos, Thika and Naivasha) used as demonstration data only.

The catalogue is deliberately mid-sized — **51 records (31 products, 20 services),
19 attached offers and 10 guide outlines** across eight categories and 37
subcategories — and every seller, provider, price and offer on a card or detail
page is labelled as demo data. The homepage shows a *curated* slice
(`homeFeaturedIds`, `homeDealIds`, `homeGuideIds` in `js/data.js`); the full
catalogue lives in Discover.

## Frontend structure (`js/`)

| File | Role |
| ---- | ---- |
| `data.js` | Demo dataset + categories, types, statuses, price bands, sort options, guides, and the Step 5 decision-support config (`considerations`, `goodToKnow`, `compareFocus`, `compareGroups`, `needs`, `popularTags`) — configuration only, no rules engine and no second data file. |
| `core.js` | Shared layer: DOM/format helpers, data access (including the decision-support accessors), search, filters, sort, card and empty-state builders, header/footer chrome, toast, the compare selection store and the recently-viewed store (both `localStorage`), search binding, filter/sort controls. |
| `listing.js` | The shared listing view behind Discover and Deals (search, categories, filters, sort, results, empty states, URL state). |
| `app.js` | Home page controller. |
| `discover.js`, `deals.js`, `detail.js`, `compare.js`, `guides.js` | One small controller per view. |

`css/styles.css` holds the existing design system plus clearly-marked
“STEP 2 — discovery experience” and “STEP 5 — decision support” sections that
reuse the same tokens, buttons, cards, radii and shadows.

### Search rules

One implementation in `js/core.js` serves the homepage, Discover, Deals and Guides:

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
* **Quick facts** — a compact summary above the reading blocks: products lead with type, brand, price, location, availability, a key specification, condition/warranty and offer status; services lead with service type, provider, price, service area, turnaround and inclusions. A fact is only rendered when the record actually has it, so no row is ever empty and no `undefined`/`N/A` can appear.
* **Highlights** — taken from the record's own `highlights[]`, or read off its structured attributes when it has none. No invented facts.
* **Good to know** — general educational notes per category (RAM vs storage, advertised router speed vs real coverage, a starting price vs package scope). These are explicitly framed as general context, not claims about the demo provider.
* **Deal understanding** — offers are split into *Price* (deal price, reference price, discount), *Offer* (type, validity, status) and *Important context*, which states: “This is a demonstration offer. PickVanta does not process the transaction.” There is no checkout and no payment control anywhere.
* **Explore by need** — deterministic shortcuts on the homepage (Technology, Home, Automotive, Services) that map to a tag filter or a search, e.g. `discover.html?tag=student`. No separate page per need.
* **Tags** — `?tag=` integrates with the existing URL state, appears as a popular-tag strip and an in-panel filter group (the long tail sits behind a “More tags” disclosure), and never breaks an existing link.
* **Recently viewed** — up to five ids kept in `localStorage` under `pickvanta.recent.v1`, newest first, no duplicates, stale ids pruned on load, shown on the homepage as “Recently viewed on this device” with a Clear control. It is separate from the comparison selection and is not a favourites system.
* **Empty states** — “Nothing matches these filters” / “No options found” explain what is active, offer the popular categories, related tags, example searches and a one-click reset. Nothing is ever fabricated to fill a grid.
* **Compare focus** — the visitor chooses the areas that matter to them; matching rows are highlighted, and the tool states when a chosen area has nothing to match in the current comparison. It never scores, ranks or picks a winner.

### Conventions

* Filter/sort/search state lives in the URL (`?q=&category=&sub=&tag=&type=&band=&location=&availability=&sort=`), so a filtered view can be linked and reloaded. A subcategory is only honoured together with its category, switching category clears it, and an unknown tag is ignored rather than emptying the page.
* Comparison selection is a browser-only demo list (`localStorage`, max 3). It is not a favourites feature and is not stored on a server. Recently viewed is a separate list with its own key.
* Verdict-free by construction: no winner badges, no scores, no rankings, no “recommended for you”. The words only ever appear in copy that denies them, and a checklist asserts that no heading, button or badge carries them.
* Toasts and `aria-live` regions announce selections; nothing is written anywhere else.
* Card actions stay deliberately unequal: one primary action plus the Compare toggle, so no card competes with itself.
* Cards show `Category · Subcategory` and a Product/Service chip; detail pages, search and related-option matching use the same subcategory values.
* Prices are rendered as `KSh 12,400` (or `KSh 3,500 – KSh 6,500`, `KSh 1,600/month`) by one formatter in `js/core.js`.

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
inventory.
