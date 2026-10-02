# PICKVANTA-v2
PickVanta — Make the smarter pick. Modern discovery and deals platform.

**Stage:** Step 14 — the Deal Engine's operational layer — plus a database security
hardening pass (migration `0007`). The public catalogue is unchanged and no new product
behaviour was added by the hardening: it pins the `search_path` of every database function,
restores the privilege layer under the catalogue's Row Level Security, and closes the public
schema to object creation. See
[Database Security Hardening](#database-security-hardening-migration-0007).
The admin panel holds two operational Deal Engine areas beside the
seller/provider review queue. An administrator signs in like anybody else and opens
`admin.html`: a dashboard of real row counts, a queue of applications to review with
**Approve**, **Reject**, **Suspend** and **Archive**, a list of Deal Engine **sources** that
can be added and edited through a database function that checks `public.is_admin()` for
itself, and a read-only list of Deal Engine **jobs** — which nothing in this build runs.
Everybody else — signed out, or signed in without the role — is refused by the page *and* by
the database, and the page requests no admin data at all until the database has confirmed
the role.

Step 11 still stands underneath it: a person applies to sell products or provide services,
the application is stored `pending`, and the account page shows its real status.

The catalogue is unchanged and still comes from PostgreSQL on Supabase through the
read-only data API (`js/store.js`), whose only write path is now that one application. There
is one account system, one `profiles` row per person, and `role` (`user` \| `admin`) is
decided by the database — never the browser, and never by applying. Participation is an
entity plus ownership, not a role, so one person may later run more than one business.
`js/auth.js` remains the only module that talks to Supabase Auth, and the public catalogue
stays fully browsable without an account.

Still absent: no seller or provider dashboard, no listing tools, no public merchant offers
or affiliate links, no payments, no live pricing, and no browser writes to the catalogue.
The admin panel reviews accounts, counts rows, configures Deal Engine sources, lists Deal
Engine jobs and reads the canonical catalogue — it manages no products, no categories and
no imports, and nothing it can do publishes anything.

**The Deal Engine has a foundation and an operational layer, and nothing is connected to
it.** The database models where imported deals come from, what arrived, what happened to it
and where it sits in the import pipeline, and an administrator can now configure a source
and read the job records — but there is still no connector, no scraper, no merchant API, no
affiliate network, no worker, no schedule, no job execution and no automatic publishing.
See [The Deal Engine](#the-deal-engine-step-13) and
[the operational layer](#the-operational-layer-step-14).

> **The seller/provider migration (`db/migrations/0003_seller_provider_profiles.sql`), the
> admin dashboard migration (`db/migrations/0004_admin_dashboard.sql`), the Deal Engine
> foundation (`db/migrations/0005_deal_engine_foundation.sql`), the Deal Engine
> operations migration (`db/migrations/0006_deal_engine_operations.sql`) and the security
> hardening migration (`db/migrations/0007_security_hardening.sql`), the canonical
> catalogue (`db/migrations/0008_canonical_catalogue.sql`) and the relationship-integrity
> migration (`db/migrations/0009_canonical_relationship_integrity.sql`) are written but have
> not been applied to any project.** Run `0001`, `0002`, `0003`, `0004`, `0005`, `0006`,
> `0007`, `0008` and `0009` in that order, then the seed. Until `0003` is applied, the onboarding page says
> plainly that applications need the live catalogue connection rather than offering a form
> that cannot be stored, and until `0005` and `0006` are applied the Deal Engine areas say
> the same. `0007` changes no behaviour the site depends on; it tightens privileges and
> function settings, and refuses to report success unless every property it is responsible
> for is true afterwards. See [Applying the schema](#applying-the-schema-and-the-seed).
>
> **Google Sign-In is implemented and configured.** The Google provider is enabled on the
> current Supabase project with its Client ID and Client Secret held by Supabase (never by
> this repository and never by the browser), and the operator has completed and confirmed a
> Google sign-in on the deployed site. The implementation in `js/auth.js` is the same
> single abstraction email/password uses. A *different* project would need the same
> one-time provider setup — see
> [Google Sign-In](#google-sign-in) for what is involved. Environment and deployment notes
> that still apply are in that section too.

---

## Views

| View | File | Purpose |
| ---- | ---- | ------- |
| Home | `index.html` | Landing page and primary entry point: search → Discover results, categories → Discover (pre-filtered), **Explore by need** shortcuts, featured options, a compare call-to-action that reflects the tray, demo deals, how-it-works, guides, and a **Recently viewed on this device** strip that only appears once the device has opened a detail page. |
| Discover | `discover.html` | Browse the whole demo catalogue: search, category strip, **popular tags** (`?tag=`), filters (category, subcategory, type, **tag**, price range, location, availability), sort, result cards, active-filter chips and contextual empty states with recovery paths. |
| Deals | `deals.html` | Offers attached to products and services: offer price, original price, discount, seller, location, validity and conditions. Each card states that the offer belongs to the listing underneath it. |
| Detail | `detail.html?id=…` | One reusable template ordered as breadcrumb → identity → visual → type/category/subcategory → illustrative price → seller/provider → location or service area → availability → **Quick facts** → highlights → **What to consider** → actions → offer (**Price / Offer / Important context**) → specifications → **Good to know** → **Related options**. Products and services lead with different facts and prompts. Related records explain *why* they appear (“Why this appears: same subcategory · similar price · Nairobi”). |
| Compare | `compare.html?ids=a,b,c` | Up to three options side by side with a **Compare focus** selector (price, performance, features, portability, availability, location, specifications, service coverage, included services) that highlights matching rows and says “Your selected comparison areas are highlighted below.” Rows are grouped per category (products and services use different groups; unknown combinations fall back to the generic grouping), rows that are empty for every option are dropped, “Show differences only” hides identical rows, values that no other selected option shares are tinted (tint marks the difference, never superiority), and small screens get a stacked card layout. Equal treatment throughout — no scoring, ranking or winner. |
| Account | `account.html` | Sign in, create an account, or — when signed in — see the account the database knows about (email, account status, role), find **Sell or provide on PickVanta** (start an application, or see each existing one with its current status) and sign out. In demonstration mode the page says plainly that accounts need the live catalogue; it never fakes a sign-in. |
| Admin | `admin.html` | **Steps 12–13.** The operational panel, for administrators only: a dashboard of live row counts (applications by status, published listings, active offers), the **seller and provider review queue** — filter by status, open an application, read its details and its review history, and approve, reject, suspend or archive it — and the Deal Engine's **Sources**, which lists where imported deals will come from and states plainly that no connector reads them yet. Reachable as `admin.html?section=dashboard\|sellers\|sources`. Sent to `noindex`; nothing is linked to it from the public pages, and no admin request is made until the database has confirmed the role. |
| Sell or provide | `sell.html` | **Step 11.** Apply to run a seller (products) or provider (services) account: choose the type, describe the business, submit, and read the outcome. Existing applications are listed with their real status; a pending one can be edited. Nothing here publishes a listing, and the page never claims an approval the database did not give. |
| Guides | `guides.html` | Guide outlines with category filtering and search. Each card states the question it answers, hides its topics behind a disclosure, and links into the matching slice of the catalogue (for example “How to choose a Wi-Fi router” → `discover.html?category=technology&sub=Networking`). Full articles are intentionally not written yet. |

## PickVanta Domain Model

Step 7 gave the project one explicit data contract, and Step 8 serves it from a real
database. Every record the interface sees has been normalised and validated by
`js/domain.js` and handed over by `js/store.js`; no page, card or controller knows how
the record is stored — or whether it came from PostgreSQL over the read-only API or from
the bundled demonstration catalogue. Step 9 adds authentication on top of that contract
without changing it: accounts live beside the catalogue
([Database](#database-supabase--postgresql) → Authentication), and **seller accounts, a
write path into the catalogue and payments are still not implemented** — this section
documents the contract they will have to satisfy.

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

### Current (Steps 11–17A)

There are two paths, and they are deliberately separate. Browsing is public; an account
is only needed for the parts of the product that belong to a person. Behind them, and
reachable from neither, sits the admin panel with its review queue, the Deal Engine's
private records and the read-only canonical catalogue — a third area that only a
database-confirmed administrator can read.

```
public catalogue                              authenticated features
────────────────                              ─────────────────────────────────────────────
page (HTML)                                   page (HTML)          page (HTML)
   ↓                                             ↓                    ↓
controller (discover.js, deals.js,            controller           controller (sell.js) —
            detail.js, compare.js,            (account.js) —       the seller/provider
            guides.js, listing.js)            the account page     onboarding page
   ↓                                             ↓                    ↓
data access layer (js/store.js)               authentication layer (js/auth.js)
   ← the only module that knows where            ← the only module that talks to
     records come from                             Supabase Auth and reads the profile
   ↓                                             ↓
domain model (js/domain.js) — canonical shapes, vocabularies, normalisers, validators
   ↓
one of two adapters (both inside js/store.js):
  • Supabase adapter — read-only catalogue REST calls; the writes are a person's own
    seller/provider application and an administrator's review action
                                                              →  PostgreSQL on Supabase
  • demo adapter     — the bundled demonstration catalogue in js/data.js, loaded on
                       demand, and an honest refusal to store applications or serve
                       the admin panel
```

The admin panel is the same architecture, one namespace over:

```
admin.html → js/admin.js ──► PV.store.admin.{counts,accounts,account,review} ──► PostgreSQL
                             PV.store.dealEngine.{sources,jobs,importedDeals,merchants,
                                                  createSource,updateSource}
                             PV.store.canonical.{products,variants,offers,counts}
                             (js/store.js — the only module that talks to the database)
                             the database decides: is_admin(), the row policies, the
                             review function, and the counts function
```

Since Step 15 the panel also reads the canonical layer — `PV.store.canonical.products()`,
`.variants(productId)`, `.offers()` and `.counts()`, all of them `SELECT`-only and gated on
`is_admin()` by the policies in `0008`. There is no write method in that namespace: the
canonical tables grant no client a write privilege, so a create or edit here would fail
anyway, and the point of the layer is that nothing in a browser decides what a product is.

Both authenticated pages read through the same layer. `js/sell.js` and `js/account.js`
issue no request of their own: they ask `js/store.js`, which asks the database with the
person's own token, and they are given either a normalised account or a sentence to show.

`js/core.js` renders what the data layer returns and owns browser-local user state
(compare selection, recently viewed). No page reads `js/data.js`, no page issues a
network request, and no page knows which source answered. The comparison selection and
the recently-viewed list stay in the browser: the database is the catalogue, not a place
for personal state.

Authentication is its own capability with its own boundary. Controllers ask `PV.auth`
who is signed in; they never talk to Supabase Auth themselves and never keep a second
copy of the session — that is how authentication logic drifts. The catalogue keeps
working with `js/auth.js` absent, and `js/auth.js` knows nothing about listings.

**Providers are data, not code paths.** Email/password and Google both go through Supabase
Auth, so there is one account system rather than two, and one `profiles` row per person
whichever way they arrived:

```
PickVanta auth layer (js/auth.js)
        │
        ▼
Supabase Auth  ─── email + password   POST /auth/v1/token?grant_type=password
        │      └── Google            GET  /auth/v1/authorize?provider=google
        │                                  → accounts.google.com → /auth/v1/callback
        │                                  → back to the app with the session
        ▼
auth.users  ──trigger──▶  public.profiles (id = auth user id, email, display_name, role)
```

Starting an OAuth sign-in is the same request for every provider, so adding Apple later is
an entry in `PROVIDERS` plus that provider's configuration in the Supabase project — not
another authentication architecture. What is provider-specific (a client id, a client
secret) lives only in the Supabase project's own settings; it is never in this repository
and never in the browser.

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

The namespace is called `PV.store.catalogue()` because it answers a question about wording —
which catalogue is on screen. The **data** namespace for the canonical layer is
`PV.store.canonical`, deliberately a different name for a different thing.

There is no demonstration version of a canonical record: in `demo` mode the canonical reads
refuse (`api-not-configured`) exactly as the admin and Deal Engine reads do, because an
invented product would be a fabricated record, not a demonstration.

### Not in this stage

Listing creation, product management, payments, checkout, messaging, notifications,
subscriptions, reviews, ratings, passwordless sign-in, multi-factor authentication,
account deletion — and Apple Sign-In, which is *not* implemented: Google is the only
social provider in this step. Nothing in the browser can write to the catalogue: the data
API stays read-only for anon and for a signed-in user alike, `profiles` is the only table a
signed-in person can touch — their own row, `display_name` only — and the canonical
catalogue (`products`, `product_variants`, `merchant_offers`, their media and the conversion
link) accepts no table write from anyone, an administrator included: canonical records are
created only by `public.imported_deal_convert()`, which an administrator calls from the
review queue and which validates every value itself.

## Database (Supabase / PostgreSQL)

The catalogue is data, not markup: eight catalogue tables with real keys and constraints,
a maintained search column, Row Level Security and three read-only functions. Step 9 adds
a ninth table — `profiles` — which is about people, not products. The browser can read
the catalogue and nothing else; the only row a signed-in person can write is their own
`profiles` row, and only its display name.

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
| `profiles` | **Step 9.** one row per authenticated person: `id` (= the Supabase Auth user id), `email`, `display_name`, `role` (`user` \| `admin`, default `user`), `created_at`, `updated_at`. Credentials are **not** here — Supabase Auth owns the password and the session | `id → auth.users(id)` on delete cascade; created and kept in step by triggers on `auth.users` |
| `seller_provider_profiles` | **Step 11.** one row per business a person applies to run: `owner_id`, `account_type` (`seller` \| `provider`), `business_name`, `description`, contact email/phone/website, structured location (`country`, `county`, `city`, `area`), `status` (`pending` \| `active` \| `suspended` \| `rejected` \| `archived`), the review columns, and a nullable `seller_id` | `owner_id → auth.users(id)` on delete cascade — **not unique**, because one person may later own several businesses; `seller_id → sellers(id)` on delete set null, unique when set |

Steps 13 and 15 add eleven more tables, none of which the public catalogue reads: the six
private Deal Engine tables (`deal_sources`, `external_merchants`, `imported_deals`,
`imported_deal_media`, `deal_engine_jobs`, `deal_engine_events` — listed in
[The Deal Engine](#the-deal-engine-step-13)) and the five canonical ones
(`products`, `product_variants`, `merchant_offers`, `merchant_offer_media`,
`imported_deal_conversions` — listed in
[The canonical catalogue](#the-canonical-catalogue-step-15)). Every one of them has Row
Level Security enabled, is readable only by a database-confirmed administrator, and accepts
no write from a browser: the only way a browser can create a canonical record is to call
`public.imported_deal_convert()` (Step 16), which checks `is_admin()` for itself and
validates everything before it writes.

### Database functions

`0008` adds **no** function: the canonical layer is read directly through its policies.
`0010`, the reviewed conversion, adds the single function that fills it.

| Function | Migration | Who may call it | What it does |
| -------- | --------- | --------------- | ------------- |
| `catalogue_stats()`, `catalogue_tags()`, `catalogue_facets()` | `0001` | `anon`, `authenticated` | Return counts, tags and facets for the published catalogue |
| `is_admin()` | `0002` | anyone (it answers about the caller) | `true` when the caller's own `profiles.role` is `admin` |
| `seller_profile_set_status(uuid, text, text)` | `0003` | `authenticated`, and the function checks `is_admin()` itself | The review action: validates the status, records the reviewer and the time, returns the row it wrote |
| `seller_profile_set_seller(uuid, text)` | `0003` | as above | Links an approved account to its public catalogue record (used by a later stage) |
| `admin_dashboard_counts()` | `0004` | `authenticated`, and the function checks `is_admin()` itself | Returns the dashboard's row counts as one jsonb object — counts only, never rows |
| `imported_deal_convert(uuid, jsonb, jsonb, text, text)` | `0010` | `authenticated`, and the function checks `is_admin()` itself | The reviewed conversion: validates everything, creates or reuses the product, variant and merchant offer, records the decision, moves the imported record to approved, appends one event, and returns what the database now holds |

`0005` defines **no function at all**: its tables are read through RLS by an administrator
and written by nothing in this stage. When the pipeline needs to write — recording an import,
advancing a stage — that write belongs in a function with its own validation, added in the
step that builds it, rather than in a policy that lets a client write untrusted data.

JSON is used only where a value genuinely is a document (specification rows, image
entries, guide sections, `service_area text[]`, settings values). Every relationship
that is a relationship is a foreign key; there is no record that stores an array of ids
in place of a join table, and no column holds HTML or a pre-formatted price.

### Applying the schema and the seed

```bash
# in the Supabase dashboard → SQL editor, run in this order:
db/migrations/0001_catalogue.sql              # tables, constraints, indexes, triggers, RLS, functions
db/migrations/0002_auth_profiles.sql          # profiles, roles, is_admin(), RLS, column grants
db/migrations/0003_seller_provider_profiles.sql  # seller/provider accounts, RLS, review functions
db/migrations/0004_admin_dashboard.sql           # admin_dashboard_counts(), is_admin()-gated
db/migrations/0005_deal_engine_foundation.sql    # imported deals: sources, records, media, jobs, events
db/migrations/0006_deal_engine_operations.sql    # the Deal Engine's admin-only source function
db/migrations/0007_security_hardening.sql         # search_path pins, catalogue privileges, schema CREATE
db/migrations/0008_canonical_catalogue.sql        # Product → Variant → Merchant Offer, read-only to clients
db/migrations/0009_canonical_relationship_integrity.sql  # the conversion's product, variant and offer must agree
db/migrations/0010_imported_deal_conversion.sql   # the reviewed conversion: one imported record → canonical records
db/seed/0001_catalogue.sql                    # the catalogue, upserted by primary key

# or from a terminal with a connection string (never committed):
psql "$DATABASE_URL" -f db/migrations/0001_catalogue.sql \
                     -f db/migrations/0002_auth_profiles.sql \
                     -f db/migrations/0003_seller_provider_profiles.sql \
                     -f db/migrations/0004_admin_dashboard.sql \
                     -f db/migrations/0005_deal_engine_foundation.sql \
                     -f db/migrations/0006_deal_engine_operations.sql \
                     -f db/migrations/0007_security_hardening.sql \
                     -f db/migrations/0008_canonical_catalogue.sql \
                     -f db/migrations/0009_canonical_relationship_integrity.sql \
                     -f db/seed/0001_catalogue.sql
```

`0003_seller_provider_profiles.sql` must run **after** `0001` and `0002`,
`0004_admin_dashboard.sql` after `0003`, and `0005_deal_engine_foundation.sql` after `0001`,
`0002` and `0004` — each one refuses to run otherwise, naming the file it needs — and each
ends with a self-check that fails the migration if a policy, a grant, a constraint or a
function is not what it should be. Like the others they are idempotent: re-running one
replaces its triggers, policies and functions.

`0006_deal_engine_operations.sql` runs after `0005`, `0002` and `0001`, and refuses
otherwise for the same reason. `0007_security_hardening.sql` runs after `0006`, `0005`, `0002`
and `0001`, and also refuses otherwise. `0008_canonical_catalogue.sql` runs after `0005` (it
references `deal_sources`, `external_merchants` and `imported_deals`), and after `0002` and
`0001`; it refuses, naming the file it needs, if any of them is missing.
`0009_canonical_relationship_integrity.sql` runs after `0008`, and refuses otherwise: it
constrains the conversion records `0008` created.

**What each migration is about:** `0001` is the catalogue, `0002` is people, `0003` is a
person's application to run a business, `0004` is the one counting function the admin
dashboard needs, `0005` is the private side of imported deals, `0006` is the one function
that lets an administrator configure a source, `0007` is the security hardening pass over
all of it — see [Database Security Hardening](#database-security-hardening-migration-0007) —
`0008` is the canonical catalogue the Deal Engine's imported records are eventually
resolved into — see [The canonical catalogue](#the-canonical-catalogue-step-15) — and `0009`
makes the relationships inside that catalogue something the database checks rather than
something an application is trusted to have checked. No migration alters an earlier one, and
none of them creates a table the public catalogue reads. `0007` is
the only one that changes no object definition at all: it alters function settings and
revokes privileges.

`0002_auth_profiles.sql` is separate from the catalogue migration because it is a
different concern: `0001` is the catalogue, `0002` is people. Run `0002` **after** your
project has Supabase Auth enabled (it always is) — it reads `auth.users`, and it checks
for the two things it depends on before it changes anything.

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
* **`profiles` is a different kind of table, and its rules are stricter.** Row Level
  Security is enabled on it; the only policies are `select`/`insert`/`update` **own row**
  (`auth.uid() = id`). There is no public profile read at all, no delete policy, and
  `anon` is explicitly revoked, so a signed-out visitor cannot read a single profile.
* **Role is decided by the database.** `public.is_admin()` is `security definer` and reads
  `role` from `profiles` for `auth.uid()`; the browser cannot write `role` (there is no
  column grant for it, the `profiles_guard_role()` trigger rejects any attempt, and
  `profiles_insert_own` refuses a row whose role is not `'user'`). `PV.auth.isAdmin()` is
  convenience for the interface only — hiding a control is never authorization.
* Giving somebody the `admin` role is a deliberate, out-of-band action — one SQL
  statement, by an operator, with the dashboard or `psql`:
  ```sql
  update public.profiles set role = 'admin' where email = 'you@example.com';
  ```
* `profiles` is created and kept in step by triggers on `auth.users`
  (`on_auth_user_created`, `on_auth_user_email_changed`), so a profile can never drift
  from the account it describes, and a client that signs up cannot skip it.
* **OAuth adds no new authorization surface.** The callback is not a bypass: the session it
  carries is confirmed with `/auth/v1/user` before it is trusted, the profile is read with
  that same user's token, and every rule in this section applies to a Google account exactly
  as it does to an email one.
* **`seller_provider_profiles` is the one table a person may write (Step 11), and it is
  narrowly governed.** Row Level Security is enabled; `anon` is revoked outright (it holds
  no privilege at all, so a visitor gets a permission error, not an empty list). A signed-in
  person can:
  * `select` only their own rows (`owner_id = auth.uid()`), plus an administrator, who needs
    to see what is waiting for review;
  * `insert` only a row whose `owner_id` is themselves, whose `status` is `'pending'` and
    whose `seller_id` is null;
  * `update` only their own **pending** row, and only the nine detail columns
    (`business_name`, `description`, `contact_email`, `contact_phone`, `website`, `country`,
    `county`, `city`, `area`).
* **What a client cannot do is enforced three times over**, and none of it is JavaScript:
  1. the **column grant** means `id`, `owner_id`, `account_type`, `status`, `seller_id`,
     `reviewed_at`, `reviewed_by` and `review_note` are not updateable by a client at all —
     a request naming them is refused by the database;
  2. the **policy** means an approved account is no longer in the set of rows its owner can
     update, and another person's row was never in it;
  3. the **`seller_profiles_guard()` trigger** refuses ownership changes, status changes,
     catalogue links and review columns even if a future policy were written carelessly.
     It is deliberately *not* `security definer`: it runs as the caller, so it cannot be
     side-stepped with the function's own rights.
* **Approval is an administrator action and only that.** `seller_profile_set_status(uuid, text,
  text)` and `seller_profile_set_seller(uuid, text)` are `security definer` functions that
  begin with `if not public.is_admin() then raise exception …`, and execution is granted to
  `authenticated` only (`anon` is revoked). Status is a closed set —
  `pending | active | suspended | rejected | archived` — and the function validates it and
  records `reviewed_at`, `reviewed_by` and an optional note. There is **no** delete policy and
  no delete privilege, so an application cannot be removed from the browser.
* **Being signed in is not the same as being a merchant, and being a merchant is not a role.**
  Roles stay `user` and `admin`. Participation is an entity plus ownership: a person who
  applies owns a `seller_provider_profiles` row, and nothing else changes. There is no fourth
  role to self-assign, no client-side role switch, and `PV.auth` never reads a role from
  `localStorage` — the only role it knows is the one the database returned with the profile.
* **Private contact details are never public.** The catalogue's reads select from catalogue
  tables only; the account table is named by exactly three requests, all of them the signed-in
  person's own, and no public page mentions or renders an account field. A person's phone
  number is visible to them and to an administrator reviewing the application — nobody else.
* **Administrative access is the same role, checked one layer further down (Step 12).** The
  admin panel reads `PV.auth.isAdmin()` to decide what to draw, and that value comes from the
  person's own `profiles` row. What makes the panel safe is not that check, however: it is
  that a non-administrator's requests fail on their own.
  * `seller_profiles_select_admin` is the **only** policy that lets anybody read another
    person's application, and it is written `using (public.is_admin())` — evaluated by the
    database for the caller's own token;
  * `seller_profile_set_status()` and `seller_profile_set_seller()` begin with
    `if not public.is_admin() then raise exception …` (errcode `42501`), and executing them
    is granted to `authenticated` only, with `anon` revoked;
  * `admin_dashboard_counts()` is the same shape, and returns counts only — no ids, no
    names, no contact details;
  * a crafted URL (`…&role=admin`, a chosen `section`, a chosen `id`) grants nothing: the
    address is validated for syntax, never trusted for authority, and the page requests no
    admin data until the role is confirmed. The test suite asserts exactly that — a signed-in
    member loading `admin.html?section=sellers&id=…` makes **zero** requests to the private
    table.
* **The review action is not a column write.** Approving, rejecting, suspending and archiving
  all go through the one function written for it; the browser cannot write `status`,
  `review_note`, `reviewed_at`, `reviewed_by`, `seller_id`, `owner_id` or `account_type` at
  all (no column grant, plus the guard trigger). There is no delete policy and no delete
  privilege, so nothing in the panel can remove an application.
* The browser only ever holds the public anon key plus the session token its own sign-in
  produced. There is no OAuth client secret, no Google client id and no service-role key in
  any file served to a browser — see `.gitignore` for the secrets that must never be
  committed. The service-role key, the database password and the connection string stay
  out of the repository (see `.gitignore`) and out of the browser.

### Authentication (Supabase Auth)

**Supported providers, currently: email + password and Google.** Both are ordinary
Supabase Auth providers; nothing about an account depends on which one was used.

| Concern | Where it lives |
| ------- | -------------- |
| Accounts, passwords, sessions, email confirmation, Google OAuth | **Supabase Auth** (`/auth/v1/…`) — the project's own authentication service. Passwords are never stored, logged or seen by this codebase, and the Google client secret never leaves Supabase |
| The session in the browser | `localStorage` key `pickvanta.auth.session.v1` — a bearer token with an expiry and a refresh token. It is not a credential and it is not trusted on its own |
| Everything the frontend decides | `js/auth.js` (`PV.auth`) — sign-up, sign-in, sign-out, restore, refresh, friendly messages |
| Who the person is, and their role | the `profiles` row, read with the person's own token, so RLS applies |
| What they are allowed to do | the database. The interface may hide a control; only RLS, the grants and `is_admin()` decide |

**A session is never invented.** `js/auth.js` reports a signed-in state only after
`/auth/v1/user` has confirmed the stored token; a token the server rejects is dropped and
the visitor continues as a signed-out visitor — the catalogue is public, so nothing is
lost. If the account service cannot be reached, the state stays signed-out and the page
says so; there is no offline or demo sign-in, and demonstration mode says accounts are
unavailable instead of pretending.

**Errors are written for people.** Invalid email, weak password, mismatched passwords,
wrong credentials, an existing account, an expired session, a network failure and an
unavailable service each become a plain sentence. Raw Supabase or PostgreSQL text never
reaches the screen, and a failed sign-in leaves no half-signed-in user behind.

#### Signing in with Google

1. The account page asks this project's own Supabase Auth which providers it offers
   (`GET /auth/v1/settings`, public, no session). A provider the project has switched off
   is not offered — the page says Google is not enabled for this project instead of
   showing a button that cannot work.
2. **Continue with Google** navigates to
   `https://<project>.supabase.co/auth/v1/authorize?provider=google&redirect_to=…`. The
   only values in that URL are the provider name and this app's own return address. The
   Google client id and secret are held by Supabase, which is the only party that talks to
   Google.
3. Google returns to Supabase's `/auth/v1/callback`, and Supabase sends the person back to
   the page they started from with the session in the URL **fragment** (the OAuth implicit
   flow — a fragment is not sent to any server, so the token cannot land in a request log).
4. `js/auth.js` reads that fragment, builds the session and then **confirms it against
   `/auth/v1/user` before trusting it** — exactly the same rule as a session restored from
   storage. A callback cannot sign anybody in on its say-so.
5. The profile is read with that user's own token, so Row Level Security applies. A new
   account already has a `profiles` row, created by the `auth.users` trigger with the
   default `user` role. (If a row were ever missing, the signed-in user may create exactly
   one — their own, with the default role; see below.)
6. The fragment is removed from the address bar as soon as it has been read, so a token is
   never left in the URL, the history or a copied link.

**Cancelled, failed and misconfigured returns** are all handled, and each becomes one plain
sentence: the consent screen being dismissed (“Google sign-in was cancelled…”), a provider
or project problem (“…not fully configured for it. Signing in with your email address still
works.”), a stale return, a session the server refuses, and the account service being
unreachable. None of them creates a session or a profile, and none of them shows raw
provider or database text.

#### Google Sign-In

**Implemented, and configured on the current project.** The provider is enabled in the
Supabase project's Authentication settings, the operator has completed a real Google
sign-in against the deployed site, and the account page reads
`/auth/v1/settings` on every visit so the button reflects the provider's true state rather
than a guess.

**This repository contains the implementation, not the credentials** — and that has not
changed. Nothing below is committed, and none of it belongs in the repository: it is
configuration for a Google Cloud project and a Supabase project, both owned by the
operator. What follows is therefore the **reference setup for a new or replacement
project**, not a task outstanding on this one.

**Google Cloud Console** (APIs & Services → Credentials → Create credentials → OAuth client
ID → Web application) — already done for the current project:

| Setting | Value |
| ------- | ----- |
| Authorized JavaScript origins | the site's origins, e.g. `https://YOUR-PROJECT.vercel.app` and, for local work, `http://localhost:8000` (and `http://127.0.0.1:8000` if you use that form) |
| Authorized redirect URIs | `https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback` — Supabase's callback, **not** the site. For local Supabase CLI work, `http://127.0.0.1:54321/auth/v1/callback` |

The redirect URI must point at Supabase: Google talks to Supabase, and Supabase talks to
this app. Pointing it at the site itself produces the classic `redirect_uri_mismatch`.

**Supabase dashboard** (Authentication → Providers → Google): enable the provider and paste
the **Client ID** and **Client Secret** from the step above — already done for the current
project. They are stored in the Supabase project and are never needed — or available — to
the browser. This is the only place the Client Secret exists as far as PickVanta is
concerned: it is not in this repository, not in the Vercel build, and not in any response
the browser can read.

**Supabase dashboard** (Authentication → URL Configuration):

| Setting | Value |
| ------- | ----- |
| Site URL | the production URL, e.g. `https://YOUR-PROJECT.vercel.app` (Vercel's production domain for this project) |
| Redirect URLs (allow list) | every address this app may return to: the production URL, Vercel preview URLs if they are used, and `http://localhost:8000` for local development |

`redirect_to` is only honoured if it matches that allow list; the app sends its own origin
and path, so nothing else needs to be listed.

**Deployment**: no Vercel environment variable is needed for Google. The deployment keeps
using `SUPABASE_URL` and `SUPABASE_ANON_KEY` only (`tools/vercel-config.js`); the provider
is enabled in Supabase, not in the build. Redeploy or reload after changing the Supabase
settings — the account page re-reads `/auth/v1/settings` on every visit, so the button
appears as soon as the provider is on.

**Verifying it**: `curl -H 'apikey: YOUR-ANON-KEY' https://YOUR-PROJECT-REF.supabase.co/auth/v1/settings`
should include `"google": true` under `external`. If it does not, the account page will keep
saying Google is not enabled — which is the honest state, not a bug. On the current project
this returns true and the sign-in has been completed end to end.

#### Relationship between Supabase Auth and `profiles`

* `auth.users` (Supabase) owns the identity: the email, the password (hashed, for
  email/password accounts), the provider links, and the session.
* `public.profiles` owns the *application* profile: the same `id`, a copy of the email for
  convenience, an optional display name, and the `role`.
* The row is created by a trigger on `auth.users`, so **a Google sign-up and an email
  sign-up produce exactly the same profile**, and neither client can skip it.
* A Google account gets `role = 'user'` like anybody else. Using Google does not promote,
  demote or otherwise change an existing account's role, and there is no Google-specific
  table anywhere.
* Nothing about OAuth is stored in `profiles`: no Google id, no Google token, no password.

## Seller and provider accounts (Step 11)

**This stage establishes who may sell, not what they sell.** A person can apply to run a
business on PickVanta; the application is stored in the database, reviewed by an operator
through SQL, and shown back to the person with its real status. There is no seller
dashboard, no listing created from it, and no way for an application to publish anything.

### The account model

```
Supabase Auth user            public.profiles              public.seller_provider_profiles
──────────────────            ───────────────              ───────────────────────────────
auth.users.id  ──────────►    profiles.id  (1:1,            owner_id  (1:many)
owns the identity,            created by a trigger          the application(s) this person
the password and              on auth.users)                has made — type, business name,
the session                   role: user | admin            details, location, status
                                                            │
                                                            └─► seller_id (nullable)
                                                                public.sellers(id) — the
                                                                public display record a
                                                                listing references
```

* **One person, one identity, several businesses.** `owner_id` is a foreign key to
  `auth.users(id)` and is deliberately **not unique**: the schema is ready for one user to
  own more than one seller or provider account, and the onboarding page already says so
  ("You can hold more than one PickVanta account") and offers a second application.
* **Two account types, one structure.** `account_type` is `'seller'` (products) or
  `'provider'` (services). The table, the validation, the statuses and the flow are
  identical; only the wording changes — "What do you sell?" versus "What services do you
  provide?" — and that wording lives in one place, `SELLER_ACCOUNT_COPY` in `js/domain.js`.
  The interface never invents a second code path for providers.
* **Identity is not listing ownership.** This table says who applied. `public.sellers`
  remains the public record a listing points at, exactly as in Step 7. An application
  carries a nullable `seller_id` that only an administrator can set, once a real catalogue
  record exists for them. Existing demonstration listings keep the demonstration sellers
  they always had — **no listing was given a fake owner, and no catalogue row was migrated
  or rewritten**.
* **A PickVanta account is not an imported merchant offer.** An external or imported
  merchant offer (the not-yet-built Deal Engine) is a different entity with a different
  lifecycle: it belongs to somebody outside this system and is maintained by import or
  feed. Having a PickVanta seller/provider account does not create, claim or imply one, and
  the two are never joined by name. `deals` continues to reference a `listing_id` only.
* **Roles do not change.** Applying does not make anybody an administrator or give any
  hidden privilege. `user` and `admin` remain the only roles, and participation is
  represented by the entity plus its ownership.

### The lifecycle

```
apply (page)  ───►  pending  ──►  active      (an operator approves)
                    │      └──►  suspended   (an operator suspends)
                    │      └──►  rejected    (an operator declines — a clean end state)
                    └─────────► archived     (closed, retained for records)
```

* A new application **always** starts as `pending`, whatever the browser sends: the
  `insert` policy's `with check` requires it, and the guard trigger refuses anything else.
* `pending`, `active`, `suspended`, `rejected` and `archived` are the only values the
  database accepts. There is no client-defined status, and no free-text state.
* Only an administrator can move an application out of `pending`, through
  `public.seller_profile_set_status(id, status, note)`. The reviewer and the time are
  recorded by the function, not by the caller.
* `archived` is a closed state rather than a deletion: rows are retained, matching how the
  catalogue already treats archived records (archived is unreachable, never deleted).

### Onboarding (what a person does today)

1. **Sign in.** The page (`sell.html`) requires a confirmed session; a signed-out visitor
   is asked to sign in and offered the catalogue instead. There is no second account
   system — it is the same `js/auth.js` used everywhere else.
2. **Choose.** Two radio cards: *I want to sell products* or *I provide services*.
3. **Describe.** Business or practice name (required), description, contact email, contact
   phone, website, and a structured location — country, county, city, area. Validation runs
   before anything is sent, and the database validates it again (length, shape of the email
   and website, non-blank name).
4. **Submit.** The row is created with the person's own token. It is `pending`, it is
   theirs, and it is linked to nothing.
5. **Read the outcome.** The page says plainly that the application is with PickVanta for
   review and that nothing is published. It never claims approval, and it never shows a
   success message the database did not produce.

A pending application can be edited by its owner from the same page. If the application is
no longer pending — approved in the meantime, for instance — the edit is refused, the page
says so in plain words, and it re-reads the real status rather than pretending the change
was saved.

### The account page

`sell.html` is for applying and managing an application; `account.html` is where a person
finds it. The account page keeps its existing structure (who you are, how you signed in)
and gains one section — **"Sell or provide on PickVanta"** — that either:

* offers **Start an application** when there is none,
* shows each existing application with its type, business name and current status (with
  **Manage applications** linking to the page above), or
* states plainly that applications need a live catalogue connection when the site is
  running on the bundled demonstration data.

It is a summary, not a dashboard: no listing tools, no statistics, no messaging.

### Preparing for what is not built yet

* **Admin review** (a later stage) is already shaped by the database: an administrator reads
  every account through the `seller_profiles_select_admin` policy, and changes state through
  the two functions. An admin interface would be a controller over those — no new
  authorization would be needed, and none of it is built here.
* **Listing ownership** is prepared, not implemented. `seller_provider_profiles.seller_id`
  is the single, admin-controlled link between an account and the public record a listing
  references. Nothing in this stage writes it, and no listing may invent an owner.
* **Several businesses, teams, verification, commissions, payments and the Deal Engine** are
  all still ahead. The schema does not block them (ownership is one-to-many, the account is
  not a role, and the catalogue link is a separate column), and none of them is built now.

### What Step 11 is not

There is no seller or provider dashboard, no listing creation, editing, publishing or
approval, no admin interface of any kind, no product variants, no merchant offers, no
affiliate links or networks, no commissions, no payments, no subscriptions, no messaging or
notifications, and no verification workflow. The catalogue is unchanged: browsing, search,
filters, sorting, detail, compare, deals and guides work exactly as before, signed in or
signed out, and the public catalogue never requires an account.

## The admin panel (Step 12)

`admin.html` is where PickVanta is operated. It is deliberately small: a dashboard, and the
review queue that the seller/provider lifecycle has been waiting for. Everything on it is a
row count or a row from the live database — there are no invented statistics, no charts, and
no estimates.

### Access: the database decides, and the page asks first

`profiles.role` is the only source of truth, exactly as in Step 9. The panel has four states
and **only the last one reads any administrative data**:

| State | What is shown | What is requested |
| ----- | ------------- | ----------------- |
| No live database (demonstration build) | "The admin panel needs the live database connection." | nothing |
| Signed out | A sign-in prompt, and a way back to the catalogue | nothing |
| Signed in, not an administrator | "This area is for administrators" — stated as a fact about the account, not an error | nothing |
| Administrator | The panel | counts, and the queue |

* The page asks `PV.auth.isAdmin()`, which reports the role the database returned **with that
  person's own profile row**. The panel never reads a role from `localStorage`, a URL
  parameter, a query string or a hidden field — and a crafted address such as
  `admin.html?section=sellers&id=…&role=admin` opens nothing: the read of the address grants
  no authority, and the test suite asserts that such a page requests no admin data at all.
* Hiding the panel is convenience, never protection. The same requests sent by a normal user
  come back **403** from the review function and **403** from the counts function, and the
  private table returns an empty list — because Row Level Security, not the interface, is
  what protects it.

### The dashboard

Every number is a row count taken from the database when the page loads, and the page says
so ("Live database information — row counts read from the database at 14:22"). Where a value
could not be read, it says *Not available*; it never shows a zero in its place.

| Figure | Meaning |
| ------ | ------- |
| Applications: pending / active / suspended / rejected / archived / total | Rows of `seller_provider_profiles`, by status |
| Published listings | `listings` with `status = 'published'` — what a visitor can browse |
| Active offers | `deals` with `status` in (`scheduled`, `active`) whose listing is published |
| Catalogue sellers | Rows of `public.sellers` |

The last one is labelled **"Catalogue sellers are not PickVanta accounts"** on the page
itself, because conflating the two is the mistake this schema is built to prevent:
`public.sellers` is the catalogue's public display record, and
`public.seller_provider_profiles` is a person's application to run a business. They are
separate tables, counted separately, and nothing merges them. Traffic, conversions,
commissions and revenue are explicitly named as a later stage — and none of them is guessed
at here.

The counts come from `public.admin_dashboard_counts()` (migration `0004`): a `security
definer` function that begins with `if not public.is_admin() then raise exception …`, is
callable only by `authenticated` (`anon` is revoked), and returns one jsonb object of counts
— no ids, no names, no contact details. A count is not a read, and this keeps it that way.

### The review queue

Applications are listed newest first, with the filter that matters defaulting to **Pending**:
All · Pending · Active · Rejected · Suspended · Archived. Each row shows the business name,
the account type, the status, the location and the submitted date; opening one shows the full
application — description, contact email, phone, website, the structured location, the
submitted date, the current status, and the previous review (when it happened, the note, and
the reviewer's account id).

* The queue is a real `<table>` with a caption and scoped headings, which becomes a stack of
  labelled rows on a phone (each cell carries its own label, so nothing is lost).
* The URL carries the view — `admin.html?section=sellers&status=pending&id=<uuid>` — so a
  review can be linked or reloaded. Every part of it is validated before use: an unknown
  section falls back to the dashboard, an unknown status to pending, and anything that is not
  a UUID is ignored (and never echoed back into the page).

### Review actions

**Approve** · **Reject** · **Suspend** · **Archive**, offered according to the state the
account is in (a pending application is not "suspended"; an archived account is not
"rejected"). The set of buttons differs by state, but the *authority* does not: every action
calls `public.seller_profile_set_status(target_id, new_status, note)` — the function written
in migration `0003` for exactly this purpose.

1. Choosing an action opens a confirmation naming what would change, with an optional note
   (500 characters, the database's own limit).
2. Confirming calls the function. The client never writes the `status` column, and the
   database would refuse it if it tried: `status`, `review_note`, `reviewed_at`,
   `reviewed_by`, `seller_id`, `owner_id` and `account_type` are not in the column grant, and
   the guard trigger refuses them regardless.
3. The function checks `is_admin()` for itself, validates the status against the closed
   vocabulary, records `reviewed_at` and `reviewed_by`, and returns the row it wrote.
4. The page then **re-reads the record** and displays the status the database returned — not
   the one that was requested. If the two ever disagree, the page says so.
5. A refusal is never reported as success: an expired session, a missing application, a
   refusal, or an unreachable service each produce a plain sentence, and the record is left
   exactly as it was. No raw database text is shown.

### Navigation, and what is deliberately not built

The sidebar states the intended architecture and marks what does not exist yet:

| Section | State |
| ------- | ----- |
| **Operations** — Dashboard, Seller & provider review | **Built** |
| **Deal Engine** — Sources | **Built** (Step 13 reads them; Step 14 adds and edits them through the database's own function) |
| Deal Engine — Jobs | **Built** (Step 14: read-only; nothing in this build runs a job) |
| Marketplace — Products | **Built** (Step 15: read-only operational visibility of the canonical catalogue — counts and the most recent records, no editing) |
| Deal Engine — Review Queue | **Built** (Step 17A: the records waiting for review, the evidence and history they arrived with, and the reviewed conversion that turns one into canonical records through the database's own function) |
| Deal Engine — Import Deals | **Built** (Step 17B: a read-only inspection screen — the imported records the database returns, newest first, with nothing there that can be changed) |
| Deal Engine — Import History, Affiliate Links, Scheduled Scans | Planned |
| Marketplace — Listings, Categories, Deals | Planned |
| Insights — Analytics | Planned |
| System — Settings | Planned |

Planned entries are not links and not buttons — they cannot be clicked, because a dead
control promising a feature is worse than an honest label. The panel's code reaches exactly
five admin store methods (`counts`, `accounts`, `account`, `review`, `available`), the Deal
Engine boundary behind `sources`, `jobs`, `importedDeals`, `merchants`, `createSource`,
`updateSource`, `reviewQueue`, `importedDeal`, `importedDealEvents` and `convert`, the
read-only canonical boundary behind `products`, `variants`, `offers` and `counts`, and one
reference read, `reference.categoryOptions`, for the published taxonomy a conversion chooses
from. There is no listing, import, connector, affiliate, commission or publishing logic
behind any of the other labels. The canonical layer has exactly one write a browser can
reach — the reviewed conversion, which is a call to `public.imported_deal_convert()` and
never a table write — and no other admin method writes anything.

## The Deal Engine (Step 13)

**Step 13 builds the engine room, not the engine.** It models the records an imported deal
passes through and the pipeline it will move along; it connects to nothing. There is no
marketplace connector, no affiliate network, no merchant API, no feed reader, no scraper,
no crawler, no sitemap scan, no worker, no cron job, no price monitoring and no automatic
publishing. Every external integration named in this section is **future work**, and the
database is shaped so that the future work has somewhere to land.

The engine has two halves that never touch the public catalogue's read path:

```
   IMPORTED → VALIDATED → NORMALIZED → DEDUPLICATED → PENDING-REVIEW → APPROVED → PUBLISHED
                                                        │
                        rejected · archived · failed ───┘  (terminal, and always traceable)
```

The public catalogue is unchanged. `public.deals` from `0001` remains the presentation
model — what a visitor reads on `deals.html` and `detail.html`. The Deal Engine's records
live in their own tables, are readable only by an administrator, and reach a public page
only by becoming a published deal that a person approved.

### What exists after this step

All six tables come from `db/migrations/0005_deal_engine_foundation.sql`.

| Table | What it holds | Why it is separate |
| ----- | ------------- | ------------------ |
| `deal_sources` | Where imported information comes from: type, provider/network, market country, endpoint reference, status, non-secret configuration | A source is an agreement, not a scraper, and a credential never lives in a row |
| `external_merchants` | A merchant (marketplace or affiliate-side business) an import came from, with its own identifier | An external merchant is **not** a PickVanta seller or provider, and no column links it to one |
| `deal_engine_jobs` | One run of one task: type, status, progress, stats, error, start/finish times | The pipeline runs outside the request/response cycle; a worker needs somewhere honest to report |
| `imported_deals` | One imported record: provenance, the affiliate destination, normalised fields, pipeline and review state | Raw external data must never be a public deal, and its provenance must never be lost |
| `imported_deal_media` | References to media the source hosts: URL, type, order, attribution, optional fallback | PickVanta points at merchant assets instead of downloading them |
| `deal_engine_events` | Append-only history: stage, outcome, detail, who or what acted | "What happened to this deal?" has to be answerable, and an event is never rewritten |

### Imported deal vs public deal

The two are different records on purpose:

* an **imported deal** is what a source said, kept as it arrived (`imported_metadata` holds
  the source's own payload, unchanged, as evidence for a reviewer);
* a **public deal** is what PickVanta decided to show, in the catalogue's own tables.

`imported_deals.published_deal_id` is the single link between them, written when a reviewer
publishes. Nothing else connects the two, and no public page reads an imported record —
`js/store.js` keeps the Deal Engine behind its own namespace, and no catalogue page calls it.

### Source URL vs affiliate URL

These are different things, and the schema makes that structural:

| Column | Meaning |
| ------ | ------- |
| `source_url` | Where the product information came from. Provenance, not a paid link. |
| `affiliate_url` | The tracked destination a buyer would be sent through, once an affiliate agreement exists. |

`imported_deals_source_and_affiliate_differ` refuses a row where the two are the same value,
so a report, a review or a link can never confuse one for the other. **No affiliate URL is
generated anywhere in this repository, and none is hard-coded**: the column is written by
the pipeline in a later step, from an agreement that does not exist yet, and never by a
browser. When a "get this deal" action is eventually built, it uses the approved affiliate
or deep link — and until such a link exists, the honest answer is that there is nothing to
follow.

### External merchant vs PickVanta seller or provider

There are three different things in this project and they stay different:

| Concept | Where it lives | What it is |
| ------- | -------------- | ---------- |
| PickVanta seller/provider | `public.seller_provider_profiles` (0003) | A person who applied to sell or provide on PickVanta, with a review lifecycle |
| Catalogue seller | `public.sellers` (0001) | The public display record a listing points at |
| External merchant | `public.external_merchants` (0005) | A marketplace or affiliate-side business an import came from — **not** a PickVanta account |

An external merchant is never assigned a `seller_provider_profiles` row, has no owner, and
cannot become a participant by being imported. The two tables share no column, and the
migration's self-check fails if a merchant ever grows a column pointing at an account.

### The future shape: Product → Variant → Merchant Offer → Affiliate Link

The intended marketplace architecture is:

```
Product → Variant → Merchant Offer → Affiliate Link
PickVanta Seller/Provider → PickVanta Listings        (a separate line)
```

The same product sold by three merchants is one product with three offers, not three
customer-facing products. **This step established the boundary that keeps it possible** —
the imported record carries the signals a future product match will need (external product
identifier, GTIN, brand, model number, a normalised name) and the merchant it came from —
and **Step 15 built the Product, Variant and Merchant Offer records themselves**, in their
own tables, with the provenance link back to the imported record. What is still missing is
the part that is deliberately missing: nothing matches, converts, approves or publishes an
imported record automatically. See
[The canonical catalogue](#the-canonical-catalogue-step-15).

### Provenance and import history

Every imported record can answer the questions an administrator will ask:

| Question | Where the answer is |
| -------- | ------------------- |
| Where did this come from? | `source_id` → `deal_sources`; `source_url`; `merchant_name`, `merchant_ref`, `external_merchant_id` |
| When was it imported? | `imported_at`, `created_at`, and `job_id` → the run that fetched it |
| What happened to it? | `deal_engine_events` — one row per stage, append-only |
| Was it normalised? | `normalization_status`, `normalization_result`, the `normalized_*` columns |
| Was it considered a duplicate? | `deduplication_status`, `dedup_match_class`, `dedup_matched_deal_id` |
| Who approved it? | `review_status`, `reviewed_by`, `reviewed_at`, `review_note` |
| What URL would a buyer follow? | `affiliate_url` (and `source_url` for provenance) |

Events are append-only by trigger: an event cannot be rewritten or deleted, and because the
history belongs to the record, **an imported record that has a history cannot be deleted at
all** — it is archived instead. That is the intent: a failed import stays traceable rather
than disappearing.

### Validation, normalization and deduplication

* **Validation** answers "is this structurally usable?" — the required identifier, a real
  URL, a non-negative price, an ISO-4217 currency, a name. In this step the constraints do
  the enforcing: the status vocabulary, the URL shapes, the currency shape, the non-negative
  price, the GTIN shape, and "at least one of an external id, a title or a URL". A record
  that fails keeps its failure visible (`validation_status`, `validation_result`, `error`)
  instead of vanishing.
* **Normalization** maps external formats onto PickVanta's own: currency, category,
  availability, product/service classification, a standardised merchant name. The columns
  and statuses exist; the mapping does not, and there is no AI anywhere in this project —
  when one is added it will be a processor behind the same interface, not a rewrite.
* **Deduplication** is deterministic and never merges by itself. The classes are `new-product`,
  `exact-match`, `probable-match` and `uncertain-match`, and a matched record must name what
  it matched (`dedup_matched_deal_id`), so an uncertain case can go to a person instead of
  being decided. `(source_id, external_product_id)` is unique, which stops the same item
  being imported twice from one source while keeping the same item from a *different* source
  as its own record with its own provenance — cross-source identity is a product-level
  decision for a later step, not a delete-and-merge here.

### Media: references, not copies

`imported_deal_media` stores where an asset is, its type, its order, its attribution and an
optional fallback — never the bytes. PickVanta does not download, proxy, resize or
health-check a merchant's assets in this step. The existing image system (local fallback
included) is untouched.

### Jobs: what a future worker will report

`deal_engine_jobs` models one run of one task — `source-scan`, `feed-import`, `url-discovery`,
`extraction`, `normalization`, `deduplication`, `price-check`, `availability-check`,
`deal-expiry`, `link-health` — with `queued`, `running`, `succeeded`, `failed` or `cancelled`,
progress, stats, timings and an error. A job marked `failed` must record why (a constraint
enforces it). **No worker, scheduler or background process exists**: the public website never
waits on one, and nothing here runs on a timer.

### Security: who may read, who may write

* RLS is enabled on all six tables.
* Each table has **exactly one policy, and it is a SELECT policy gated on
  `public.is_admin()`**. A signed-out visitor is refused outright (`anon` holds no privilege
  at all); a signed-in member of the public gets zero rows, by listing and by guessing an id.
* **No INSERT, UPDATE or DELETE policy exists for any client role — not even for an
  administrator.** Imported data is untrusted external input, so no browser is allowed to
  write it; the future pipeline writes with a server-side key or through its own validating
  function. The admin panel therefore has no write controls for these tables, because
  offering one would be offering something the database refuses.
* `deal_sources.config` refuses a credential-shaped key by constraint. Credentials belong in
  the server environment — never in a row, never in the browser. The panel does not even
  request the `config` column when it lists sources.
* Imported text is untrusted: it is escaped at every point it is rendered, and a recorded URL
  becomes a link only if `isSafeHttpUrl()` accepts it (http/https, no quotes, no control
  characters). A `javascript:` value is shown as inert text, never as an `href`.

### Two corrections to earlier migrations, made in this step

Both were found by applying `0001`–`0005` to a real PostgreSQL and watching what actually
happened, and both would have blocked the project:

1. **`0002` and `0003` could never pass their own pre-checks.** They asked
   `to_regproc('public.set_updated_at()')`, but `to_regproc` takes a bare function name —
   given a signature it returns `NULL`, so both migrations raised "apply 0001 first" on a
   project where `0001` was applied. They now use `to_regprocedure`, which is the function
   that accepts a name *with* its argument list.
2. **The first administrator could never be created.** `profiles_guard_role()` refused any
   role that is not `user` unless the caller was already an administrator — including the
   out-of-band `update` this README documents, which meant the admin panel could never be
   reached on a real project. The guard is now scoped to clients (`anon` / `authenticated`,
   i.e. anything that arrives through the API) and still refuses every attempt from a
   browser; an operator's SQL, a migration or the server-side key may bootstrap the first
   administrator.

Neither correction weakens anything: the guard still refuses a self-promotion even if a
future grant allowed the column, and the pre-checks still fail loudly when a required
migration is genuinely missing.

### Global by construction, not Kenya-only

The engine stores ISO-3166-1 alpha-2 country codes (`market_country`, `country`) and
ISO-4217 currency codes (`imported_currency`), both constrained, with `''` meaning "not
recorded". Nothing in the engine assumes Kenya, a single market, a single currency or a
single network. Display currency, preferred countries, shipping availability and
country-specific affiliate eligibility are later work; the storage does not preclude any of
them.

### Future architecture, and what is deliberately not built

| Area | State after Step 13 |
| ---- | ------------------- |
| Sources, imported records, media references, jobs, events | **Modelled** (tables, constraints, indexes, RLS) |
| Sources list in the admin panel | **Built** — real rows, honest empty state, contacts nothing (Step 14 makes it writable) |
| Connectors (feeds, merchant APIs, affiliate networks), scraping, discovery | Not built |
| Workers, schedulers, cron, scans, monitoring | Not built |
| Validation, normalization, deduplication processors | Not built (the states and columns exist) |
| Import Deals screen | **Built** — read-only (Step 17B): the imported records the database holds, one bounded page, newest first, and nothing there can be changed |
| Scheduled Scans, Affiliate Links, Import History screens | Not built (nav entries are labelled *Planned* and are not clickable) |
| Affiliate network, affiliate accounts, link generation, clicks, conversions, commissions, revenue | Not built — and no fake accounts, clicks, conversions or figures exist anywhere |
| Product / Variant / Merchant Offer tables | Not built |
| Seller or provider dashboards, listing creation or editing | Not built |
| Approval or publishing of an imported record | Not built — and nothing publishes itself |

The three future architectures the model is shaped for: a **connector** reads a source and
records an import with its provenance; a **worker** runs a job and appends events while it
advances the pipeline; an **affiliate account** issues a tracked link per merchant offer,
and clicks, conversions and commissions are recorded against that link. Each of those is a
later step, and each has a place to stand in this schema.

## The operational layer (Step 14)

**Step 14 makes two things manageable from the admin panel and connects nothing.** A source
can be added and edited by an administrator; the job records can be read. There is still no
connector, no worker, no schedule, no import, no affiliate link and no publishing.

### Sources: what an administrator can do

| Action | How it works |
| ------ | ------------ |
| List | `PV.store.dealEngine.sources()` → `GET deal_sources` with an explicit column list. RLS decides the rows: the policy is `SELECT` only and gated on `public.is_admin()`. |
| Add | The panel's form → `PV.store.dealEngine.createSource()` → `POST rpc/deal_source_save` with `p_source` |
| Edit | The same form → `PV.store.dealEngine.updateSource()` → `POST rpc/deal_source_save` with `p_source` **and** `p_id` |
| Retire | Set the state to **Archived** in the same form. There is no delete: a source keeps its row because the provenance of what was imported from it has to outlive the agreement. |

**No table is ever written from a browser.** `0005` grants a client no write policy and no
write privilege on `deal_sources`, and `0006` does not change that: the only way in is
`public.deal_source_save(jsonb, uuid)`, which is `security definer`, pins `search_path`, and
asks `public.is_admin()` for itself before it looks at the payload. An administrator who is
refused is refused by the database — not by a hidden button, and never by a URL parameter.

The three functions `0006` adds:

| Function | Who may execute it | What it does |
| -------- | ------------------ | ------------ |
| `public.deal_source_save(p_source jsonb, p_id uuid default null)` | `authenticated` (and then only if `is_admin()`) | Inserts when `p_id` is null, updates that row when it is not; returns the row as jsonb |
| `public.deal_source_validate(p_source jsonb)` | nobody but the owner | The validation, in one place, so create and update cannot disagree |
| `public.deal_source_json(public.deal_sources)` | nobody but the owner | The exact column set the panel may see |

### What the form refuses

The browser validates so a person is told before a request is made, and the database
validates again because the browser is not the authority. Both refuse the same things:

* an empty name, or one longer than 120 characters;
* a source type or state outside the closed vocabularies;
* a market country that is not two letters (`GB`, `KE`, `DE`, …), or a name or endpoint that
  is too long;
* an endpoint that is not `http(s)`;
* configuration that is not a JSON object, or is larger than 2000 characters;
* **a credential, by shape** — a key such as `api_key`, `auth_token`, `my_api_key`,
  `client_secret` or `private_key` at any depth, and a *value* that looks like one: a pasted
  bearer token, a JWT, a private-key block, an `sk_live_…`-shaped key, or a connection string
  with a password in it. The table's own constraint (`deal_sources_config_no_secrets`) is the
  second lock.

Credentials belong in the server environment. There is no credential management here, by
design.

### The source lifecycle

| State | What it means |
| ----- | ------------- |
| **Active** | The source is eligible for future processing. Nothing starts when it is set: there is no worker to react to it. |
| **Paused** | The source exists; a future job should not run against it. This is the default for a new row. |
| **Disabled** | Deliberately unavailable. |
| **Archived** | Retained for historical and provenance purposes. The row is never deleted. |

### Jobs: what an administrator can see

`PV.store.dealEngine.jobs()` reads `deal_engine_jobs` — one run of one task: which source,
which type (`source-scan`, `feed-import`, `url-discovery`, `extraction`, `normalization`,
`deduplication`, `price-check`, `availability-check`, `deal-expiry`, `link-health`), its
state (`queued`, `running`, `succeeded`, `failed`, `cancelled`), the recorded progress, what
it reported, why it failed, its statistics, and when it started and finished.

Everything on that page is the database's own value, and **nothing advances it**: no timer,
no polling, no simulated percentage, and no interface that creates a job. Nothing in this
build can write a job row at all — `0005` gives no client a write policy on
`deal_engine_jobs` — so the honest state of that page today is an empty list that says so.

`PV.store.dealEngine.importedDeals(session, { limit })` is the **prepared boundary** for the
imported records: it returns the complete provenance shape (what the source said, `source_url`
and `affiliate_url` kept apart, the four step statuses, the dedup class, both timestamps) and,
separately, the database's own count. The Jobs page uses the count only — "Imported records
recorded so far: 0" — which is a fact from the database, not an estimate; from Step 17A the
Review Queue reads the records themselves, filtered by the database, and from Step 17B the
Import Deals section reads one bounded page of them — the most recent 50, newest first — with
the database's own count beside the page, as a read-only inspection screen that changes nothing.

### Events, unchanged

`deal_engine_events` is still append-only (a trigger refuses every update and delete) and
still readable only by an administrator. No interface writes an event and no interface
fabricates one: the one event a browser can cause is the one `public.imported_deal_convert()`
appends when it converts a record, and the Review Queue reads a record's history back from
the table exactly as the database holds it.

### Security model, restated

| Question | Answer |
| -------- | ------ |
| Who decides an administrator? | `public.is_admin()`, reading `profiles.role` for the caller's `auth.uid()`. Never a client variable, a hidden element or a query parameter. |
| How does a source get written? | One `security definer` function that checks `is_admin()` itself. No table write, from any client, ever. |
| What can a member read? | Nothing: `deal_sources`, `imported_deals`, `imported_deal_media`, `deal_engine_events`, `deal_engine_jobs` and `external_merchants` each have exactly one policy, `SELECT … USING (public.is_admin())`. |
| What can an anonymous visitor read? | Nothing at all — `anon` holds no privilege on those tables. |
| What reaches a browser? | The ten columns `deal_source_json()` returns and the fields `imported_deals`/`deal_engine_jobs` are asked for. No credential, no key, no service-role token is in any file the browser loads. |
| What happens to imported text? | It is escaped when rendered (`esc()`), and a URL becomes a link only if `isSafeHttpUrl()` accepts it. Nothing is inserted as markup. |

### Migration order for this step

```bash
psql "$DATABASE_URL" -f db/migrations/0001_catalogue.sql
psql "$DATABASE_URL" -f db/migrations/0002_auth_profiles.sql
psql "$DATABASE_URL" -f db/migrations/0003_seller_provider_profiles.sql
psql "$DATABASE_URL" -f db/migrations/0004_admin_dashboard.sql
psql "$DATABASE_URL" -f db/migrations/0005_deal_engine_foundation.sql
psql "$DATABASE_URL" -f db/migrations/0006_deal_engine_operations.sql
```

`0005` refuses to run without `0001` (for `public.deals` and `public.set_updated_at()`),
`0002` (for `public.is_admin()`) and Supabase Auth (`auth.users`), and it ends with a
self-check that fails if RLS is off, if `anon` can read anything, if a client can write
anything, if a write policy exists, if the source/affiliate separation is missing, if the
pipeline vocabulary is unconstrained, if a credential-shaped configuration would be accepted,
or if the event log is not append-only.

`0006` refuses to run without `0005`, `0002` and `0001`, and ends with its own self-check:
that `deal_source_save` is `security definer` with a pinned `search_path`, that
`authenticated` may execute it and only it, that `anon` may execute none of the three, and
that **no write policy and no write privilege appeared on any Deal Engine table** — if one
did, the function would no longer be the only way in.

### One correction to `0005`, made here

`deal_sources_config_no_secrets` matched a key that was *exactly* one of the credential
words, so `auth_token`, `refresh_token` and `my_api_key` — the shapes a credential actually
arrives in — passed. The pattern now matches those words anywhere inside a key name, at any
depth. `0006`'s validator refuses the same shapes and names the offending key, and it adds
the value-shape check the table constraint does not have. Nothing else in `0005` changed.
(`0005` has not been applied to the live project yet, so there is nothing to re-run: applying
it once installs the corrected constraint.)

## The canonical catalogue (Step 15)

**Step 15 establishes what a product IS, before anything external arrives.** It adds the
canonical layer the Deal Engine's imported records are eventually resolved into — Product,
Variant and Merchant Offer — with the provenance that keeps every one of them traceable
back to the record it came from. It builds **no pipeline**: nothing converts an imported
record into a product in this step, no connector runs, no price is tracked and no public
page reads any of it.

### The three records, and why they are three

| Record | Table | What it is |
| ------ | ----- | ---------- |
| **Product** | `public.products` (0008) | The canonical consumer-facing identity — *what the thing is* ("Demo Phone 8/128 (Black)"), independent of who sells it or what they call it |
| **Variant** | `public.product_variants` (0008) | One purchasable configuration of a product ("8GB / 128GB / Black"). Optional: a product sold in a single configuration has no variant rows, and its offers point straight at the product |
| **Merchant offer** | `public.merchant_offers` (0008) | One **external merchant's** offer for a product or variant, through one **source** — with the merchant's own title, its own references, the price it recorded, its availability, and the two URLs kept apart |

A product carries no seller, no price and no location: those belong to an offer. An offer is
never the canonical product, and a merchant's title never replaces a canonical name — the
two are separate columns, and the store renames the column's `title` to `merchantTitle` in
the browser so a call site cannot render one as the other by accident. Several merchants may
offer one product; one merchant may have several offers for it, one per variant, through one
or more sources.

The product's identity signals are stored twice, and for a reason:

```
   brand              "Demo Brand"        brand_normalized   "demo brand"
   model_number       "SM-A566B"          identity_key       "brand=demo brand|model=sma566b"
   mpn                "A566-128-BLK"      gtin               "1234567890123"
```

The left column is for people; the right is the deterministic form a future matching step
would compare, so a normalised value never has to be shown to anyone.

### What already existed, and what this layer is not

Three tables already sound like this one, and none of them is it. Stating the difference is
part of the design:

| Existing | Why it is not the canonical layer |
| -------- | --------------------------------- |
| `public.listings` | The **public presentation** record. It belongs to a PickVanta seller, carries presentation concerns (the `search_text` column the catalogue search reads, a location, service price types such as `per-night`) and has one unique slug. Two merchants offering the same phone would be two listings — which is exactly what a canonical product must not be |
| `public.deals` | A **PickVanta** offer: a discount attached to one of those listings, owned by the same PickVanta seller |
| `public.imported_deals` | The **untrusted record as it arrived**, kept private as evidence for review. It is the input to the canonical layer, never a substitute for it |

`0008` therefore creates the canonical layer beside them and alters **none** of them: no
column is added to `listings`, `deals`, `categories` or `subcategories`, and the public
catalogue keeps reading exactly what it read before. An external merchant is still not a
PickVanta seller — the two identities are never joined.

### Provenance: how an imported record becomes a canonical offer

`public.imported_deal_conversions` (0008) records the decision, and only the decision:

```
   imported_deals ──→ deal_sources          (which source supplied it)
        │        └──→ external_merchants     (which merchant supplied it)
        │
        └──→ imported_deal_conversions ──→ products
                                       └──→ product_variants   (the configuration, when there is one)
                                       └──→ merchant_offers    (the canonical offer it became)
```

The imported record is **not modified** by that link and gains no column: the conversion is a
separate, additive row, so the evidence a review was made against stays exactly as it
arrived. The row carries a `normalization_note` — what changed between what the source said
and what the canonical record says — and the person who decided, when a person did. One
imported record can become one offer (`imported_deal_id` is unique), and a product that a
conversion points at cannot be deleted out from under it.

**The one thing that writes a row in that table is the reviewed conversion**
(`public.imported_deal_convert()`, migration `0010`, called from the Review Queue in Step
17A). Nothing else does — not a connector, not a worker, not a schedule, and nothing
automatically. An administrator performs the conversion deliberately, on one record at a
time, and the function validates every value before it writes. The pipeline itself is
unchanged and unbypassed: `IMPORT → VALIDATE → NORMALIZE → DEDUPLICATE → PENDING REVIEW →
APPROVED → PUBLISHED`.

### Identity and deduplication: deterministic, and never automatic

The foundation is built for **exact, deterministic** comparison only: normalized brand,
model number, manufacturer part number, GTIN/EAN/UPC, the source's own product identifier,
and the merchant's own identifier. There is **no AI matching, no fuzzy matching across the
internet, and no automatic merging** — a record that cannot confidently be shown to be the
same as another simply stays a separate record.

That rule is visible in the constraints:

| Constraint | Why |
| ---------- | --- |
| `products.gtin` unique (when present) | A GTIN is a global standard identifier: two products sharing one is objectively an error, not an uncertainty |
| `products.identity_key` indexed, **not** unique | Two records whose signals agree are candidates for a person to look at. The database will not merge them, and neither will anything else |
| `product_variants (product_id, slug)` unique | Two variants of one product cannot describe the same configuration |
| `merchant_offers` unique on `(merchant_id, merchant_offer_ref)` and on `(source_id, merchant_id, merchant_product_ref)` | One merchant cannot repeat its own offer reference, and one source cannot record the same merchant product twice. Both are indexed only when the reference is present, because an absent reference is not an identity |
| `merchant_offers (variant_id, product_id) → product_variants (id, product_id)` | An offer's variant must be a variant **of that offer's product**. A single-column foreign key would happily accept another product's variant |

The same helpers exist in `js/domain.js` for the browser side — `normalizeBrand`,
`normalizeModelNumber`, `normalizeGtin`, `productIdentityKey`, `variantOptionKey` — so the
interface and the table agree on what a normalized value is. They compute; they never decide.

### Price and availability: what the source said, and nothing more

An offer records the price, the currency **as the source stated it**, the compare-at price,
and when the price was observed. There is no currency conversion, no currency-code
hard-coding, no price history and no tracking. `currency` defaults to the **empty string**
in the canonical layer — never to a code — so a source that recorded no currency leaves it
empty and the interface shows the amount with no currency code rather than stamping a local
one on it. (The public catalogue's own `listings.currency` and `deals.currency` keep the
`KES` default `0001` gave them; the canonical layer does not inherit it, and nothing here
writes to those tables.)

A comparison is only shown when the data supports it — both prices and a currency recorded,
and the compare-at price not below the asking price. The database enforces the last of those
(`merchant_offers_original_not_below_price`), exactly as `0001` does for public deals, and
`merchantOfferComparisonSupported()` applies the whole rule before anything renders.

Availability is per offer and independent of the product: `pending | active | unavailable |
expired | archived` describes **that offer**, and a product stays `active` while every offer
on it is unavailable — an empty shelf is not an empty catalogue. Nothing observes an offer on
a schedule, and no change of status triggers any external action.

### Media: references, not copies

`public.merchant_offer_media` stores where a merchant's asset is, in what order and with what
attribution, plus an optional fallback reference — exactly as `imported_deal_media` does for
imported records. Nothing downloads, mirrors, proxies, resizes or health-checks an asset, and
no table in the migration has a column that could hold image bytes.

### Security: readable by an administrator, writable by nobody

Every table `0008` creates has Row Level Security enabled, every privilege is revoked from
`anon` and `authenticated` first, and `SELECT` is granted back to `authenticated` alone
behind a policy of `public.is_admin()`. A signed-out visitor cannot read any of it; a
signed-in non-administrator gets an empty result rather than an error; and **no client role —
administrator included — holds INSERT, UPDATE, DELETE or TRUNCATE**. There is no write policy
at all, so:

* nobody can assign themselves a merchant or an offer;
* nobody can edit a merchant's identity, a source's provenance or an affiliate URL;
* nobody can promote an imported record into the canonical layer;
* nobody can publish a merchant offer.

The canonical layer is written by a future review step, server-side, through a function that
validates what it is given — or out of band with the service key. A database-authoritative
`is_admin()` is what the reads are gated on; the panel's own `isAdmin()` only decides what to
draw.

### Source URL vs affiliate URL, restated for this table

The same permanent separation `0005` established, applied where offer data lives:
`source_url` is where the information came from, `affiliate_url` is the tracked destination a
buyer would follow. The migration refuses a row where the two are equal
(`merchant_offers_source_and_affiliate_differ`), `affiliate_url` stays empty unless a source
supplied one, and **nothing in this project generates, derives or auto-populates it**.

### What an administrator can see

**Admin → Products** (read-only) proves the model exists and is readable: the counts of
products, variants and merchant offers; the most recent products with their brand, model,
identity key and status; and the most recent merchant offers with the merchant, the source,
the merchant's own title, the recorded price and the observed time. It is **not** a Product
Management UI — there is no create, edit, approve, publish, import or merge control, and the
section contains no form control at all. Each count is the database's own total; a count it
did not return is shown as not available rather than as zero.

### What Step 15 deliberately does not do

No Amazon, AliExpress or eBay API; no affiliate network; no merchant API; no product feed; no
scraping, crawling or proxy; no background worker, cron or queue; no automatic import; no
automatic publishing; no AI product matching or enrichment; no affiliate URL generation; no
price tracking; no currency conversion; no checkout, payment or subscription; no live
inventory; and no change to the public catalogue, which does not read these tables yet.
Converting the public catalogue to the canonical model is a later, controlled step.

### Applying it

`0008_canonical_catalogue.sql` runs after `0005`, `0002` and `0001` (see
[Applying the schema](#applying-the-schema-and-the-seed)), ends with a self-check that fails
if any new table is missing RLS, if a client holds a write privilege, if the
variant-belongs-to-product constraint is absent, if the URL separation is not enforced, or if
any function in `public` has lost the `search_path` pin `0007` gave it. It is idempotent and
creates nothing else: no function, no seed row, and no change to any existing object.

**It is a repository change until it is applied.** Migrations `0002`–`0009` have **not** been
applied to the live Supabase project from here, and this sandbox cannot observe that project;
the operator runs every statement.

### Relationship integrity (migration `0009`, Step 15A)

Step 15 created the four records of the canonical chain — imported deal, product, variant,
merchant offer — and the table that records a conversion. It made the chain unambiguous on
the **offer** side: `0008`'s composite key stops an offer from naming a variant that belongs
to a different product. It did not do the same for the conversion, and `0009` closes that.

**What was wrong.** `imported_deal_conversions` had three independent foreign keys — to a
product, to a variant and to an offer — and each of them was satisfied by any row of the
right type. Nothing tied them to one another, so the database accepted a conversion saying
*this imported record became Product A, via the configuration of Product B, and the offer I
published is Product C's*. That is not a provenance record; the two questions the table
exists to answer — which offer did this become, and which product was that offer for — would
contradict each other in the same row. Measured on a real PostgreSQL before anything was
changed: all of it was accepted.

**What `0009` does.** It adds no table, no function, no policy and no column. It establishes
the uniqueness two composite keys need and then lets those keys — plus a third — do the
work, so PostgreSQL refuses a mismatched relationship:

| Key | What it guarantees |
| --- | --- |
| `merchant_offers (id, product_id)` unique | lets a conversion name one offer *and* the product that offer is for |
| `merchant_offers (id, variant_id)` unique | the same for the variant an offer is for; a product-level offer has no variant, so many can coexist |
| `imported_deal_conversions (variant_id, product_id)` → `product_variants (id, product_id)` | a conversion's variant must be a variant of that conversion's product |
| `imported_deal_conversions (merchant_offer_id, product_id)` → `merchant_offers (id, product_id)` | a conversion's offer must be an offer of that conversion's product — this holds even when the conversion names no variant |
| `imported_deal_conversions (merchant_offer_id, variant_id)` → `merchant_offers (id, variant_id)` | when a conversion names a variant, the offer must be that variant's offer |

**The null semantics are untouched.** `variant_id` stays nullable and no column became NOT
NULL. A conversion always has a product and an offer, because `0008` made both required; the
variant is the optional part and stays optional, so a product-level conversion remains
valid — it is just no longer possible for its offer to belong to a different product.

**Two details that are not obvious, both measured rather than assumed.** Deleting a variant
still nulls the reference instead of deleting the record that pointed at it, and the new
variant key has to say `on delete set null (variant_id)`: a composite key's plain `set null`
would also try to null `product_id`, which is NOT NULL, so the deletion would fail with a
not-null violation — or appear to work, depending on the order PostgreSQL happened to create
its triggers in. The two offer keys are deliberately plain `no action`: deleting a variant
nulls both the offer's and the conversion's variant, and `no action` checks at the end of the
statement, after those nulls are applied. `restrict` would fire mid-statement and refuse a
deletion the schema documents as supported.

**Existing inconsistent rows are refused, not repaired.** Both new keys are added validated,
so `0009` cannot install on data that contradicts the chain. A pre-flight block runs first
and names the imported deal and conversion at fault and explains that nothing will be
deleted, merged or reassigned — which of the three references was the mistake is a person's
decision, not a migration's. Nothing in the repository has been applied live, so in practice
this is the guard for the future, not a cleanup.

**It needs PostgreSQL 15 or later.** The column list is PostgreSQL 15 syntax — before
that, `SET NULL` always nulled every column of the key, which cannot work here because
`product_id` is NOT NULL. The migration's pre-flight block checks the server version first and
refuses before running any DDL, so an older server is told what it needs rather than meeting a
syntax error partway through. Supabase projects run PostgreSQL 15 or newer.

**No application change.** `js/store.js` reads `product_variants` and `merchant_offers` with
`GET` only, and no file in the front end mentions `imported_deal_conversions` at all. The one
write that creates a conversion is `public.imported_deal_convert()` (Step 16), which builds
all five relationships itself — the product it created or chose, the variant of that product,
and the offer for exactly that product — so it cannot build a chain these keys would refuse.
The `0009` change is SQL only.


## The review queue and the reviewed conversion (Steps 16–17A)

**Step 16 wrote the conversion; Step 17A gives it an interface.** The design decision that
shapes both is that the conversion is a *database function*, not client writes: an
administrator asks the database to convert one imported record, the database checks
`is_admin()` for itself, validates every value against the canonical tables, writes all of the
records and hands back what it wrote.

The address is `admin.html?section=review`, and a single record is
`admin.html?section=review&id=<uuid>`. The id in the address is an identifier, never
authorization: it is a UUID or it is ignored, and every byte on the page still comes from a
request made with the signed-in administrator's own token.

### What the queue is

The database returns the records that are at pipeline status `pending-review` **and** review
status `pending`. Both conditions are in the query (`pipeline_status=eq.pending-review&
review_status=eq.pending`), with `order=created_at.desc` and `Prefer: count=exact`, so the
list, its order and its total are the database's answers rather than the page's opinion. This
is the same state `0010` refuses to convert anything outside of, so the queue can never offer
a conversion the database would refuse for being in the wrong state.

Opening a record shows, read-only:

* **the source evidence** — the merchant's title and description, the merchant's own reference,
  the external product id, the source and its URL, the recorded price and its recorded
  currency, the recorded availability, the imported category text, the imported timestamp, and
  the imported metadata exactly as it arrived;
* **the pipeline's own proposals** — `normalized_*`, when an earlier stage recorded them,
  labelled as proposals and never as canonical values;
* **the event history** — `deal_engine_events` for that record, oldest first, with the stage,
  outcome, detail and data each event recorded.

Nothing on that page is filled in from the evidence. Every canonical value is typed by the
reviewer.

### The conversion, and what is sent

One call: `POST /rest/v1/rpc/imported_deal_convert` with five keys and nothing else:

```
{
  "p_imported_deal_id":   "<the record>",
  "p_product":            { "mode": "create" | "existing", … },
  "p_variant":            { "mode": "none" | "create" | "existing", … },
  "p_review_note":        "…",     // ≤ 500 characters  → imported_deals.review_note
  "p_normalization_note": "…"      // ≤ 1000 characters → imported_deal_conversions.normalization_note
}
```

The product and variant objects carry **only the keys their chosen mode allows**, because
`0010` refuses a field sent in the wrong mode:

| Mode | Keys sent |
| ---- | --------- |
| product `create` | `mode`, `name`, `slug`, and any of `brand`, `model_number`, `mpn`, `gtin` (only when the variant mode is `none`), `category_id`, `subcategory_id` |
| product `existing` | `mode`, `product_id` — nothing else |
| variant `none` | `mode` |
| variant `create` | `mode`, `name`, `slug`, and any of `sku`, `gtin`, `option_values` |
| variant `existing` | `mode`, `variant_id` — nothing else |

Nothing database-owned or source-owned is ever sent: no description, no status, no
`brand_normalized`, no `identity_key`, no `option_key`, no merchant or source reference, no
price, no currency, no URL, and no `imported_*`, `normalized_*` or timestamp field. The
merchant title stays on the imported record as evidence; the canonical name is the reviewer's.

`option_values` is sent only when the reviewer typed a JSON object, and the page says so
rather than guessing what was meant.

### What counts as success

Only the complete answer. `0010` returns a conversion id, the product (id, slug, name, mode,
status), the variant (`null`, or its id, slug, name and mode), the merchant offer (id, title,
price, currency, status, `source_url`), and the record's new `pipeline_status` and
`review_status`. If that shape does not come back whole, the page reports that the database
did not return a complete conversion result, keeps everything the reviewer typed, and claims
nothing. **An HTTP 200 is not a conversion.**

After a confirmed conversion the page re-reads the record, its history, the queue and the
dashboard counts, and only then treats the queue as updated. If the database still reports the
record as pending review, the page says exactly that and leaves the form in place instead of
pretending it moved.

### What a refusal says

`0010` raises messages written for the person doing the review — a slug another product
already uses, a GTIN that belongs on the variant, a category that does not exist, a record
that is not at pending review — and the page shows them, escaped, as text:

| SQLSTATE | Meaning | What the page shows |
| -------- | ------- | ------------------- |
| `42501` | not an administrator | the database's own refusal |
| `22023` | a value the function will not accept | the database's own explanation |
| `23505` | a unique value already taken | the database's own explanation |
| `P0002` | the record does not exist | the database's own explanation |
| `22001` | a note longer than its column | the database's own explanation |
| anything else | no live project, no session, an unreachable database, another failure | a safe sentence with no raw detail |

Raw database text, stack traces, policy names and SQL are never displayed. The seller and
provider flow's wording ("someone else changed it", "that application is no longer in the
database") is never reused here: the conversion's refusals are its own.

### What Step 17A deliberately does not do

No automatic conversion, no matching of any kind (no AI, no fuzzy, no suggested product), no
merging, no publishing, no listing or public deal, no affiliate link, no product search or
catalogue-wide picking (the pickers offer the published taxonomy and the most recent canonical
products, and say so), no edits to a canonical record, no new table, no new policy, no new
grant, no schema change, and no change to `0010`. Every other navigation section stays
labelled *Planned*.

## Database Security Hardening (migration `0007`)

A hardening pass over the SQL that already existed. **No product behaviour was added, no
table, column, policy or index was created or changed, and no application file was touched.**
It fixes three genuine defects found by reading the existing migrations against the
database's own catalogues, and it is documented here in full because two of the three are
invisible from the interface.

### What was wrong, and what `0007` does

**1. Six functions could have their name resolution changed by the caller.**
`public.set_updated_at()`, `public.listings_refresh_search_text()`, `public.catalogue_stats()`,
`public.catalogue_tags()` and `public.catalogue_facets()` had no pinned `search_path` — the
Supabase linter reports these five as `function_search_path_mutable`. A sixth,
`public.seller_profiles_guard()`, had the same defect and is **not** in the reported list; it
was found during this review and is fixed with the rest. With no pinned path, a caller who
can create objects in a schema the path searches can influence how an unqualified name
inside the function resolves.

`0007` pins each with `ALTER FUNCTION … SET search_path = public, pg_temp` — deliberately
`ALTER`, not `CREATE OR REPLACE`, because `ALTER` cannot change a body, an argument list, a
return type, a volatility or a security mode. There is no way for this migration to alter
behaviour; the only thing that changes is how names resolve.

**Four further functions already pinned their path to `public` without `pg_temp`** —
`handle_new_user()`, `handle_user_email_change()`, `is_admin()` and `profiles_guard_role()`.
They are not linter warnings, because the linter only reports a *null* path. They are still
incomplete: when `pg_temp` is not named, PostgreSQL searches the temporary schema **first**,
and that schema is writable by whoever is connected. All four bodies fully qualify what they
touch, so nothing was exploitable, but `public.is_admin()` is the authorization primitive the
entire admin surface and every Deal Engine policy rests on, and it is not a good place to
leave an implicit caller-writable first look. `0007` completes those four pins as well. After
it, **every function PickVanta defines in `public` pins exactly `public, pg_temp`** — one
invariant, checkable, rather than most of one. Extension functions installed in `public`
(`pg_trgm`'s, behind the search index) are not PickVanta's to pin and are excluded by the
criterion the self-check uses: membership of an extension, which is what PostgreSQL records in
`pg_depend` — not a hand-kept list of names.

**2. A signed-in user held write privileges on the whole catalogue.**
`0001` revoked `INSERT, UPDATE, DELETE, TRUNCATE` from `anon` and stated in a comment that
this was "defence in depth". The second layer was never applied to `authenticated`, which
held all four on all eight catalogue tables.

Row Level Security blocks the row writes today — verified, not assumed: an `INSERT` is
refused outright, and an `UPDATE` or `DELETE` matches no row because no write policy exists.
So this was never a live data leak. It is still a real defect, because **`TRUNCATE` is not
subject to Row Level Security at all** — it needs only the `TRUNCATE` privilege, no policy —
and a signed-in non-administrator could truncate a catalogue table with no inbound foreign
key. `public.catalogue_settings` was reachable exactly that way. `0007` revokes the four
privileges from `authenticated` on those eight tables, **by name**, so that the grants
`0002` and `0003` make on purpose (`profiles` and `seller_provider_profiles`, including their
column-level `UPDATE`) are untouched. It also narrows the default privileges for future
tables in `public`, so the same hole cannot reappear with the next migration.

**3. Any signed-in user could create objects in the `public` schema.**
`anon` and `authenticated` both held `CREATE` on schema `public` (verified). This compounds
defect 1 — it is how a caller gets objects in front of an unpinned `search_path` in the first
place — and it is what makes the `extension_in_public` warning a live concern rather than a
cosmetic one. `0007` revokes `CREATE` and keeps `USAGE`, which is all PostgREST needs.

### Security-definer review

Every `SECURITY DEFINER` function was re-inspected: `handle_new_user()`,
`handle_user_email_change()`, `is_admin()`, `seller_profiles_guard()`,
`seller_profile_set_status()`, `seller_profile_set_seller()`, `admin_dashboard_counts()` and
`deal_source_save()`. All now pin `public, pg_temp`, all qualify the objects they touch, and
every one that acts on another person's record checks `public.is_admin()` for itself before
it does anything — `admin_dashboard_counts()`, both `seller_profile_set_*()` functions and
`deal_source_save()` all raise `42501` for a caller who is not an administrator. None takes
a role, a user id or a status from the browser and trusts it. The model is unchanged and
remains: **admin browser → `store.js` → database function → `public.is_admin()` → protected
operation.** The browser is never treated as proof of anything.

### `pg_trgm`: investigated and deliberately left in place

The linter reports `extension_in_public` for `pg_trgm`, which `0001` creates in `public`. It
is genuinely used: it supplies the `gin_trgm_ops` operator class behind
`public.listings_search_trgm_idx`, and the search the interface issues
(`search_text=ilike.*term*`) is exactly the pattern that index serves. **It is not removed** —
removing it would cost the catalogue its search index.

It is also not moved, and that is a deliberate decision rather than an oversight:

- It cannot be verified from this repository. The PostgreSQL build available for testing does
  not ship `pg_trgm` at all, so a move could not be exercised before being written into a
  migration the operator is asked to apply to a live project.
- `0001` is written to be re-runnable, and its index block names `gin_trgm_ops` without a
  schema. After a move, re-running `0001` would fail to resolve that name; the block's own
  exception handler would swallow it and print *"trigram index skipped"*. The index would in
  fact survive — an operator class is held by object id, not by name — but a migration that
  prints a misleading notice on a second run is a worse outcome than an accurately documented
  warning.
- It is cosmetic with respect to the risk. The risk the warning points at — a schema clients
  may write to — is fixed by defect 3 above.

An operator who wants the warning itself cleared can do it by hand, and should do it in this
order:

```sql
create schema if not exists extensions;
alter extension pg_trgm set schema extensions;
grant usage on schema extensions to anon, authenticated;
```

It is reversible (`alter extension pg_trgm set schema public`), it needs the `extensions`
schema to exist, and it should be followed by a search from the site to confirm the catalogue
still answers. **This is the one linter warning `0007` does not clear, and this README does
not claim otherwise.**

### Leaked-password protection

Supabase reports `auth_leaked_password_protection` when the project does not check passwords
against a breach corpus. **This is a project setting, not repository code, and PickVanta does
not and will not simulate it.** There is no password checker in this codebase, no breach list,
and nothing that pretends to provide the feature — adding one would be theatre.

**Status: not enabled, and not verifiable from here.** Enable it in the Supabase dashboard at
**Authentication → Providers → Email**, under password settings (*Prevent use of leaked
passwords* / *Leaked password protection*). Supabase checks new and changed passwords against
HaveIBeenPwned and refuses a known-breached one. No deployment step follows: the check happens
inside Supabase Auth, so the frontend, the anon key and the Vercel build are unaffected, and
this repository needs no change before or after.

### What `0007` refuses to do

It fails loudly rather than reporting success. Its self-check verifies that no function
PickVanta owns has a mutable `search_path` — extension functions installed in `public` are
excluded, which is what stopped the first attempt to apply this file to the live project — that
no client holds a catalogue write privilege, that no client
can create objects in `public`, that `anon` can still read the catalogue and `authenticated`
can still insert its own profile and application, that the six Deal Engine tables carry no
privilege they should not, and that Row Level Security is still enabled on every table. Run it
against a database where someone has re-granted a Deal Engine write, and it stops with an
error rather than printing a notice.

### Applying it

It runs **after `0006`** and is re-runnable: applying it twice changes nothing the second time.

```bash
psql "$DATABASE_URL" -f db/migrations/0007_security_hardening.sql
```

### What still needs the Supabase dashboard

| Item | Where | Repository can do it? |
| ---- | ----- | --------------------- |
| Leaked password protection | Authentication → Providers → Email | **No** — project setting |
| `extension_in_public` for `pg_trgm`, if it must be cleared | SQL editor, statements above | Partly — `0007` documents it; the operator runs it |
| Re-running the Security Linter to confirm `function_search_path_mutable` is gone | Dashboard → Advisors | **No** — only the operator can observe the live project |
| Google provider (already configured on the current project) | Authentication → Providers | **No** — one-time project setup |

**No warning is claimed as resolved here until the operator has applied `0007` and seen the
linter itself report it gone.** Everything above describes what the code does; the live
project's state is the live project's to report.


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

**Google Sign-In needs no frontend configuration at all.** It adds no key to
`js/config.js`, no variable to the Vercel build and no new file: the browser asks this
project's own Supabase Auth which providers are enabled, and the credentials that matter
live in the Supabase project ([Google Sign-In](#google-sign-in)). That is deliberately the same pattern
as the rest of the project — public values here, everything privileged out of band.

### Future providers

Apple Sign-In, MFA and the coming account features are **not** implemented. The provider
list in `js/auth.js` (`PROVIDERS`) plus the shared `signInWithProvider()` flow is what makes
them a small addition rather than another architecture: one entry per provider, its
configuration in the Supabase project, and — because the callback, the session handling,
the profile read and the error messages are provider-independent — no change to the rest of
the layer. `signInWithProvider()` is also where an MFA challenge or an additional
account-linking step would attach, not a second sign-in path.

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
| `domain.js` | **The domain model.** Canonical vocabularies, shape normalisers, label/format helpers (`money`, `priceText`, `locationLabel`, `availabilityInfo`, …) and the validators used by the store. Since Step 11 it also holds the seller/provider vocabularies and copy, since Step 12 the operational wording (`adminStatusCopy`, `adminAccountTypeCopy`), the review actions and their note limits, and since Step 13 the Deal Engine vocabularies (`DEAL_SOURCE_TYPES`, `DEAL_SOURCE_STATUS`, the pipeline stages and their terminal outcomes) plus `isSafeHttpUrl()` — the validator that decides whether a URL recorded from outside may become a link. Since Step 15 it also holds the canonical catalogue's vocabulary (`PRODUCT_STATUS`, `MERCHANT_OFFER_STATUS`, `VARIANT_STATUS` and their copy), the normalisers `normalizeProduct`, `normalizeProductVariant`, `normalizeMerchantOffer` and `normalizeExternalMerchant`, and the **deterministic identity helpers** — `normalizeBrand`, `normalizeModelNumber`, `normalizeGtin`, `productIdentityKey`, `variantOptionKey`, `merchantOfferPriceText`, `merchantOfferComparisonSupported`. Those helpers compute; none of them decides that two records are the same, and none makes a discount claim the recorded prices do not support. No DOM, no network, no data. |
| `store.js` | **Data access layer.** Owns both adapters, the public catalogue reads and the two write paths — a person's own application, and an administrator's review — the latter kept in its own `PV.store.admin` namespace so a privileged call is always recognisable at the call site and the catalogue's read paths never touch a private table. Since Step 13 it also exposes `PV.store.dealEngine.sources()` — read-only, admin-gated by RLS, with no demonstration-data fallback: private records either come from the database or the panel says so. Step 14 added the same namespace's `jobs` and `importedDeals`, and Step 15 added `merchants` (the external merchants a source introduced, for provenance) together with `PV.store.canonical.{products,variants,offers,counts}` — four `SELECT`-only reads decided by 0008's policies, and not one write. Owns both adapters (Supabase REST and the bundled demo catalogue) and the fallback policy, normalises and validates every record against `js/domain.js`, and implements retrieval, search, filtering, sorting, related options, offers, guides, taxonomy, the homepage selections and the paged `query()` envelope. **The single write path in the whole project** is `sellerAccounts.create/update`, which requires the person's own session and can only ever name their own row. No DOM, no user state. |
| `core.js` | Interface layer: DOM/format helpers, cards, loading/error/empty states, header/footer chrome, toast, compare tray, the browser-local compare and recently-viewed stores, and the filter/sort/search controls. It re-exports the data layer's price and label helpers through `PV.util` so view code has one import surface. |
| `auth.js` | **Authentication layer (Step 9).** The only module that talks to Supabase Auth. Owns the session (store, restore, refresh, drop), the current user and profile, the sign-up/sign-in/sign-out calls, the friendly message for every failure, and the account controls in the shared header (`#authControls`, `#authControlsMobile`). Exposes `PV.auth`; pages read state, they never keep their own copy. No DOM outside those two header hosts, no catalogue knowledge, no SDK — it is plain `fetch`, so the site stays dependency-free. |
| `account.js` | Account view controller for `account.html`: renders what `PV.auth` reports (sign-in form, create-account form, the signed-in summary, or the demonstration-mode notice), reads the person's own seller/provider applications for the **Sell or provide on PickVanta** section, and passes typed input to the layer. It makes no authentication decision of its own. |
| `admin.js` | **Steps 12–15.** Admin panel controller for `admin.html`: the four access states, the dashboard, the review queue, the application detail, the review confirmations, the Deal Engine's Sources list with the pipeline it feeds, and since Step 15 a read-only Products view — the canonical layer's counts and most recent records, with the merchant and source each offer came from. It renders no editor for a canonical record because none exists. It issues no request of its own — everything goes through `PV.store.admin` and `PV.store.dealEngine` — and every refusal is the database's. It decides what to *draw*, never what is allowed. Imported text is escaped at every rendering point: a hostile source name is shown as characters, never as markup. |
| `sell.js` | **Step 11.** Onboarding controller for `sell.html`: the account-type choice, the application form and its validation, the list of existing applications with their real status, and the honest failure states (signed out, no project configured, service unreachable, an edit the database refused). It asks `PV.store` for everything and issues no request of its own. |
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
such — no project, no keys, no network, and the account page explains that accounts need
the live catalogue. To read a live catalogue **and use accounts** instead: apply the
schema, the `0002` auth migration and the seed
([Database](#database-supabase--postgresql)), put your project URL and public anon key in
`js/config.js` (or a git-ignored `js/config.local.js` loaded before it), and set
`mode: 'api'`. If the project cannot be reached, the page shows an error
state and a retry control; set `onFailure: 'demo'` only for development and previews,
where a fallback is acceptable as long as it is labelled.

## Deliberately not built in this stage

Seller and provider dashboards, listing creation, editing, publishing or approval, any
other write path into the catalogue, payments, checkout, messaging, real seller contact,
favourites, notifications, subscriptions, affiliate/referral tracking, commissions, a
recommendation algorithm, AI, external product APIs, scraping, live pricing, real-time
inventory, reviews, ratings, testimonials, sales or popularity statistics. Sign-in is
email + password and Google: no Apple Sign-In, no passwordless links, no multi-factor
authentication, no account linking UI and no account deletion yet.

People are part of the system — one `profiles` row per account — and, since Step 11, a
person may apply to run a seller or provider account. Both stay deliberately thin. The
profile holds an email copy for convenience, a display name and a role; the application
holds what a business needs to be described and reviewed. Neither holds an address, a
payment detail or a preference. Applying does not create a listing, does not publish
anything and does not change a role: **admin is still a role the database can hold, with no
interface to use it**, and no seller or provider role exists at all.

Since Step 12 there **is** an admin panel, and it reviews applications — approve, reject,
suspend, archive, with a note. That is the whole of it. It manages no products, no
categories, no listings and no imports; its other navigation sections are labelled *Planned*
and are not clickable, because they do not exist.

Since Step 13 there is also the **Deal Engine's foundation**: six private tables modelling
where imported deals come from, what arrived, what happened to it and where it sits in the
pipeline, plus a Sources list in the admin panel. Nothing is connected to them. There is no
connector, no feed reader, no merchant API, no affiliate network, no scraper, no worker, no
schedule, no monitoring and no automatic publishing — and no fake imports, clicks,
conversions, commissions or revenue anywhere.

Since Step 15 the canonical catalogue **records** exist — Product, Variant and Merchant
Offer, with their media references and the provenance link back to the imported record — and
since Steps 16 and 17A one reviewed conversion fills them: a database function an
administrator calls from the Review Queue, one record at a time. There is still no automatic
conversion of an imported deal into a product, no AI or fuzzy product matching, no automatic
merging, no automatic publishing, and no page of the public catalogue reads any of it yet.

What is still not built around the panel, the application and those records is the
marketplace itself: no seller dashboard, no listing tools, no product editor, no affiliate
links, no commissions, no payments and no subscriptions. Step 11 built the participation
foundation, Step 12 the first review surface over it, Step 13 the engine room underneath it,
Step 14 its first operational controls, Step 15 the canonical records that engine room was
always going to produce, and Steps 16–17A the reviewed conversion that turns one imported
record into those records; none of them is the marketplace.
