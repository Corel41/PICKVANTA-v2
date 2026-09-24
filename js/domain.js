/* ==========================================================================
   PickVanta — domain model (js/domain.js)
   --------------------------------------------------------------------------
   The canonical description of what a PickVanta record IS, plus the rules for
   reading, normalising and validating it. This module is the contract a future
   API and database will satisfy:

       demo data (js/data.js)  ─┐
                                ├─→  domain.js  (model, normalise, validate)
       future API / database  ─┘         ↓
                                       store.js  (retrieval, search, filter, sort)
                                         ↓
                                    controllers → pages

   Contents
     1. Enum-shaped vocabularies (types, statuses, price types, offer kinds …)
     2. Small value helpers (slug, money, price/detail formatting)
     3. Normalisers   raw record  → canonical entity
     4. Validators    canonical entity → { valid, issues[] }
     5. Model documentation (see the ENTITIES block below)

   ENTITIES
     Listing   the discoverable entity — a product or a service (never inferred)
     Seller    the provider of a listing, referenced by sellerId
     Category  top-level taxonomy bucket, owns its Subcategories
     Location  structured place (country / county / city / area / service area)
     Price     structured money (amount | min–max, priceType) + currency
     Offer     a time-bounded deal that references a listing by listingId
     Guide     decision-support content with structured outline sections

   Reading old or foreign shapes
     Normalisers accept the field names a source may still use — `attributes`
     for `specifications`, `listedAt` for `createdAt`/`updatedAt`, `covers` for
     guide sections, `image` for `images[0]`, a currency inside a price block —
     and always emit the canonical names. Only the *input* side is tolerant;
     nothing downstream has to know about them.

   Rules that hold everywhere in this module:
     • no presentation strings are stored in the data — the UI formats amounts
       from numbers plus a currency code;
     • no verdict fields exist (no best / recommended / winner / score / rank);
     • no reviews, ratings, sales counts or popularity statistics exist;
     • every entity tolerates optional fields, and nothing here throws.
   ========================================================================== */
window.PV = window.PV || {};

window.PV.domain = (function () {
  'use strict';

  /* ======================================================================
     1. Vocabularies
     ====================================================================== */

  /** A listing is always one of these two — never inferred from other fields. */
  const LISTING_TYPES = ['product', 'service'];
  const TYPE_LABEL = { product: 'Product', service: 'Service' };

  /** Lifecycle. Only `published` listings are discoverable. */
  const LISTING_STATUS = ['draft', 'published', 'archived'];
  const LISTING_STATUS_LABEL = { draft: 'Draft', published: 'Published', archived: 'Archived' };

  /** What the listing says about availability right now (not lifecycle). */
  const AVAILABILITY = [
    { code: 'available', label: 'Available', tone: 'ok', help: 'Listed as available in this demo' },
    { code: 'limited', label: 'Limited', tone: 'warn', help: 'Listed as limited in this demo' },
    { code: 'by-appointment', label: 'By appointment', tone: 'info', help: 'Arranged with the provider' },
    { code: 'on-request', label: 'On request', tone: 'info', help: 'Details shared by the provider' },
    { code: 'unavailable', label: 'Unavailable', tone: 'muted', help: 'Not currently offered' }
  ];

  /**
   * How a price is charged. `fixed` is a single amount; the per-* types carry a
   * unit; `range` is a min–max band; `starting-from` is a lower bound only;
   * `quote` means the provider prices the work after scoping it.
   */
  const PRICE_TYPES = [
    'fixed', 'range', 'starting-from', 'quote',
    'per-item', 'per-person',
    'per-hour', 'per-day', 'per-night', 'per-week', 'per-month', 'per-year',
    'per-session', 'per-lesson', 'per-visit', 'per-package'
  ];
  /* Suffix shown after the amount (e.g. "/month") — never a prefix. */
  const PRICE_TYPE_LABEL = {
    fixed: '', range: '', 'starting-from': '',
    quote: '', 'per-item': '/item', 'per-person': '/person',
    'per-hour': '/hour', 'per-day': '/day', 'per-night': '/night',
    'per-week': '/week', 'per-month': '/month', 'per-year': '/year',
    'per-session': '/session', 'per-lesson': '/lesson', 'per-visit': '/visit',
    'per-package': '/package'
  };
  /* Prefix shown before the amount — only "starting from" prices need one. */
  const PRICE_TYPE_PREFIX = { 'starting-from': 'From ' };

  /** Offer (deal) vocabulary. An offer is always attached to a listing. */
  const OFFER_KINDS = ['percentage', 'fixed-price', 'package', 'bundle', 'limited', 'billing', 'introductory'];
  const OFFER_KIND_LABEL = {
    percentage: 'Percentage discount',
    'fixed-price': 'Fixed-price offer',
    package: 'Service package',
    bundle: 'Bundle offer',
    limited: 'Limited-time offer',
    billing: 'Billing discount',
    introductory: 'Introductory price'
  };
  /** An offer carries its own lifecycle; the UI never invents urgency. */
  const OFFER_STATUS = ['scheduled', 'active', 'ended', 'withdrawn'];

  /** Sellers/providers. No accounts exist — this is a reference, nothing more. */
  const SELLER_TYPES = ['brand-store', 'retailer', 'service-provider', 'host', 'provider', 'seller'];
  const SELLER_STATUS = ['published', 'draft', 'archived'];
  const VERIFICATION_STATUS = ['unverified', 'demo-verified'];

  /**
   * Seller / provider accounts (Step 11). The closed vocabulary the database
   * also enforces (see db/migrations/0003_seller_provider_profiles.sql) —
   * defined here so the interface never invents a value the database would
   * reject, and the two can be compared directly.
   *
   *   account types   a seller sells products; a provider provides services
   *   statuses        the review lifecycle: a person applies (pending), an
   *                   administrator reviews it (active, rejected, suspended)
   *                   and a closed business is archived. Only 'pending' can
   *                   ever be set by a client.
   */
  const SELLER_ACCOUNT_TYPES = ['seller', 'provider'];
  const SELLER_ACCOUNT_STATUS = ['pending', 'active', 'suspended', 'rejected', 'archived'];

  /** How each account type is described in the interface. The underlying
   *  account structure is shared; only the language differs. */
  const SELLER_ACCOUNT_COPY = {
    seller: {
      label: 'Seller',
      plural: 'Sellers',
      verb: 'sell products',
      title: 'I want to sell products',
      blurb: 'For businesses that sell products — electronics, home, fashion, anything with a price and a stock position.',
      nameLabel: 'Business name',
      namePlaceholder: 'e.g. Nairobi Home Electronics',
      descriptionLabel: 'What do you sell?'
    },
    provider: {
      label: 'Provider',
      plural: 'Providers',
      verb: 'provide services',
      title: 'I provide services',
      blurb: 'For businesses and professionals that provide services — installation, repair, travel, training, consultancy.',
      nameLabel: 'Business or practice name',
      namePlaceholder: 'e.g. Kirinyaga Solar Installations',
      descriptionLabel: 'What services do you provide?'
    }
  };

  /** The status a person sees, in plain language. Never a raw enum. */
  const SELLER_ACCOUNT_STATUS_COPY = {
    pending: {
      label: 'Pending review',
      tone: 'waiting',
      message: 'Your application is with PickVanta for review. Nothing is published yet, and you can still edit these details while it is being reviewed.'
    },
    active: {
      label: 'Active',
      tone: 'good',
      message: 'This account is approved. Listing tools arrive in a later stage — nothing is published from this page yet.'
    },
    suspended: {
      label: 'Suspended',
      tone: 'warning',
      message: 'This account is paused while PickVanta reviews it. Contact PickVanta if you think this is a mistake.'
    },
    rejected: {
      label: 'Not approved',
      tone: 'warning',
      message: 'This application was not approved. You can read the note below, and you are welcome to apply again with corrected details.'
    },
    archived: {
      label: 'Archived',
      tone: 'neutral',
      message: 'This account is closed and no longer active on PickVanta.'
    }
  };

  /** Locations. PickVanta starts Kenya-focused. */
  const LOCATION_FORMATS = ['local', 'nationwide', 'online', 'unspecified'];
  const DEFAULT_COUNTRY = 'Kenya';

  const GUIDE_STATUS = ['draft', 'published', 'archived'];

  const CURRENCY_SYMBOL = { KES: 'KSh ', USD: '$', EUR: '€', GBP: '£' };
  const DEFAULT_CURRENCY = 'KES';

  /* ======================================================================
     2. Value helpers
     ====================================================================== */

  const str = (value) => (value == null ? '' : String(value));
  const trim = (value) => str(value).trim();
  const asArray = (value) => (Array.isArray(value) ? value : []);
  const isBlank = (value) => trim(value) === '';
  const num = (value) => (value == null || value === '' || isNaN(Number(value)) ? null : Number(value));

  /** URL-safe identifier derived from a display name. */
  const slugify = (value) => trim(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

  /** "per-month" → "Per month"; "on-request" → "On request". */
  const humanise = (code) => trim(code).replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  const titleCase = (code) => trim(code).split(/[\s-]+/).filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

  /** Money from structured values only — never from a stored string. */
  function money(amount, currency) {
    const n = Number(amount);
    if (!isFinite(n)) return '';
    const code = trim(currency) || DEFAULT_CURRENCY;
    return (CURRENCY_SYMBOL[code] || code + ' ') + n.toLocaleString('en-US', { maximumFractionDigits: n % 1 ? 2 : 0 });
  }

  /** The unit suffix for a price type, e.g. "per-month" → "/month". */
  const priceUnitSuffix = (priceType) => PRICE_TYPE_LABEL[trim(priceType)] || '';

  /** Normalise loose unit words ("month", "night") onto price types. */
  function priceTypeFromUnit(unit) {
    const u = trim(unit).toLowerCase();
    if (!u) return 'fixed';
    const candidate = 'per-' + u;
    return PRICE_TYPES.indexOf(candidate) !== -1 ? candidate : 'fixed';
  }

  /** Fill in a price type that a source did not state. */
  function inferPriceType(price) {
    const p = price || {};
    if (p.priceType && PRICE_TYPES.indexOf(p.priceType) !== -1) return p.priceType;
    if (p.amount == null && p.min == null && p.max == null) return 'quote';
    if (p.unit) return priceTypeFromUnit(p.unit);
    if (p.amount != null) return 'fixed';
    return 'range';
  }

  /** Human price for a listing: "KSh 12,000", "KSh 3,500 – KSh 6,500", "KSh 2,900/month". */
  function priceText(record) {
    const price = record && record.price;
    if (!price) return 'Price on request';
    const currency = (record && record.currency) || price.currency || DEFAULT_CURRENCY;
    const type = inferPriceType(price);
    if (type === 'quote' || (price.amount == null && (price.min == null || price.max == null))) return 'Price on request';
    const suffix = priceUnitSuffix(type);
    const prefix = PRICE_TYPE_PREFIX[type] || '';
    if (price.amount != null) return prefix + money(price.amount, currency) + suffix;
    return prefix + money(price.min, currency) + ' – ' + money(price.max, currency) + suffix;
  }

  /** Numeric value used for sorting and price bands (ranges use their lower bound). */
  function priceValue(record) {
    const price = record && record.price;
    if (!price) return Number.MAX_SAFE_INTEGER;
    if (price.amount != null) return Number(price.amount);
    if (price.min != null) return Number(price.min);
    return Number.MAX_SAFE_INTEGER;
  }

  /** Structured location → one readable line. Never invents a place. */
  function locationLabel(record) {
    const l = record && record.location;
    if (!l) return 'Location not stated';
    if (l.format === 'online') return 'Online / nationwide';
    if (l.format === 'nationwide') return 'Nationwide (demo)';
    if (l.city && l.county && l.county.indexOf(l.city) === -1) return l.city + ', ' + l.county;
    return l.city || l.county || l.country || 'Location not stated';
  }

  /** Service area as a readable list, or '' when a listing has none. */
  const serviceAreaText = (record) => asArray(record && record.location && record.location.serviceArea).join(', ');

  const typeLabel = (type) => TYPE_LABEL[trim(type)] || 'Item';
  const categoryLabel = (code) => (isBlank(code) ? 'Uncategorised' : titleCase(code));

  function availabilityInfo(code) {
    const found = AVAILABILITY.find((a) => a.code === code);
    return found || { code: trim(code) || 'unspecified', label: isBlank(code) ? 'Availability not stated' : humanise(code), tone: 'info', help: '' };
  }

  const listingStatusLabel = (code) => LISTING_STATUS_LABEL[trim(code)] || 'Draft';
  const offerKindLabel = (offer) => (offer && offer.kind ? OFFER_KIND_LABEL[offer.kind] || 'Offer' : 'Offer');
  const sellerLabel = (record) => trim(record && record.seller && record.seller.name) || 'Seller not stated';

  /** Is this one of the two account types? Exposed so views never guess. */
  const isSellerAccountType = (value) => SELLER_ACCOUNT_TYPES.indexOf(trim(value)) !== -1;
  /**
   * Administrative wording (Step 12).
   *
   * The applicant-facing copy above is deliberately soft ("Not approved",
   * "we will review it"). An operator working a queue needs the operational
   * word, the same one the database stores, so the two audiences do not read
   * the same sentence and infer different states.
   */
  const ADMIN_ACCOUNT_TYPE_COPY = {
    seller: { label: 'Seller', blurb: 'A business that sells products.' },
    provider: { label: 'Provider', blurb: 'A business that provides services.' }
  };

  const ADMIN_STATUS_COPY = {
    pending: { label: 'Pending', tone: 'waiting' },
    active: { label: 'Active', tone: 'good' },
    suspended: { label: 'Suspended', tone: 'warning' },
    rejected: { label: 'Rejected', tone: 'warning' },
    archived: { label: 'Archived', tone: 'neutral' }
  };

  /**
   * The review actions an operator can take. Each one maps to a status the
   * database's own vocabulary already contains, and is performed through
   * public.seller_profile_set_status() — never by writing the column.
   *
   * The note limit is the database's limit: 0003 rejects anything longer.
   */
  const REVIEW_NOTE_MAX = 500;
  const REVIEW_ACTIONS = [
    {
      status: 'active',
      label: 'Approve',
      tone: 'good',
      heading: 'Approve this account?',
      blurb: 'The account becomes active and the applicant sees that it is approved. ' +
        'Listing tools are a later stage — approving publishes nothing.',
      noteLabel: 'Approval note (optional)',
      notePlaceholder: 'Anything the next reviewer should know.'
    },
    {
      status: 'rejected',
      label: 'Reject',
      tone: 'warning',
      heading: 'Reject this application?',
      blurb: 'The application is closed as rejected. The applicant can read your note and ' +
        'apply again with corrected details.',
      noteLabel: 'Reason (optional)',
      notePlaceholder: 'Why this application was not approved.'
    },
    {
      status: 'suspended',
      label: 'Suspend',
      tone: 'warning',
      heading: 'Suspend this account?',
      blurb: 'The account is paused. The applicant sees that it is suspended, and you can ' +
        'approve it again later.',
      noteLabel: 'Reason (optional)',
      notePlaceholder: 'Why this account is paused.'
    },
    {
      status: 'archived',
      label: 'Archive',
      tone: 'neutral',
      heading: 'Archive this account?',
      blurb: 'The account is closed and kept for records — nothing is deleted. It can be ' +
        'approved again later.',
      noteLabel: 'Archive note (optional)',
      notePlaceholder: 'Anything worth recording.'
    }
  ];

  /* Which actions an operator is offered for the status an account is in.
     This is guidance for the interface, not a rule the database relies on:
     0003 accepts any of the five statuses and is the authority. Nothing here
     can grant a privilege — it only decides which buttons are drawn. */
  const ADMIN_ACTION_TARGETS = {
    pending: ['active', 'rejected', 'archived'],
    active: ['suspended', 'archived'],
    suspended: ['active', 'rejected', 'archived'],
    rejected: ['active', 'archived'],
    archived: ['active']
  };

  const isSellerAccountStatus = (value) => SELLER_ACCOUNT_STATUS.indexOf(trim(value)) !== -1;

  /** The wording for an account type or status, with a safe fallback. */
  function sellerAccountCopy(accountType) {
    return SELLER_ACCOUNT_COPY[trim(accountType)] || null;
  }
  function sellerAccountStatusCopy(status) {
    const key = trim(status);
    return SELLER_ACCOUNT_STATUS_COPY[key] || {
      label: 'Unknown',
      tone: 'neutral',
      message: 'The status of this account could not be read.'
    };
  }
  /** "Seller" / "Provider" — used wherever a person is named, never a raw enum. */
  function sellerAccountTypeLabel(accountType) {
    const copy = sellerAccountCopy(accountType);
    return copy ? copy.label : 'Account';
  }

  /** The operational wording for an account type: "Seller — a business that sells products." */
  function adminAccountTypeCopy(accountType) {
    return ADMIN_ACCOUNT_TYPE_COPY[trim(accountType)] || { label: 'Account', blurb: 'Type not recorded.' };
  }

  /** The operational word for a status, for the admin panel. */
  function adminStatusCopy(status) {
    const key = trim(status);
    return ADMIN_STATUS_COPY[key] || { label: 'Unknown', tone: 'neutral' };
  }

  /** The review actions available for an account that is in `status`. */
  function adminReviewActionsFor(status) {
    const allowed = ADMIN_ACTION_TARGETS[trim(status)] || [];
    return REVIEW_ACTIONS.filter((action) => allowed.indexOf(action.status) !== -1);
  }

  /* ======================================================================
     Deal Engine (Step 13)

     The private side of PickVanta: records that were imported from outside,
     and the pipeline that will carry them from a source to a published deal.
     These vocabularies mirror db/migrations/0005_deal_engine_foundation.sql
     exactly, so the interface can never name a value the database would
     refuse — and so a reader can compare the two directly.

     Two things the wording here must never do: call an imported record a
     listing (it is not one until a person publishes it), and call the
     affiliate destination a source. They are different columns in the
     database for the same reason.
     ====================================================================== */

  /** How imported information is reached. None of these is connected yet. */
  const DEAL_SOURCE_TYPES = ['marketplace-feed', 'affiliate-network-feed', 'merchant-api',
    'merchant-product-feed', 'permitted-url-source'];
  const DEAL_SOURCE_STATUS = ['active', 'paused', 'disabled', 'archived'];

  const DEAL_SOURCE_TYPE_COPY = {
    'marketplace-feed': {
      label: 'Marketplace feed',
      blurb: 'A feed published by a marketplace for partners to read.'
    },
    'affiliate-network-feed': {
      label: 'Affiliate network feed',
      blurb: 'A product feed from an affiliate network, where a tracked link is issued per product.'
    },
    'merchant-api': {
      label: 'Merchant API',
      blurb: 'A merchant’s own interface, read with credentials kept on the server.'
    },
    'merchant-product-feed': {
      label: 'Merchant product feed',
      blurb: 'A file a merchant publishes directly for partners.'
    },
    'permitted-url-source': {
      label: 'Permitted URL source',
      blurb: 'A source PickVanta is allowed to read by agreement. Not crawling and not scanning.'
    }
  };

  const DEAL_SOURCE_STATUS_COPY = {
    active: { label: 'Active', tone: 'good' },
    paused: { label: 'Paused', tone: 'waiting' },
    disabled: { label: 'Disabled', tone: 'warning' },
    archived: { label: 'Archived', tone: 'neutral' }
  };

  /**
   * The stages an imported record moves through, in order, plus the three
   * terminal outcomes. Nothing runs any of this yet: it is the shape the
   * pipeline will have, and the panel says so where it shows it.
   */
  const DEAL_PIPELINE_STAGES = [
    { id: 'imported', label: 'Imported', blurb: 'The record arrived from a source and is kept as it arrived.' },
    { id: 'validated', label: 'Validated', blurb: 'Checked for the things that make it usable: an identifier, a name, a readable price and URL.' },
    { id: 'normalized', label: 'Normalized', blurb: 'External formats mapped to PickVanta’s own: currency, category, availability.' },
    { id: 'deduplicated', label: 'Deduplicated', blurb: 'Matched against what is already here — exactly, probably, or with uncertainty kept for a person.' },
    { id: 'pending-review', label: 'Pending review', blurb: 'Waiting for an administrator. Nothing publishes itself.' },
    { id: 'approved', label: 'Approved', blurb: 'Reviewed and accepted, not yet public.' },
    { id: 'published', label: 'Published', blurb: 'A public deal exists and can be browsed.' }
  ];
  const DEAL_PIPELINE_TERMINAL = [
    { id: 'rejected', label: 'Rejected', blurb: 'Reviewed and not accepted. Kept for records.' },
    { id: 'archived', label: 'Archived', blurb: 'Closed and kept, never deleted.' },
    { id: 'failed', label: 'Failed', blurb: 'Processing could not finish. The reason is recorded.' }
  ];

  /** The wording for a source type or status, with a safe fallback. */
  function dealSourceTypeCopy(sourceType) {
    const key = trim(sourceType);
    return DEAL_SOURCE_TYPES.indexOf(key) === -1 ? {
      label: 'Unknown type',
      blurb: 'This source type is not one the interface knows.'
    } : DEAL_SOURCE_TYPE_COPY[key];
  }
  function dealSourceStatusCopy(status) {
    const key = trim(status);
    return DEAL_SOURCE_STATUS.indexOf(key) === -1 ? { label: 'Unknown', tone: 'neutral' }
      : DEAL_SOURCE_STATUS_COPY[key];
  }

  /**
   * A URL that is safe to put in a link, and only http(s).
   *
   * Imported data is untrusted input: a source URL arrives from outside and a
   * `javascript:` or `data:` value in an href is an executable script, not a
   * link. The database already constrains these columns, and this is the
   * second check, at the only place in the interface that renders one — so a
   * row that somehow got past the constraint still cannot become a link.
   */
  function isSafeHttpUrl(value) {
    const url = trim(value);
    if (!/^https?:\/\/[^\s]+$/i.test(url)) return false;
    /* Control characters and quotes cannot appear in a real URL and would be
       an attempt to break out of the attribute. */
    return !/[\u0000-\u001f"<>\\]/.test(url);
  }

  /**
   * The admin dashboard's counts.
   *
   * A number that the database did not return stays null — the panel shows
   * "Not available" for it. Filling a gap with 0 would be inventing a
   * statistic, which is exactly what this dashboard must not do.
   */
  function normalizeAdminCounts(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const group = (node, keys) => {
      const from = node && typeof node === 'object' ? node : {};
      const out = {};
      keys.forEach((key) => {
        const value = num(from[key]);
        out[key] = value === null || value === undefined ? null : value;
      });
      return out;
    };
    return {
      applications: group(source.applications,
        ['total', 'pending', 'active', 'suspended', 'rejected', 'archived']),
      catalogue: group(source.catalogue, ['published_listings', 'active_deals', 'demo_sellers'])
    };
  }

  /** Formatting date values that come from the data as ISO strings. */
  function formatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso + 'T00:00:00');
    if (isNaN(d)) return iso;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();
  }

  /* ======================================================================
     3. Normalisers  (raw → canonical)
     ====================================================================== */

  /** A price is always structured; display strings are produced elsewhere. */
  function normalizePrice(price) {
    if (!price || typeof price !== 'object') return null;
    const p = price;
    /* `currency` is a listing-level field in the canonical model; any currency
       that arrives inside a price block is hoisted by normalizeListing. */
    const normalized = {
      amount: num(p.amount),
      min: num(p.min),
      max: num(p.max),
      priceType: inferPriceType(p)
    };
    if (normalized.amount == null && normalized.min == null && normalized.max == null) return null;
    return normalized;
  }

  function normalizeLocation(location) {
    const l = location && typeof location === 'object' ? location : {};
    const format = LOCATION_FORMATS.indexOf(trim(l.format)) !== -1 ? trim(l.format) : 'unspecified';
    return {
      country: trim(l.country) || DEFAULT_COUNTRY,
      county: trim(l.county),
      city: trim(l.city),
      area: trim(l.area),
      serviceArea: asArray(l.serviceArea).map(trim).filter(Boolean),
      format: format
    };
  }

  function normalizeImages(images, name) {
    const list = asArray(images).filter(Boolean).map(function (img, idx) {
      const i = typeof img === 'string' ? { src: img } : img;
      return {
        id: trim(i.id) || 'img-' + (idx + 1),
        position: Number.isFinite(Number(i.position)) ? Number(i.position) : idx,
        src: trim(i.src) || null,
        alt: trim(i.alt) || trim(name) || 'Listing image',
        icon: trim(i.icon) || '📦',
        gradient: trim(i.gradient)
      };
    });
    if (!list.length) {
      list.push({ id: 'img-1', position: 0, src: null, alt: trim(name) || 'Listing image', icon: '📦', gradient: '' });
    }
    return list.sort((a, b) => a.position - b.position);
  }

  /** The image a card or tile should show (position 0). */
  const primaryImage = (record) => (record && record.images && record.images.length ? record.images[0] : null);

  function normalizeSpecifications(specs) {
    return asArray(specs)
      .map((s) => ({ label: trim(s && s.label), value: trim(s && s.value), group: trim(s && s.group) || 'Specifications' }))
      .filter((s) => s.label && s.value);
  }

  function normalizeSeller(raw, taxonomy) {
    const s = raw && typeof raw === 'object' ? raw : {};
    const name = trim(s.name) || 'Demo seller';
    const type = SELLER_TYPES.indexOf(trim(s.type)) !== -1 ? trim(s.type) : 'seller';
    return {
      id: trim(s.id) || slugify(name) || 'seller-unknown',
      name: name,
      slug: trim(s.slug) || slugify(name),
      type: type,
      typeLabel: titleCase(type),
      description: trim(s.description),
      location: normalizeLocation(s.location),
      /* Contact fields exist for the future API but carry no invented detail:
         PickVanta publishes no phone numbers, emails or websites today. */
      contact: {
        email: trim(s.contact && s.contact.email) || null,
        phone: trim(s.contact && s.contact.phone) || null,
        website: trim(s.contact && s.contact.website) || null
      },
      verificationStatus: VERIFICATION_STATUS.indexOf(trim(s.verificationStatus)) !== -1 ? trim(s.verificationStatus) : 'unverified',
      status: SELLER_STATUS.indexOf(trim(s.status)) !== -1 ? trim(s.status) : 'published',
      demo: true,
      /* Kept so the UI can keep saying "demo" next to a provider name. */
      demoLabel: 'demo',
      taxonomyKnown: !taxonomy || true
    };
  }

  /**
   * The canonical listing. `ctx` supplies the taxonomy and known sellers so the
   * normaliser can resolve references and report anything it cannot.
   */
  function normalizeListing(raw, ctx) {
    const context = ctx || {};
    const issues = [];
    if (!raw || typeof raw !== 'object') {
      return { listing: null, issues: [issue('error', 'listing-not-an-object', 'Record is not an object.', null)] };
    }

    const id = trim(raw.id);
    const name = trim(raw.name);
    if (!id) issues.push(issue('error', 'listing-id-missing', 'A listing must have an id.', null));
    if (!name) issues.push(issue('error', 'listing-name-missing', 'A listing must have a name.', id || null));

    /* type is data, never an inference */
    let type = trim(raw.type);
    if (LISTING_TYPES.indexOf(type) === -1) {
      issues.push(issue('error', 'listing-type-invalid', 'A listing type must be "product" or "service" (got "' + (type || 'nothing') + '").', id || null));
      type = null;
    }

    const category = trim(raw.category);
    if (!category) issues.push(issue('error', 'listing-category-missing', 'A listing must belong to a category.', id || null));

    const status = LISTING_STATUS.indexOf(trim(raw.status)) !== -1 ? trim(raw.status) : 'draft';
    if (trim(raw.status) && LISTING_STATUS.indexOf(trim(raw.status)) === -1) {
      issues.push(issue('warning', 'listing-status-invalid', 'Unknown listing status "' + trim(raw.status) + '" — treated as draft.', id || null));
    }

    const availability = AVAILABILITY.some((a) => a.code === trim(raw.availability)) ? trim(raw.availability) : 'available';

    const price = normalizePrice(raw.price);
    if (raw.price && !price) {
      issues.push(issue('warning', 'listing-price-invalid', 'Price block has no usable amount, minimum or maximum.', id || null));
    }
    const rawCurrency = trim(raw.currency) || trim(raw.price && raw.price.currency) || trim(raw.seller && raw.seller.currency);
    if (price && !rawCurrency) {
      issues.push(issue('warning', 'listing-currency-missing', 'No currency code was given — the KES default was applied.', id || null));
    }

    const subcategory = trim(raw.subcategory);
    const taxonomy = context.taxonomy || null;
    if (taxonomy && subcategory) {
      const match = findSubcategory(taxonomy, category, subcategory);
      if (!match) issues.push(issue('warning', 'listing-subcategory-unknown', 'Subcategory "' + subcategory + '" is not in the ' + category + ' taxonomy.', id || null));
    }

    const sellerRef = trim(raw.sellerId) || trim(raw.seller && raw.seller.id);
    if (taxonomy && context.sellerIds && sellerRef && context.sellerIds.indexOf(sellerRef) === -1) {
      issues.push(issue('warning', 'listing-seller-unknown', 'References unknown seller "' + sellerRef + '".', id || null));
    }

    const listing = {
      id: id,
      type: type,
      name: name,
      slug: trim(raw.slug) || slugify(name) || id,
      shortDescription: trim(raw.shortDescription),
      description: trim(raw.description) || trim(raw.shortDescription),
      brand: trim(raw.brand),
      category: category,
      subcategory: subcategory,
      tags: asArray(raw.tags).map((t) => trim(t).toLowerCase()).filter(Boolean),
      highlights: asArray(raw.highlights).map(trim).filter(Boolean),
      images: normalizeImages(raw.images || raw.image, name),
      price: price,
      currency: rawCurrency || DEFAULT_CURRENCY,
      referencePrice: num(raw.referencePrice),
      location: normalizeLocation(raw.location),
      availability: availability,
      sellerId: sellerRef || '',
      specifications: normalizeSpecifications(raw.specifications || raw.attributes),
      status: status,
      createdAt: trim(raw.createdAt) || trim(raw.listedAt) || null,
      updatedAt: trim(raw.updatedAt) || trim(raw.listedAt) || null,
      /* The attached offer is referenced by id; the store joins the full offer
         object on (see `attachOffer`) so cards can render it in one pass. */
      offerId: trim(raw.offerId) || null,
      offer: null
    };
    return { listing: listing, issues: issues };
  }

  function normalizeOffer(raw, ctx) {
    const context = ctx || {};
    const issues = [];
    if (!raw || typeof raw !== 'object') {
      return { offer: null, issues: [issue('error', 'offer-not-an-object', 'Offer is not an object.', null)] };
    }
    const listingId = trim(raw.listingId) || trim(raw.itemId) || trim(raw.listing && raw.listing.id);
    const id = trim(raw.id);
    if (!id) issues.push(issue('error', 'offer-id-missing', 'An offer must have an id.', listingId || null));
    if (!listingId) {
      issues.push(issue('error', 'offer-listing-missing', 'An offer must reference a listing.', id || null));
    } else if (context.listingIds && context.listingIds.indexOf(listingId) === -1) {
      issues.push(issue('error', 'offer-listing-unknown', 'Offer references a listing that does not exist ("' + listingId + '").', id || null));
    }

    const originalPrice = num(raw.originalPrice != null ? raw.originalPrice : raw.referencePrice);
    const offerPrice = num(raw.offerPrice != null ? raw.offerPrice : raw.dealPrice);
    const kind = OFFER_KINDS.indexOf(trim(raw.kind)) !== -1 ? trim(raw.kind) : 'percentage';
    if (trim(raw.kind) && OFFER_KINDS.indexOf(trim(raw.kind)) === -1) {
      issues.push(issue('warning', 'offer-kind-unknown', 'Unknown offer kind "' + trim(raw.kind) + '".', id || null));
    }
    const derived = originalPrice && offerPrice ? Math.round(((originalPrice - offerPrice) / originalPrice) * 100) : 0;
    const startsAt = trim(raw.startsAt) || trim(raw.validFrom) || null;
    const endsAt = trim(raw.endsAt) || trim(raw.validTo) || null;
    if (!endsAt) issues.push(issue('warning', 'offer-end-missing', 'Offer has no end date, so no urgency can be shown.', id || null));

    const offer = {
      id: id,
      listingId: listingId,
      title: trim(raw.title) || trim(raw.headline),
      description: trim(raw.description) || '',
      kind: kind,
      originalPrice: originalPrice,
      offerPrice: offerPrice,
      discountPercent: num(raw.discountPercent) != null ? num(raw.discountPercent) : derived,
      currency: trim(raw.currency) || (context.currency || DEFAULT_CURRENCY),
      startsAt: startsAt,
      endsAt: endsAt,
      availability: AVAILABILITY.some((a) => a.code === trim(raw.availability)) ? trim(raw.availability) : 'available',
      sellerId: trim(raw.sellerId) || context.sellerId || '',
      status: statusForOffer(startsAt, endsAt, raw.status),
      conditions: asArray(raw.conditions).map(trim).filter(Boolean),
      demo: true
    };
    return { offer: offer, issues: issues };
  }

  /** Offer lifecycle from its own dates. No urgency is invented anywhere. */
  function statusForOffer(startsAt, endsAt, declared) {
    const declaredCode = trim(declared);
    if (declaredCode === 'withdrawn') return 'withdrawn';
    const now = new Date();
    const start = startsAt ? new Date(startsAt + 'T00:00:00') : null;
    const end = endsAt ? new Date(endsAt + 'T23:59:59') : null;
    if (end && !isNaN(end) && now > end) return 'ended';
    if (start && !isNaN(start) && now < start) return 'scheduled';
    return 'active';
  }

  /** Days left in an offer window, or null when it has none. */
  function offerDaysLeft(offer) {
    if (!offer || !offer.endsAt) return null;
    const end = new Date(offer.endsAt + 'T23:59:59');
    if (isNaN(end)) return null;
    return Math.ceil((end - new Date()) / 86400000);
  }

  function normalizeCategory(raw) {
    const c = raw && typeof raw === 'object' ? raw : {};
    const slug = trim(c.slug) || trim(c.id) || slugify(c.label);
    return {
      id: trim(c.id) || slug,
      slug: slug,
      label: trim(c.label) || titleCase(slug),
      icon: trim(c.icon) || '📦',
      blurb: trim(c.blurb),
      position: Number.isFinite(Number(c.position)) ? Number(c.position) : 0,
      subcategories: asArray(c.subcategories).map(function (sub, idx) {
        const s = typeof sub === 'string' ? { label: sub } : sub;
        const label = trim(s.label) || trim(s.id);
        const id = trim(s.id) || trim(s.slug) || slugify(label);
        return {
          id: id,
          slug: trim(s.slug) || id,
          label: label,
          category: slug,
          position: Number.isFinite(Number(s.position)) ? Number(s.position) : idx
        };
      })
    };
  }

  /** Find a subcategory by canonical id, slug or label, inside a category. */
  function findSubcategory(taxonomy, categorySlug, value) {
    const v = trim(value).toLowerCase();
    if (!v) return null;
    const pool = asArray(taxonomy).filter((c) => !categorySlug || c.slug === categorySlug || c.id === categorySlug);
    for (const c of pool) {
      const hit = c.subcategories.find((s) => s.id.toLowerCase() === v || s.slug.toLowerCase() === v || s.label.toLowerCase() === v);
      if (hit) return hit;
    }
    return null;
  }

  function normalizeGuide(raw, ctx) {
    const context = ctx || {};
    const issues = [];
    if (!raw || typeof raw !== 'object') {
      return { guide: null, issues: [issue('error', 'guide-not-an-object', 'Guide is not an object.', null)] };
    }
    const id = trim(raw.id);
    const title = trim(raw.title);
    if (!id) issues.push(issue('error', 'guide-id-missing', 'A guide must have an id.', null));
    if (!title) issues.push(issue('error', 'guide-title-missing', 'A guide must have a title.', id || null));

    const status = GUIDE_STATUS.indexOf(trim(raw.status)) !== -1 ? trim(raw.status) : 'published';
    const related = asArray(raw.relatedListingIds).map(trim).filter(Boolean);
    related.forEach(function (listingId) {
      if (context.listingIds && context.listingIds.indexOf(listingId) === -1) {
        issues.push(issue('warning', 'guide-listing-unknown', 'Guide references unknown listing "' + listingId + '".', id || null));
      }
    });

    /* `sections` is the canonical outline; legacy `covers` strings are accepted
       and merged into the same list, then renumbered so ids stay stable. */
    const sections = asArray(raw.sections)
      .map(function (s) {
        const item = typeof s === 'string' ? { title: s } : s;
        return {
          title: trim(item.title) || trim(item.label),
          body: trim(item.body) || null,
          position: item.position
        };
      })
      .concat(asArray(raw.covers).map(function (cover) {
        return { title: trim(cover), body: null, position: null };
      }))
      .filter((s) => s.title)
      .map(function (s, idx) {
        return { id: 'section-' + (idx + 1), title: s.title, body: s.body, position: idx };
      });

    return {
      guide: {
        id: id,
        title: title,
        slug: trim(raw.slug) || slugify(title) || id,
        category: trim(raw.category) || 'guides',
        tags: asArray(raw.tags).map((t) => trim(t).toLowerCase()).filter(Boolean),
        question: trim(raw.question),
        summary: trim(raw.summary),
        sections: sections,
        relatedListingIds: related,
        icon: trim(raw.icon) || '📘',
        level: trim(raw.level) || 'All levels',
        readTime: trim(raw.readTime) || 'Outline',
        cta: raw.cta && trim(raw.cta.href) ? { label: trim(raw.cta.label) || 'Explore the catalogue', href: trim(raw.cta.href) } : null,
        status: status,
        outline: true,
        createdAt: trim(raw.createdAt) || null,
        updatedAt: trim(raw.updatedAt) || null
      },
      issues: issues
    };
  }

  /* ======================================================================
     4. Validators
     ====================================================================== */

  const issue = (severity, code, message, ref) => ({ severity: severity, code: code, message: message, ref: ref || null });

  const hasErrors = (issues) => asArray(issues).some((i) => i.severity === 'error');

  /**
   * A listing is valid when the fields a page cannot work without are present:
   * id, name, an explicit type, a category, and — when a price exists — a
   * usable amount plus a currency.
   */
  function validateListing(listing) {
    const issues = [];
    if (!listing) return { valid: false, issues: [issue('error', 'listing-missing', 'No listing supplied.', null)] };
    if (isBlank(listing.id)) issues.push(issue('error', 'listing-id-missing', 'id is required.', null));
    if (isBlank(listing.name)) issues.push(issue('error', 'listing-name-missing', 'name is required.', listing.id || null));
    if (LISTING_TYPES.indexOf(listing.type) === -1) issues.push(issue('error', 'listing-type-invalid', 'type must be "product" or "service".', listing.id || null));
    if (isBlank(listing.category)) issues.push(issue('error', 'listing-category-missing', 'category is required.', listing.id || null));
    if (LISTING_STATUS.indexOf(listing.status) === -1) issues.push(issue('error', 'listing-status-invalid', 'status must be draft, published or archived.', listing.id || null));
    if (listing.price) {
      const p = listing.price;
      const hasAmount = p.amount != null || (p.min != null && p.max != null) || p.min != null;
      if (!hasAmount) issues.push(issue('error', 'listing-price-invalid', 'price needs an amount or a min/max range.', listing.id || null));
      if (isBlank(listing.currency)) issues.push(issue('error', 'listing-currency-missing', 'a price needs a currency code.', listing.id || null));
      if (PRICE_TYPES.indexOf(p.priceType) === -1) issues.push(issue('warning', 'listing-price-type-unknown', 'Unknown priceType "' + p.priceType + '".', listing.id || null));
      if (p.min != null && p.max != null && p.min > p.max) issues.push(issue('warning', 'listing-price-range-inverted', 'price.min is greater than price.max.', listing.id || null));
    }
    if (!listing.sellerId) issues.push(issue('warning', 'listing-seller-missing', 'No seller/provider reference.', listing.id || null));
    if (!listing.images || !listing.images.length) issues.push(issue('warning', 'listing-images-missing', 'No images — the UI shows an icon tile.', listing.id || null));
    if (!listing.location || (isBlank(listing.location.city) && isBlank(listing.location.county) && listing.location.format !== 'online' && listing.location.format !== 'nationwide')) {
      issues.push(issue('warning', 'listing-location-thin', 'Location has no city, county, online or nationwide marker.', listing.id || null));
    }
    return { valid: !hasErrors(issues), issues: issues };
  }

  function validateOffer(offer, listingIds) {
    const issues = [];
    if (!offer) return { valid: false, issues: [issue('error', 'offer-missing', 'No offer supplied.', null)] };
    if (isBlank(offer.id)) issues.push(issue('error', 'offer-id-missing', 'id is required.', null));
    if (isBlank(offer.listingId)) issues.push(issue('error', 'offer-listing-missing', 'listingId is required.', offer.id || null));
    if (listingIds && offer.listingId && listingIds.indexOf(offer.listingId) === -1) {
      issues.push(issue('error', 'offer-listing-unknown', 'listingId does not exist ("' + offer.listingId + '").', offer.id || null));
    }
    if (OFFER_KINDS.indexOf(offer.kind) === -1) issues.push(issue('warning', 'offer-kind-unknown', 'Unknown offer kind.', offer.id || null));
    if (offer.offerPrice != null && offer.originalPrice != null && offer.offerPrice > offer.originalPrice) {
      issues.push(issue('warning', 'offer-price-inverted', 'Offer price is higher than the original price.', offer.id || null));
    }
    if (!offer.currency) issues.push(issue('error', 'offer-currency-missing', 'currency is required.', offer.id || null));
    if (!offer.endsAt) issues.push(issue('warning', 'offer-end-missing', 'No end date, so no urgency can be shown.', offer.id || null));
    return { valid: !hasErrors(issues), issues: issues };
  }

  function validateGuide(guide) {
    const issues = [];
    if (!guide) return { valid: false, issues: [issue('error', 'guide-missing', 'No guide supplied.', null)] };
    if (isBlank(guide.id)) issues.push(issue('error', 'guide-id-missing', 'id is required.', null));
    if (isBlank(guide.title)) issues.push(issue('error', 'guide-title-missing', 'title is required.', guide.id || null));
    if (GUIDE_STATUS.indexOf(guide.status) === -1) issues.push(issue('error', 'guide-status-invalid', 'status must be draft, published or archived.', guide.id || null));
    if (!guide.sections.length) issues.push(issue('warning', 'guide-sections-empty', 'Guide has no outline sections yet.', guide.id || null));
    return { valid: !hasErrors(issues), issues: issues };
  }

  /**
   * A seller/provider *account* (as opposed to a catalogue seller reference).
   * Shaped exactly like the database row, so nothing is renamed in transit.
   */
  function normalizeSellerAccount(raw) {
    const a = raw && typeof raw === 'object' ? raw : {};
    const accountType = isSellerAccountType(a.account_type) ? trim(a.account_type) : (isSellerAccountType(a.accountType) ? trim(a.accountType) : '');
    const status = isSellerAccountStatus(a.status) ? trim(a.status) : 'pending';
    const pick = (snake, camel) => (a[snake] !== undefined ? a[snake] : a[camel]);
    return {
      id: trim(a.id),
      ownerId: trim(pick('owner_id', 'ownerId')),
      accountType: accountType,
      accountTypeLabel: accountType ? sellerAccountTypeLabel(accountType) : 'Account',
      businessName: trim(pick('business_name', 'businessName')),
      description: trim(a.description),
      contactEmail: trim(pick('contact_email', 'contactEmail')),
      contactPhone: trim(pick('contact_phone', 'contactPhone')),
      website: trim(pick('website', 'website')),
      location: {
        country: trim(pick('country', 'country')) || DEFAULT_COUNTRY,
        county: trim(pick('county', 'county')),
        city: trim(pick('city', 'city')),
        area: trim(pick('area', 'area'))
      },
      status: status,
      statusCopy: sellerAccountStatusCopy(status),
      reviewNote: trim(pick('review_note', 'reviewNote')),
      reviewedAt: trim(pick('reviewed_at', 'reviewedAt')),
      /* The public catalogue record this account speaks for, once approved. */
      sellerId: trim(pick('seller_id', 'sellerId')),
      createdAt: trim(pick('created_at', 'createdAt')),
      updatedAt: trim(pick('updated_at', 'updatedAt'))
    };
  }

  /**
   * Validates an onboarding submission. The database checks the same things
   * (see 0003) because this runs in a browser and cannot be the authority.
   */
  function validateSellerAccount(account) {
    const issues = [];
    const a = account || {};
    if (!isSellerAccountType(a.accountType)) {
      issues.push(issue('error', 'account-type-invalid', 'Choose whether you sell products or provide services.', null));
    }
    if (isBlank(a.businessName)) {
      issues.push(issue('error', 'account-name-missing', 'Enter the name of your business or practice.', null));
    } else if (String(a.businessName).length > 120) {
      issues.push(issue('error', 'account-name-too-long', 'Keep the name to 120 characters or fewer.', null));
    }
    if (String(a.description || '').length > 2000) {
      issues.push(issue('error', 'account-description-too-long', 'Keep the description to 2000 characters or fewer.', null));
    }
    const email = trim(a.contactEmail);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      issues.push(issue('error', 'account-email-invalid', 'Enter a valid contact email address, or leave it blank.', null));
    }
    if (String(a.contactPhone || '').length > 40) {
      issues.push(issue('error', 'account-phone-too-long', 'Keep the phone number to 40 characters or fewer.', null));
    }
    const website = trim(a.website);
    if (website && !/^https?:\/\/[^\s]+$/i.test(website)) {
      issues.push(issue('error', 'account-website-invalid', 'A website address must start with http:// or https://, or be left blank.', null));
    }
    const location = a.location || {};
    ['country', 'county', 'city', 'area'].forEach(function (key) {
      if (String(location[key] || '').length > 80) {
        issues.push(issue('error', 'account-' + key + '-too-long', 'Keep ' + key + ' to 80 characters or fewer.', null));
      }
    });
    return { valid: !hasErrors(issues), issues: issues };
  }

  function validateSeller(seller) {
    const issues = [];
    if (!seller) return { valid: false, issues: [issue('error', 'seller-missing', 'No seller supplied.', null)] };
    if (isBlank(seller.id)) issues.push(issue('error', 'seller-id-missing', 'id is required.', null));
    if (isBlank(seller.name)) issues.push(issue('error', 'seller-name-missing', 'name is required.', seller.id || null));
    if (SELLER_TYPES.indexOf(seller.type) === -1) issues.push(issue('warning', 'seller-type-unknown', 'Unknown seller type "' + seller.type + '".', seller.id || null));
    if (SELLER_STATUS.indexOf(seller.status) === -1) issues.push(issue('warning', 'seller-status-unknown', 'Unknown seller status.', seller.id || null));
    return { valid: !hasErrors(issues), issues: issues };
  }

  /** Taxonomy must be consistent: unique categories, unique subcategory ids. */
  function validateTaxonomy(categories) {
    const issues = [];
    const seenCategories = new Set();
    const seenSubs = new Map();
    asArray(categories).forEach(function (c) {
      if (seenCategories.has(c.slug)) issues.push(issue('error', 'taxonomy-category-duplicate', 'Duplicate category "' + c.slug + '".', c.slug));
      seenCategories.add(c.slug);
      c.subcategories.forEach(function (s) {
        const key = s.id.toLowerCase();
        if (seenSubs.has(key)) {
          issues.push(issue('warning', 'taxonomy-subcategory-duplicate', 'Subcategory id "' + s.id + '" is used by ' + seenSubs.get(key) + ' and ' + c.slug + '.', s.id));
        } else {
          seenSubs.set(key, c.slug);
        }
      });
      if (!c.subcategories.length) issues.push(issue('warning', 'taxonomy-category-empty', 'Category "' + c.slug + '" has no subcategories.', c.slug));
    });
    return { valid: !hasErrors(issues), issues: issues };
  }

  /** Config keys such as "technology:Laptops" must point at real taxonomy. */
  function validateConfigReferences(categories, configKeys) {
    const issues = [];
    const slugs = new Set(asArray(categories).map((c) => c.slug));
    asArray(configKeys).forEach(function (key) {
      const [category, sub] = String(key).split(':');
      if (!slugs.has(category)) {
        issues.push(issue('warning', 'config-unknown-category', 'Config key "' + key + '" references an unknown category.', key));
        return;
      }
      if (sub && !findSubcategory(categories, category, sub)) {
        issues.push(issue('warning', 'config-unknown-subcategory', 'Config key "' + key + '" references an unknown subcategory.', key));
      }
    });
    return { valid: !hasErrors(issues), issues: issues };
  }

  /* ======================================================================
     5. Public API
     ====================================================================== */
  return {
    /* vocabularies */
    LISTING_TYPES, LISTING_STATUS, AVAILABILITY, PRICE_TYPES, OFFER_KINDS, OFFER_STATUS,
    SELLER_TYPES, SELLER_STATUS, VERIFICATION_STATUS, LOCATION_FORMATS, GUIDE_STATUS,
    SELLER_ACCOUNT_TYPES, SELLER_ACCOUNT_STATUS, SELLER_ACCOUNT_COPY, SELLER_ACCOUNT_STATUS_COPY,
    ADMIN_STATUS_COPY, ADMIN_ACCOUNT_TYPE_COPY, REVIEW_ACTIONS, REVIEW_NOTE_MAX, ADMIN_ACTION_TARGETS,
    DEAL_SOURCE_TYPES, DEAL_SOURCE_STATUS, DEAL_SOURCE_TYPE_COPY, DEAL_SOURCE_STATUS_COPY,
    DEAL_PIPELINE_STAGES, DEAL_PIPELINE_TERMINAL, dealSourceTypeCopy, dealSourceStatusCopy,
    isSafeHttpUrl,
    DEFAULT_CURRENCY, DEFAULT_COUNTRY,

    /* value helpers */
    str, trim, asArray, num, slugify, titleCase, money, priceUnitSuffix, priceTypeFromUnit,
    inferPriceType, priceText, priceValue, locationLabel, serviceAreaText,
    typeLabel, categoryLabel, availabilityInfo, listingStatusLabel, offerKindLabel, sellerLabel,
    isSellerAccountType, isSellerAccountStatus, sellerAccountCopy, sellerAccountStatusCopy,
    sellerAccountTypeLabel, adminStatusCopy, adminAccountTypeCopy, adminReviewActionsFor, normalizeAdminCounts,
    formatDate, offerDaysLeft, primaryImage,

    /* normalisers */
    normalizeListing, normalizeOffer, normalizeGuide, normalizeSeller, normalizeSellerAccount, normalizeCategory,
    normalizePrice, normalizeLocation, normalizeImages, normalizeSpecifications,
    findSubcategory, statusForOffer,

    /* validators */
    issue, hasErrors, validateListing, validateOffer, validateGuide, validateSeller, validateSellerAccount,
    validateTaxonomy, validateConfigReferences
  };
})();
