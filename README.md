# PICKVANTA-v2
PickVanta — Make the smarter pick. Modern discovery and deals platform.

**Stage:** Step 2 — Discovery experience (frontend structure + demo data).
No database, no backend, no accounts, no payments, no external services, no live pricing.

---

## Views

| View | File | Purpose |
| ---- | ---- | ------- |
| Home | `index.html` | Existing landing page. Every section now leads into a real view: categories → Discover (pre-filtered), deals → Deals, cards → Detail, search → Discover results. |
| Discover | `discover.html` | Browse the whole demo dataset: search, category strip, filters (category, type, price range, location, availability), sort, result cards, empty states. |
| Deals | `deals.html` | Offers attached to products and services: deal price, reference price, discount, seller, location, validity and conditions. |
| Detail | `detail.html?id=…` | One reusable detail template for any record: main information, key attributes (grouped from the record), seller/availability, deal block, actions, related records. |
| Compare | `compare.html?ids=a,b,c` | Up to three options side by side. Rows that differ are flagged; a “differences only” filter and a mobile stacked layout are included. No scoring, no ranking, no winner. |
| Guides | `guides.html` | Guide outlines with category filtering and search. Full articles are intentionally not written yet. |

## Data model (`js/data.js`)

All demo content lives in one file, separate from the UI. Each record is shaped
so it can map onto a real database row later:

```
id, name, type ('product' | 'service'), category, subcategory, brand,
shortDescription, description, price { amount | min/max, unit }, referencePrice,
location { city, country, format }, seller { name, type, rating, verified },
image { icon | src, gradient, alt }, attributes [{ group, label, value }],
deal { dealPrice, referencePrice, discountPercent, validFrom, validTo, conditions[] } | null,
status, badge, tags, listedAt, rating, highlights
```

Products and services are distinct `type` values. A **deal** is an offer attached
to a product or a service — it is never modelled as a product on its own.

Everything is demonstration data: no real products, prices, sellers, offers or
availability. The dataset is deliberately small (20 records, 9 offers, 6 guides).

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

### Conventions

* Filter/sort/search state lives in the URL (`?q=&category=&type=&band=&location=&availability=&sort=`), so a filtered view can be linked and reloaded.
* Comparison selection is a browser-only demo list (`localStorage`, max 3). It is not a favourites feature and is not stored on a server.
* Search matches names, descriptions, categories, brands, sellers and specification values over the local dataset. No network requests are made anywhere in this build.

## Running it

Any static file server works, e.g.:

```bash
python3 -m http.server 8000
# then open http://localhost:8000/index.html
```

Opening `index.html` directly from the filesystem also works (no build step, no
bundler, no dependencies).

## Deliberately not built in this stage

Accounts, authentication, seller/agent/admin areas, dashboards, database, API,
payments, checkout, messaging, real seller contact, favourites, notifications,
subscriptions, affiliate/referral tracking, commissions, recommendation
algorithm, AI, external product APIs, scraping, live pricing, real-time
inventory.
