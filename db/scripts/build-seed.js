#!/usr/bin/env node
/* ============================================================================
   PickVanta — seed generator (db/scripts/build-seed.js)
   ----------------------------------------------------------------------------
   Turns the canonical demo catalogue (js/data.js, the Step 7 model) into an
   idempotent SQL seed for the Supabase/PostgreSQL schema in
   db/migrations/0001_catalogue.sql.

   Usage:
     node db/scripts/build-seed.js            # writes db/seed/0001_catalogue.sql
     node db/scripts/build-seed.js --check    # verifies the file is up to date

   Properties
     • deterministic — stable ordering and formatting, so a re-run of the
       generator produces a byte-identical file (`--check` proves it);
     • idempotent — every statement is an upsert keyed on the stable ids, so the
       seed can be applied to a fresh project or re-applied to an existing one;
     • no dependencies — plain Node, no build system, nothing to install.

   Nothing secret lives here: the seed only contains the public demo catalogue.
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SOURCE = path.join(ROOT, 'js', 'data.js');
const TARGET = path.join(ROOT, 'db', 'seed', '0001_catalogue.sql');

/* ------------------------------------------------------------ sql helpers -- */
const q = (value) => (value === null || value === undefined ? 'NULL' : "'" + String(value).replace(/'/g, "''") + "'");
const qOrNull = (value) => {
  if (value === null || value === undefined) return 'NULL';
  const text = String(value);
  return text.length ? q(text) : 'NULL';
};
const num = (value) => (value === null || value === undefined ? 'NULL' : String(Number(value)));
const bool = (value) => (value ? 'TRUE' : 'FALSE');
const textArray = (list) => {
  const items = (Array.isArray(list) ? list : []).filter((v) => v !== null && v !== undefined);
  return items.length ? 'ARRAY[' + items.map((v) => q(v)).join(', ') + ']::text[]' : "'{}'::text[]";
};
const jsonb = (value) => (value === null || value === undefined ? 'NULL' : q(JSON.stringify(value)) + '::jsonb');
const jsonbArray = (value) => q(JSON.stringify(Array.isArray(value) ? value : [])) + '::jsonb';
const tsOrNull = (value) => (value ? q(value) + '::timestamptz' : 'NULL');
const dateOrNull = (value) => (value ? q(value) + '::date' : 'NULL');

/** Multi-row upsert: insert … on conflict (key) do update set … */
function upsert(table, columns, rows, conflictKey) {
  if (!rows.length) return '-- ' + table + ': no rows\n';
  const assignments = columns
    .filter((c) => c !== conflictKey)
    .map((c) => `${c} = excluded.${c}`)
    .join(',\n    ');
  const insert = rows
    .map((row) => '  (' + row.join(', ') + ')')
    .join(',\n');
  return (
    `insert into public.${table} (${columns.join(', ')}) values\n${insert}\n` +
    `on conflict (${conflictKey}) do update set\n    ${assignments};\n`
  );
}

const header = (title) =>
  '\n-- ' + '-'.repeat(74) + '\n-- ' + title + '\n-- ' + '-'.repeat(74) + '\n';

/* ------------------------------------------------------------------ build -- */
function loadCatalogue() {
  global.window = {};
  require(SOURCE);
  const data = global.window.PICKVANTA_DATA;
  if (!data) throw new Error('js/data.js did not define window.PICKVANTA_DATA');
  return data;
}

function build() {
  const data = loadCatalogue();
  const stamp = data.version || 'unknown';
  const out = [];

  out.push(`-- ============================================================================
-- PickVanta — catalogue seed (generated; do not edit by hand)
-- ----------------------------------------------------------------------------
-- Generated from js/data.js (${stamp}) by db/scripts/build-seed.js.
-- Apply after db/migrations/0001_catalogue.sql:
--   psql "$DATABASE_URL" -f db/seed/0001_catalogue.sql
-- Every statement is an upsert on the stable text ids, so this file is safe to
-- re-run: it inserts the catalogue on a fresh project and refreshes it on an
-- existing one without creating duplicates.
-- ============================================================================

set search_path = public;

begin;
`);

  /* ------------------------------------------------------- 1. categories -- */
  out.push(header('1. categories (' + data.taxonomy.length + ')'));
  out.push(upsert('categories', ['id', 'slug', 'name', 'description', 'icon', 'position', 'status'], data.taxonomy.map((c) => [
    q(c.id || c.slug),
    q(c.slug),
    q(c.label || c.name || c.slug),
    q(c.blurb || c.description || ''),
    q(c.icon || ''),
    num(c.position || 0),
    q('published')
  ]), 'id'));

  /* ---------------------------------------------------- 2. subcategories -- */
  const subRows = [];
  data.taxonomy.forEach((c) => {
    (c.subcategories || []).forEach((s, idx) => {
      subRows.push([
        q(s.id || s.slug),
        q(c.id || c.slug),
        q(s.slug || s.id),
        q(s.label || s.name || s.slug),
        num(Number.isFinite(Number(s.position)) ? Number(s.position) : idx),
        q('published')
      ]);
    });
  });
  out.push(header('2. subcategories (' + subRows.length + ')'));
  out.push(upsert('subcategories', ['id', 'category_id', 'slug', 'name', 'position', 'status'], subRows, 'id'));

  /* ---------------------------------------------------------- 3. sellers -- */
  out.push(header('3. sellers (' + data.sellers.length + ')'));
  out.push(upsert('sellers', [
    'id', 'slug', 'name', 'type', 'description', 'country', 'county', 'city', 'area',
    'website', 'contact_email', 'contact_phone', 'verification_status', 'status'
  ], data.sellers.map((s) => {
    const loc = s.location || {};
    const contact = s.contact || {};
    return [
      q(s.id), q(s.slug || s.id), q(s.name), q(s.type || 'seller'), q(s.description || ''),
      q(loc.country || 'Kenya'), q(loc.county || ''), q(loc.city || ''), q(loc.area || ''),
      qOrNull(contact.website), qOrNull(contact.email), qOrNull(contact.phone),
      q(s.verificationStatus === 'demo-verified' ? 'demo-verified' : 'unverified'),
      q(s.status || 'published')
    ];
  }), 'id'));

  /* --------------------------------------------------------- 4. listings -- */
  // category_id / subcategory_id are resolved from the taxonomy so the seed
  // cannot point at a row that does not exist.
  const categoryBySlug = new Map(data.taxonomy.map((c) => [c.slug, c.id || c.slug]));
  const subByPair = new Map();
  data.taxonomy.forEach((c) => (c.subcategories || []).forEach((s) => {
    subByPair.set((c.id || c.slug) + ':' + s.id, s.id || s.slug);
    subByPair.set((c.slug) + ':' + (s.slug || s.id), s.id || s.slug);
  }));

  const listings = data.listings.map((l) => {
    const categoryId = l.category || null;
    const subcategoryId = l.subcategory
      ? subByPair.get(categoryId + ':' + l.subcategory)
        || subByPair.get(categoryId + ':' + String(l.subcategory).toLowerCase())
        || null
      : null;
    if (!categoryId || !categoryBySlug.has(categoryId)) {
      throw new Error('listing ' + l.id + ' references unknown category ' + categoryId);
    }
    if (l.subcategory && !subcategoryId) {
      throw new Error('listing ' + l.id + ' references unknown subcategory ' + l.subcategory);
    }
    const p = l.price || {};
    const loc = l.location || {};
    const specs = (l.specifications || []).map((s, idx) => ({
      label: s.label, value: s.value, group: s.group || '', position: Number.isFinite(Number(s.position)) ? Number(s.position) : idx
    }));
    const images = (l.images || []).map((img, idx) => ({
      id: img.id || 'img-' + (idx + 1),
      position: Number.isFinite(Number(img.position)) ? Number(img.position) : idx,
      src: img.src || null,
      alt: img.alt || l.name,
      icon: img.icon || '',
      gradient: img.gradient || ''
    }));
    return [
      q(l.id),
      qOrNull(l.sellerId),
      q(categoryId),
      qOrNull(subcategoryId),
      q(l.type),
      q(l.name),
      q(l.slug || l.id),
      q(l.shortDescription || ''),
      q(l.description || ''),
      q(l.brand || ''),
      num(p.amount),
      num(p.min),
      num(p.max),
      q(l.currency || 'KES'),
      q(p.priceType || 'fixed'),
      num(l.referencePrice),
      q(loc.country || 'Kenya'),
      q(loc.county || ''),
      q(loc.city || ''),
      q(loc.area || ''),
      q(loc.format || 'local'),
      textArray(loc.serviceArea),
      q(l.availability || 'available'),
      textArray(l.highlights),
      textArray(l.tags),
      jsonbArray(specs),
      jsonbArray(images),
      q(l.status || 'published'),
      tsOrNull(l.createdAt),
      tsOrNull(l.updatedAt || l.createdAt)
    ];
  });

  const listingColumns = [
    'id', 'seller_id', 'category_id', 'subcategory_id', 'type', 'name', 'slug',
    'short_description', 'description', 'brand',
    'price_amount', 'price_min', 'price_max', 'currency', 'price_type', 'reference_price',
    'location_country', 'location_county', 'location_city', 'location_area', 'location_format', 'service_area',
    'availability', 'highlights', 'tags', 'specifications', 'images',
    'status', 'created_at', 'updated_at'
  ];
  out.push(header('4. listings (' + listings.length + ')'));
  out.push(upsert('listings', listingColumns, listings, 'id'));

  /* ------------------------------------------------------------ 5. deals -- */
  const listingIds = new Set(data.listings.map((l) => l.id));
  const listingSellers = new Map(data.listings.map((l) => [l.id, l.sellerId]));
  const deals = data.offers.filter((o) => {
    if (!listingIds.has(o.listingId)) throw new Error('deal ' + o.id + ' references unknown listing ' + o.listingId);
    return true;
  }).map((o) => [
    q(o.id),
    q(o.listingId),
    qOrNull(o.sellerId || listingSellers.get(o.listingId) || null),
    q(o.title || ''),
    q(o.description || ''),
    q(o.kind || 'percentage'),
    num(o.originalPrice),
    num(o.offerPrice),
    num(o.discountPercent),
    q(o.currency || 'KES'),
    dateOrNull(o.startsAt),
    dateOrNull(o.endsAt),
    q(o.availability || 'available'),
    q(o.status || 'active'),
    textArray(o.conditions)
  ]);
  out.push(header('5. deals (' + deals.length + ')'));
  out.push(upsert('deals', [
    'id', 'listing_id', 'seller_id', 'title', 'description', 'deal_type',
    'original_price', 'deal_price', 'discount_percent', 'currency',
    'starts_at', 'ends_at', 'availability', 'status', 'conditions'
  ], deals, 'id'));

  /* ----------------------------------------------------------- 6. guides -- */
  const categoryIdSet = new Set(data.taxonomy.map((c) => c.id || c.slug));
  const guides = data.guides.map((g) => {
    const categoryId = g.category && categoryIdSet.has(g.category) ? g.category : null;
    const content = (g.sections || []).map((s, idx) => ({
      id: s.id || 'section-' + (idx + 1),
      title: s.title,
      body: s.body || null,
      position: Number.isFinite(Number(s.position)) ? Number(s.position) : idx
    }));
    return [
      q(g.id),
      q(g.slug || g.id),
      q(g.title),
      qOrNull(categoryId),
      q(g.question || ''),
      q(g.summary || ''),
      jsonbArray(content),
      textArray(g.tags),
      q(g.icon || ''),
      q(g.level || ''),
      q(g.readTime || ''),
      g.cta ? jsonb(g.cta) : 'NULL',
      q(g.status || 'published')
      /* Guide outlines carry no authored dates, so created_at / updated_at are
         deliberately not inserted here: the table's own `default now()` records
         when the row was seeded, and re-running the seed leaves created_at
         alone (the trigger keeps updated_at honest). */
    ];
  });
  out.push(header('6. guides (' + guides.length + ')'));
  out.push('-- Guides are written before guide_listings so every relationship below\n-- resolves against rows that already exist.\n');
  out.push(upsert('guides', [
    'id', 'slug', 'title', 'category_id', 'question', 'summary', 'content',
    'tags', 'icon', 'level', 'read_time', 'cta', 'status'
  ], guides, 'id'));

  /* --------------------------------------------------- 7b. guide_listings -- */
  const pairs = [];
  data.guides.forEach((g) => (g.relatedListingIds || []).forEach((listingId) => {
    if (!listingIds.has(listingId)) throw new Error('guide ' + g.id + ' references unknown listing ' + listingId);
    pairs.push([q(g.id), q(listingId)]);
  }));
  const positions = new Map();
  pairs.forEach((pair) => positions.set(pair.join('|'), positions.size));
  out.push(header('7. guide_listings (' + pairs.length + ' links)'));
  out.push(upsert('guide_listings', ['guide_id', 'listing_id', 'position'], pairs.map((pair) => [
    pair[0], pair[1], num(positions.get(pair.join('|')))
  ]), 'guide_id, listing_id'));
  // The upsert helper builds `on conflict (guide_id, listing_id)` and updates the
  // only remaining column, which is what makes a re-run idempotent.
  out.push('');

  /* ----------------------------------------------- 9. catalogue_settings -- */
  const settings = [
    ['version', data.version || 'unknown'],
    ['demoNotice', data.demoNotice || ''],
    ['priceBands', data.priceBands || []],
    ['sortOptions', data.sortOptions || []],
    ['compareFocus', data.compareFocus || []],
    ['compareGroups', data.compareGroups || {}],
    ['considerations', data.considerations || {}],
    ['goodToKnow', data.goodToKnow || {}],
    ['needs', data.needs || []],
    ['popularTags', data.popularTags || []],
    ['defaultCompareIds', data.defaultCompareIds || []],
    ['homeFeaturedIds', data.homeFeaturedIds || []],
    ['homeDealIds', data.homeDealIds || []],
    ['homeGuideIds', data.homeGuideIds || []],
    ['locations', data.locations || []]
  ];
  const settingRows = settings.map(([key, value]) => [q(key), jsonb(value)]);
  out.push(header('8. catalogue_settings (' + settingRows.length + ' keys)'));
  out.push(upsert('catalogue_settings', ['key', 'value'], settingRows, 'key'));

  out.push(`commit;

-- Sanity check — the numbers should match the demo catalogue.
--   select 'categories', count(*) from public.categories
--   union all select 'subcategories', count(*) from public.subcategories
--   union all select 'sellers', count(*) from public.sellers
--   union all select 'listings', count(*) from public.listings
--   union all select 'deals', count(*) from public.deals
--   union all select 'guides', count(*) from public.guides
--   union all select 'guide_listings', count(*) from public.guide_listings;
`);

  return out.join('\n');
}

/* ------------------------------------------------------------------- main -- */
function main() {
  const sql = build();
  const check = process.argv.includes('--check');

  if (check) {
    if (!fs.existsSync(TARGET)) {
      console.error('seed file missing: ' + path.relative(ROOT, TARGET));
      process.exit(1);
    }
    const existing = fs.readFileSync(TARGET, 'utf8');
    if (existing !== sql) {
      console.error('seed file is out of date — run: node db/scripts/build-seed.js');
      process.exit(1);
    }
    console.log('seed file is up to date (' + sql.split('\n').length + ' lines)');
    return;
  }

  fs.mkdirSync(path.dirname(TARGET), { recursive: true });
  fs.writeFileSync(TARGET, sql);
  const lines = sql.split('\n').length;
  console.log('wrote ' + path.relative(ROOT, TARGET) + ' (' + lines + ' lines)');
  console.log('  categories ' + (sql.match(/insert into public\.categories /g) || []).length +
    ' · seed includes upserts for every table');
}

if (require.main === module) main();
module.exports = { build };
