# PICKVANTA-v2
PickVanta — Make the smarter pick. Modern discovery and deals platform.

**Stage:** Step 3 — Discovery and decision flow (Find → Discover → Inspect → Compare → Choose).
No database, no backend, no accounts, no payments, no external services, no live pricing.

---

## Views

| View | File | Purpose |
| ---- | ---- | ------- |
| Home | `index.html` | Landing page and primary entry point. Search → Discover results, categories → Discover (pre-filtered), deals → Deals, a how-it-works strip and a compare call-to-action that reflects any options already selected in the tray. |
| Discover | `discover.html` | Browse the whole demo dataset: search, category strip, filters (category, type, price range, location, availability), sort, result cards, empty states. |
| Deals | `deals.html` | Offers attached to products and services: deal price, reference price, discount, seller, location, validity and conditions. |
| Detail | `detail.html?id=…` | One reusable detail template for any record, ordered as breadcrumb → identity → visual → type/category → price → seller → location → availability → highlights → actions → offer → specifications → related options. Related records explain *why* they appear (“same category”, “shares audio”). |
| Compare | `compare.html?ids=a,b,c` | Up to three options side by side, grouped into Overview / Price & offer / Provider & availability / Specifications. Rows that differ are flagged, “Show differences only” hides identical rows, and small screens get a stacked card layout instead of a cramped table. No scoring, no ranking, no winner. |
| Guides | `guides.html` | Guide outlines with category filtering and search. Each card states the question it answers and hides its topics behind a disclosure. Full articles are intentionally not written yet. |

## Data model (`js/data.js`)

All demo content lives in one file, separate from the UI. Each record is shaped
so it can map onto a real database row later:

```
id, name, type ('product' | 'service'), category, subcategory, brand,
shortDescription, description, price { amount | min/max, unit }, referencePrice,
location { city, country, format }, seller { name, type, rating, verified },
image { icon | src, gradient, alt }, attributes [{ group, label, value }],
deal { dealPrice, referencePrice, discountPercent, validFrom, validTo, conditions[] } | null,
status, badge, tags[], listedAt, rating, highlights[]

guide: { id, title, question, category, icon, summary, readTime, level, covers[] }
```

Products and services are distinct `type` values. A **deal** is an offer attached
to a product or a service — it is never modelled as a product on its own.

`tags` are short keywords used only for local search and related-option matching.
Everything is demonstration data: no real products, prices, sellers, offers or
availability. The dataset is deliberately small (20 records, 9 offers, 6 guides);
every seller shown on a card or detail page is labelled as demo data.

## Frontend structure (`js/`)

| File | Role |
| ---- | ---- |
| `data.js` | Demo dataset + categories, types, statuses, price bands, sort options, guides. |
| `core.js` | Shared layer: DOM/format helpers, data access, search, filters, sort, card and empty-state builders, header/footer chrome, toast, compare selection store (in-memory + `localStorage`), search binding, filter/sort controls. |
| `listing.js` | The shared listing view behind Discover and Deals (search, categories, filters, sort, results, empty states, URL state). |
| `app.js` | Home page controller. |
| `discover.js`, `deals.js`, `detail.js`, `compare.js`, `guides.js` | One small controller per view. |

`css/styles.css` holds the existing design system plus a clearly-marked
“STEP 2 — discovery experience” section that reuses the same tokens, buttons,
cards, radii and shadows.

### Search rules

One implementation in `js/core.js` serves the homepage, Discover, Deals and Guides:

* case-insensitive and punctuation-tolerant;
* **word-prefix** matching, so `cancel` finds “cancelling” and `phone` finds “EdgePhone”;
* partial-word and cross-word matches are accepted with a lower score;
* every query term must match somewhere (AND), then results are ordered by relevance;
* fields searched: name, brand, category, subcategory, tags, seller, location, description and specification values.

### Compare tray and related options

* The tray is a compact bar that shows “N of 3 selected”, each selected option, individual remove buttons, Clear and a link into Compare. The page gets bottom padding while it is visible, so it never covers content, and on phones it collapses to a single row that expands on demand.
* A fourth selection is refused with an explanation and a hint to swap an option out.
* Related options on the detail page are deterministic matches on category, subcategory, type, tags, brand and price band. They are labelled “More in Technology” and each card shows its match reasons — there is no scoring, ranking or recommendation.

### Conventions

* Filter/sort/search state lives in the URL (`?q=&category=&type=&band=&location=&availability=&sort=`), so a filtered view can be linked and reloaded.
* Comparison selection is a browser-only demo list (`localStorage`, max 3). It is not a favourites feature and is not stored on a server.
* Toasts and `aria-live` regions announce selections; nothing is written anywhere else.
* Card actions stay deliberately unequal: one primary action plus the Compare toggle, so no card competes with itself.

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
