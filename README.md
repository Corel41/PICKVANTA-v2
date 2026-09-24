# PICKVANTA-v2
PickVanta — Make the smarter pick. Modern discovery and deals platform.

**Stage:** Step 11 — seller and provider accounts established, with onboarding. A person
signs in as before (email + password, **or Google**), chooses whether they sell products or
provide services, describes the business and submits an application. It is stored in the
database as `pending`, visible only to them and to an administrator, and it publishes
nothing: approval is an operator action at the database layer, not something the browser can
grant itself. The account page gains one section — **Sell or provide on PickVanta** — that
shows the onboarding action, or the real status once an application exists.

The catalogue is unchanged and still comes from PostgreSQL on Supabase through the
read-only data API (`js/store.js`), whose only write path is now that one application. There
is one account system, one `profiles` row per person, and `role` (`user` \| `admin`) is
decided by the database — never the browser, and never by applying. Participation is an
entity plus ownership, not a role, so one person may later run more than one business.
`js/auth.js` remains the only module that talks to Supabase Auth, and the public catalogue
stays fully browsable without an account.

Still absent: no seller or provider dashboard, no admin interface, no listing tools, no
merchant offers or affiliate links, no payments, no live pricing, and no browser writes to
the catalogue.

> **The seller/provider migration (`db/migrations/0003_seller_provider_profiles.sql`) is
> written but has not been applied to any project.** Run `0001`, `0002` and `0003` in that
> order, then the seed. Until `0003` is applied, the onboarding page says plainly that
> applications need the live catalogue connection rather than offering a form that cannot be
> stored. See [Applying the schema](#applying-the-schema-and-the-seed).
>
> **Google Sign-In is implemented in this repository, but the Google provider still has to
> be configured on the Supabase project and in Google Cloud before the button can work on
> a deployment.** The code is complete and the button appears as soon as the provider is
> enabled; until then the account page says so plainly instead of offering a control that
> cannot work. See [Google Sign-In — configuration](#google-sign-in--configuration-required).

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

### Current (Step 11)

There are two paths, and they are deliberately separate. Browsing is public; an account
is only needed for the parts of the product that belong to a person.

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
  • Supabase adapter — read-only catalogue REST calls; the one write path is a
    person's own seller/provider application                  →  PostgreSQL on Supabase
  • demo adapter     — the bundled demonstration catalogue in js/data.js, loaded on
                       demand, and an honest refusal to store applications
```

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

### Not in this stage

Seller or admin areas, dashboards, seller onboarding, listing creation, payments,
checkout, messaging, notifications, subscriptions, reviews, ratings, passwordless
sign-in, multi-factor authentication, account deletion — and Apple Sign-In, which is
*not* implemented: Google is the only social provider in this step. Nothing in the
browser can write to the catalogue: the data API stays read-only for anon and for a
signed-in user alike, and `profiles` is the only table a signed-in person can touch —
their own row, `display_name` only.

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
db/seed/0001_catalogue.sql                    # the catalogue, upserted by primary key

# or from a terminal with a connection string (never committed):
psql "$DATABASE_URL" -f db/migrations/0001_catalogue.sql \
                     -f db/migrations/0002_auth_profiles.sql \
                     -f db/migrations/0003_seller_provider_profiles.sql \
                     -f db/seed/0001_catalogue.sql
```

`0003_seller_provider_profiles.sql` must run **after** `0001` and `0002` — it refuses to
run otherwise, naming the file it needs — and it ends with a self-check that fails the
migration if a policy, a grant or a function is not what it should be. Like the others it
is idempotent: re-running it replaces the trigger, the policies and the functions.

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

#### Google Sign-In — configuration required

**This repository contains the implementation, not the credentials.** Nothing below is
committed, and none of it belongs in the repository: it is configuration for the Google
Cloud project and the Supabase project, both of which are owned by the operator.

**Google Cloud Console** (APIs & Services → Credentials → Create credentials → OAuth client
ID → Web application):

| Setting | Value |
| ------- | ----- |
| Authorized JavaScript origins | the site's origins, e.g. `https://YOUR-PROJECT.vercel.app` and, for local work, `http://localhost:8000` (and `http://127.0.0.1:8000` if you use that form) |
| Authorized redirect URIs | `https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback` — Supabase's callback, **not** the site. For local Supabase CLI work, `http://127.0.0.1:54321/auth/v1/callback` |

The redirect URI must point at Supabase: Google talks to Supabase, and Supabase talks to
this app. Pointing it at the site itself produces the classic `redirect_uri_mismatch`.

**Supabase dashboard** (Authentication → Providers → Google): enable the provider and paste
the **Client ID** and **Client Secret** from the step above. They are stored in the Supabase
project and are never needed — or available — to the browser.

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
saying Google is not enabled — which is the honest state, not a bug.

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
live in the Supabase project ([Google Sign-In — configuration
required](#google-sign-in--configuration-required)). That is deliberately the same pattern
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
| `domain.js` | **The domain model.** Canonical vocabularies, shape normalisers, label/format helpers (`money`, `priceText`, `locationLabel`, `availabilityInfo`, …) and the validators used by the store. No DOM, no network, no data. |
| `store.js` | **Data access layer.** Owns both adapters (Supabase REST and the bundled demo catalogue) and the fallback policy, normalises and validates every record against `js/domain.js`, and implements retrieval, search, filtering, sorting, related options, offers, guides, taxonomy, the homepage selections and the paged `query()` envelope. **The single write path in the whole project** is `sellerAccounts.create/update`, which requires the person's own session and can only ever name their own row. No DOM, no user state. |
| `core.js` | Interface layer: DOM/format helpers, cards, loading/error/empty states, header/footer chrome, toast, compare tray, the browser-local compare and recently-viewed stores, and the filter/sort/search controls. It re-exports the data layer's price and label helpers through `PV.util` so view code has one import surface. |
| `auth.js` | **Authentication layer (Step 9).** The only module that talks to Supabase Auth. Owns the session (store, restore, refresh, drop), the current user and profile, the sign-up/sign-in/sign-out calls, the friendly message for every failure, and the account controls in the shared header (`#authControls`, `#authControlsMobile`). Exposes `PV.auth`; pages read state, they never keep their own copy. No DOM outside those two header hosts, no catalogue knowledge, no SDK — it is plain `fetch`, so the site stays dependency-free. |
| `account.js` | Account view controller for `account.html`: renders what `PV.auth` reports (sign-in form, create-account form, the signed-in summary, or the demonstration-mode notice), reads the person's own seller/provider applications for the **Sell or provide on PickVanta** section, and passes typed input to the layer. It makes no authentication decision of its own. |
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

What is *not* built around that application is the marketplace itself: no admin review
screen (the two functions are called by an operator with SQL), no seller dashboard, no
listing tools, no product variants, no merchant offers, no affiliate links, no Deal Engine,
no commissions, no payments and no subscription. Step 11 is the foundation those stages
will stand on, not the first of them.
