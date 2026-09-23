# PICKVANTA-v2
PickVanta — Make the smarter pick. Modern discovery and deals platform.

**Stage:** Step 4 — richer demo catalogue and discovery depth (Find → Discover → Inspect → Compare → Choose).
No database, no backend, no accounts, no payments, no external services, no live pricing.

---

## Views

| View | File | Purpose |
| ---- | ---- | ------- |
| Home | `index.html` | Landing page and primary entry point. Search → Discover results, categories → Discover (pre-filtered), deals → Deals, a how-it-works strip and a compare call-to-action that reflects any options already selected in the tray. |
| Discover | `discover.html` | Browse the whole demo catalogue: search, category strip, filters (category, **subcategory**, type, price range, location, availability), sort, result cards, active-filter chips and empty states. |
| Deals | `deals.html` | Offers attached to products and services: deal price, reference price, discount, seller, location, validity and conditions. |
| Detail | `detail.html?id=…` | One reusable detail template for any record (product or service), ordered as breadcrumb → identity → visual → type/category/subcategory → illustrative price (or range/unit) → seller/provider → location or service area → availability → highlights → actions → offer → specifications → related options. Related records explain *why* they appear (“same category”, “same kind of item”, “similar price”, “same area”). |
| Compare | `compare.html?ids=a,b,c` | Up to three options side by side, grouped into Overview / Price & offer / Provider & availability / Specifications. Specification rows are built from whatever attributes the compared records actually have, rows that are empty for every option are dropped, “Show differences only” hides identical rows, and small screens get a stacked card layout instead of a cramped table. “You decide what matters” — no scoring, no ranking, no winner. |
| Guides | `guides.html` | Guide outlines with category filtering and search. Each card states the question it answers and hides its topics behind a disclosure. Full articles are intentionally not written yet. |

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
* Related options on the detail page are deterministic matches on category, subcategory, type, tags, brand, price band and location. They are labelled “More in Technology” and each card shows its match reasons — there is no scoring, ranking or recommendation.

### Conventions

* Filter/sort/search state lives in the URL (`?q=&category=&sub=&type=&band=&location=&availability=&sort=`), so a filtered view can be linked and reloaded. A subcategory is only honoured together with its category, and switching category clears it.
* Comparison selection is a browser-only demo list (`localStorage`, max 3). It is not a favourites feature and is not stored on a server.
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
