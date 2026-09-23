/* ==========================================================================
   PickVanta — demo data layer
   --------------------------------------------------------------------------
   Step 2: static demo content only. There is no database, no API and no
   external service. Every record below is invented and must never be
   presented to a user as a real product, price, seller or offer.

   The shape of each record is intentionally close to a future database row so
   this file can later be replaced by a real data source without touching the
   UI logic:

     id, name, type, category, subcategory, brand, shortDescription,
     description, price, referencePrice, location, seller, image, attributes,
     deal, status, badge, tags, listedAt, rating, highlights

   type       : 'product' | 'service'   (products/services are distinct)
   category   : slug from categories[]
   price      : { amount } | { min, max } | { amount, unit: 'month' }
   attributes : [{ group, label, value }]  → flexible, not category specific
   deal       : null | { dealPrice, referencePrice, discountPercent,
                         validFrom, validTo, conditions: [] }
   ========================================================================== */
(() => {
  'use strict';

  /* ---------------------------------------------------------------- types */
  const types = [
    { code: 'product', label: 'Product', blurb: 'Physical or digital goods' },
    { code: 'service', label: 'Service', blurb: 'Things you can arrange or book' }
  ];

  /* ----------------------------------------------------------- categories */
  /* The same eight broad categories introduced on the homepage. */
  const categories = [
    { slug: 'technology', label: 'Technology', icon: '💻', blurb: 'Phones, laptops, audio, wearables' },
    { slug: 'home', label: 'Home', icon: '🏠', blurb: 'Appliances, furniture, decor' },
    { slug: 'automotive', label: 'Automotive', icon: '🚗', blurb: 'Cars, EVs, accessories, services' },
    { slug: 'travel', label: 'Travel', icon: '✈️', blurb: 'Stays, flights, experiences' },
    { slug: 'business', label: 'Business', icon: '💼', blurb: 'Software, services, tools' },
    { slug: 'education', label: 'Education', icon: '🎓', blurb: 'Courses, programs, resources' },
    { slug: 'fashion', label: 'Fashion', icon: '👕', blurb: 'Apparel, footwear, accessories' },
    { slug: 'services', label: 'Services', icon: '🛠️', blurb: 'Internet, repairs, local pros' }
  ];

  /* ------------------------------------------------------------- statuses */
  const statuses = [
    { code: 'available', label: 'Available', tone: 'ok', help: 'Listed as available in this demo' },
    { code: 'limited', label: 'Limited', tone: 'warn', help: 'Listed as limited in this demo' },
    { code: 'by-appointment', label: 'By appointment', tone: 'info', help: 'Arranged with the provider' },
    { code: 'on-request', label: 'On request', tone: 'info', help: 'Details shared by the seller' }
  ];

  /* ------------------------------------------------------- price band presets */
  const priceBands = [
    { code: 'any', label: 'Any price' },
    { code: '0-100', label: 'Under $100', max: 100 },
    { code: '100-299', label: '$100 – $299', min: 100, max: 299 },
    { code: '300-699', label: '$300 – $699', min: 300, max: 699 },
    { code: '700+', label: '$700 and above', min: 700 }
  ];

  /* ------------------------------------------------------------ sort options */
  const sortOptions = [
    { code: 'relevance', label: 'Relevance' },
    { code: 'newest', label: 'Newest' },
    { code: 'price-asc', label: 'Price: Low to High' },
    { code: 'price-desc', label: 'Price: High to Low' }
  ];

  /* ----------------------------------------------------------------- items */
  const items = [
    /* ---------------------------------------------------- Technology (5) */
    {
      id: 'headphones-quietmax-700',
      name: 'QuietMax 700 — Wireless Over-Ear',
      type: 'product',
      category: 'technology',
      subcategory: 'Headphones',
      brand: 'QuietMax',
      shortDescription: 'Adaptive noise cancelling over-ear headphones with 40-hour battery life.',
      description:
        'A demo over-ear headphone entry used to show how PickVanta presents a product. The QuietMax 700 combines adaptive noise cancelling, a fold-flat frame and USB-C fast charging. Specs, pricing and availability shown here are invented for interface demonstration.',
      price: { amount: 249 },
      referencePrice: 299,
      location: { city: 'Nationwide', country: 'Online', format: 'online' },
      seller: { name: 'AudioNest', type: 'Retailer', rating: 4.6, verified: true },
      image: { icon: '🎧', gradient: 'linear-gradient(135deg,#E0E7FF,#C7D2FE)', alt: 'Wireless over-ear headphones' },
      badge: { label: 'Editor demo pick', tone: 'accent' },
      status: 'available',
      listedAt: '2026-09-05',
      rating: { value: 4.6, count: 128 },
      highlights: ['Adaptive noise cancelling', '40-hour battery', 'USB-C quick charge'],
      attributes: [
        { group: 'Audio', label: 'Noise cancellation', value: 'Adaptive ANC' },
        { group: 'Audio', label: 'Drivers', value: '40 mm dynamic' },
        { group: 'Power', label: 'Battery', value: '40 hours' },
        { group: 'Power', label: 'Charging', value: 'USB-C, 10 min quick charge' },
        { group: 'Design', label: 'Weight', value: '253 g' },
        { group: 'Connectivity', label: 'Connectivity', value: 'Bluetooth 5.3, multipoint' },
        { group: 'Support', label: 'Warranty', value: '2 years' }
      ],
      deal: {
        dealPrice: 249,
        referencePrice: 299,
        discountPercent: 17,
        validFrom: '2026-09-15',
        validTo: '2026-12-31',
        conditions: ['Demo condition: online sellers only', 'Demo condition: cannot be combined with other demo offers']
      }
    },
    {
      id: 'headphones-basswave-700',
      name: 'BassWave 700 — Bass Boost Over-Ear',
      type: 'product',
      category: 'technology',
      subcategory: 'Headphones',
      brand: 'BassWave',
      shortDescription: 'Bass-forward over-ear headphones with a simpler feature set and lower price.',
      description:
        'A second demo headphone entry, deliberately weaker than the others so a comparison has visible differences. Bass-heavy tuning, plush padding and 30-hour battery. All content is demonstration data.',
      price: { amount: 179 },
      referencePrice: null,
      location: { city: 'Nationwide', country: 'Online', format: 'online' },
      seller: { name: 'TechHub', type: 'Retailer', rating: 4.4, verified: true },
      image: { icon: '🎵', gradient: 'linear-gradient(135deg,#FEF3C7,#FDE68A)', alt: 'Bass boost over-ear headphones' },
      badge: { label: 'Budget demo pick', tone: 'neutral' },
      status: 'available',
      listedAt: '2026-08-22',
      rating: { value: 4.1, count: 64 },
      highlights: ['Strong bass tuning', '30-hour battery', 'Foldable frame'],
      attributes: [
        { group: 'Audio', label: 'Noise cancellation', value: 'No (passive isolation)' },
        { group: 'Audio', label: 'Drivers', value: '45 mm dynamic' },
        { group: 'Power', label: 'Battery', value: '30 hours' },
        { group: 'Power', label: 'Charging', value: 'USB-C, standard charge' },
        { group: 'Design', label: 'Weight', value: '286 g' },
        { group: 'Connectivity', label: 'Connectivity', value: 'Bluetooth 5.0' },
        { group: 'Support', label: 'Warranty', value: '1 year' }
      ],
      deal: null
    },
    {
      id: 'headphones-airflow-studio-pro',
      name: 'AirFlow Studio Pro — Spatial Audio',
      type: 'product',
      category: 'technology',
      subcategory: 'Headphones',
      brand: 'AirFlow',
      shortDescription: 'Premium over-ear headphones with spatial audio and companion EQ app.',
      description:
        'The third demo headphone entry, positioned at the top of the range. Spatial audio, companion app EQ, lightweight frame and a two-year warranty. Prices and claims are invented for demonstration.',
      price: { amount: 349 },
      referencePrice: null,
      location: { city: 'Nationwide', country: 'Online', format: 'online' },
      seller: { name: 'AirFlow Direct', type: 'Brand store', rating: 4.7, verified: true },
      image: { icon: '✨', gradient: 'linear-gradient(135deg,#EEF2FF,#E0E7FF)', alt: 'Premium headphones with spatial audio' },
      badge: { label: 'Premium demo pick', tone: 'accent' },
      status: 'limited',
      listedAt: '2026-09-12',
      rating: { value: 4.5, count: 41 },
      highlights: ['Spatial audio', 'Companion EQ app', 'Lightweight frame'],
      attributes: [
        { group: 'Audio', label: 'Noise cancellation', value: 'Hybrid ANC' },
        { group: 'Audio', label: 'Drivers', value: '42 mm planar' },
        { group: 'Power', label: 'Battery', value: '60 hours' },
        { group: 'Power', label: 'Charging', value: 'USB-C, 5 min quick charge' },
        { group: 'Design', label: 'Weight', value: '268 g' },
        { group: 'Connectivity', label: 'Connectivity', value: 'Bluetooth 5.4, multipoint, 3.5 mm' },
        { group: 'Support', label: 'Warranty', value: '2 years' }
      ],
      deal: null
    },
    {
      id: 'phone-edgephone-14-pro',
      name: 'EdgePhone 14 Pro — 256GB',
      type: 'product',
      category: 'technology',
      subcategory: 'Smartphones',
      brand: 'EdgePhone',
      shortDescription: 'Demo flagship smartphone with a 6.7" display and triple camera setup.',
      description:
        'A demo smartphone record. Used on the homepage and in the discovery grid to show how a physical product with a deal is presented. Display, camera and battery figures are invented.',
      price: { amount: 899 },
      referencePrice: 999,
      location: { city: 'Nationwide', country: 'Online', format: 'online' },
      seller: { name: 'TechHub', type: 'Retailer', rating: 4.7, verified: true },
      image: { icon: '📱', gradient: 'linear-gradient(135deg,#F1F5F9,#E2E8F0)', alt: 'Smartphone' },
      badge: { label: 'New arrival (demo)', tone: 'accent' },
      status: 'available',
      listedAt: '2026-09-18',
      rating: { value: 4.7, count: 212 },
      highlights: ['6.7" 120 Hz display', 'Triple camera', '2-day battery'],
      attributes: [
        { group: 'Display', label: 'Screen', value: '6.7" 120 Hz OLED' },
        { group: 'Performance', label: 'Chipset', value: 'Demo A18 (8-core)' },
        { group: 'Performance', label: 'Storage', value: '256 GB' },
        { group: 'Power', label: 'Battery', value: '4,900 mAh' },
        { group: 'Design', label: 'Weight', value: '198 g' },
        { group: 'Support', label: 'Warranty', value: '2 years' }
      ],
      deal: {
        dealPrice: 899,
        referencePrice: 999,
        discountPercent: 10,
        validFrom: '2026-09-20',
        validTo: '2026-10-31',
        conditions: ['Demo condition: applies to the 256GB model only']
      }
    },
    {
      id: 'laptop-bookair-m3',
      name: 'BookAir M3 — 14", 16GB / 512GB',
      type: 'product',
      category: 'technology',
      subcategory: 'Laptops',
      brand: 'BookAir',
      shortDescription: 'Thin-and-light demo laptop aimed at everyday work and study.',
      description:
        'A demo laptop record used across Discover, the detail view and Compare. 14-inch display, 16 GB memory, 512 GB storage and an advertised 18-hour battery. All figures are invented.',
      price: { amount: 1199 },
      referencePrice: 1299,
      location: { city: 'Nationwide', country: 'Online', format: 'online' },
      seller: { name: 'Northline Computers', type: 'Retailer', rating: 4.5, verified: false },
      image: { icon: '💻', gradient: 'linear-gradient(135deg,#E0E7FF,#C7D2FE)', alt: 'Thin laptop' },
      badge: { label: 'Popular (demo)', tone: 'neutral' },
      status: 'available',
      listedAt: '2026-09-02',
      rating: { value: 4.5, count: 96 },
      highlights: ['18-hour battery', 'Silent fanless design', '16 GB memory'],
      attributes: [
        { group: 'Display', label: 'Screen', value: '14" 2.8K 90 Hz' },
        { group: 'Performance', label: 'Memory', value: '16 GB' },
        { group: 'Performance', label: 'Storage', value: '512 GB SSD' },
        { group: 'Power', label: 'Battery', value: '18 hours (advertised)' },
        { group: 'Design', label: 'Weight', value: '1.24 kg' },
        { group: 'Connectivity', label: 'Connectivity', value: 'Wi-Fi 6E, 2× USB-C, HDMI' },
        { group: 'Support', label: 'Warranty', value: '2 years' }
      ],
      deal: null
    },

    /* ---------------------------------------------------------- Home (2) */
    {
      id: 'chair-ergoform-office',
      name: 'ErgoForm Office Chair — Mesh, Adjustable',
      type: 'product',
      category: 'home',
      subcategory: 'Furniture',
      brand: 'ErgoForm',
      shortDescription: 'Adjustable mesh task chair with lumbar support and a 5-year warranty.',
      description:
        'A demo furniture record. Included to show how a home product with a deal appears in Discover and on the Deals page. Materials and warranty terms are invented.',
      price: { amount: 219 },
      referencePrice: 269,
      location: { city: 'Lisbon', country: 'Portugal', format: 'local' },
      seller: { name: 'HomeNest', type: 'Retailer', rating: 4.5, verified: true },
      image: { icon: '💺', gradient: 'linear-gradient(135deg,#FEF3C7,#FDE68A)', alt: 'Mesh office chair' },
      badge: { label: 'Great demo value', tone: 'good' },
      status: 'limited',
      listedAt: '2026-09-10',
      rating: { value: 4.5, count: 73 },
      highlights: ['Adjustable lumbar support', 'Breathable mesh back', '5-year warranty'],
      attributes: [
        { group: 'Comfort', label: 'Lumbar support', value: 'Adjustable' },
        { group: 'Comfort', label: 'Armrests', value: '4D adjustable' },
        { group: 'Design', label: 'Material', value: 'Mesh back, foam seat' },
        { group: 'Design', label: 'Weight limit', value: '120 kg' },
        { group: 'Support', label: 'Warranty', value: '5 years' }
      ],
      deal: {
        dealPrice: 219,
        referencePrice: 269,
        discountPercent: 18,
        validFrom: '2026-09-01',
        validTo: '2026-11-15',
        conditions: ['Demo condition: local delivery only']
      }
    },
    {
      id: 'fridge-chillbox-mini-45l',
      name: 'ChillBox Mini Fridge — 45L, Silent',
      type: 'product',
      category: 'home',
      subcategory: 'Appliances',
      brand: 'ChillBox',
      shortDescription: 'Compact 45-litre fridge with a quiet compressor for small spaces.',
      description:
        'A demo appliance record. 45-litre capacity, reversible door and a low-noise compressor. Energy rating and dimensions are demonstration values.',
      price: { amount: 179 },
      referencePrice: null,
      location: { city: 'Berlin', country: 'Germany', format: 'local' },
      seller: { name: 'HomeNest', type: 'Retailer', rating: 4.5, verified: true },
      image: { icon: '🧊', gradient: 'linear-gradient(135deg,#CCFBF1,#99F6E0)', alt: 'Compact fridge' },
      badge: null,
      status: 'available',
      listedAt: '2026-08-28',
      rating: { value: 4.2, count: 38 },
      highlights: ['45-litre capacity', 'Low-noise compressor', 'Reversible door'],
      attributes: [
        { group: 'Capacity', label: 'Volume', value: '45 litres' },
        { group: 'Capacity', label: 'Shelves', value: '2 adjustable' },
        { group: 'Performance', label: 'Noise', value: '32 dB' },
        { group: 'Design', label: 'Dimensions', value: '50 × 45 × 51 cm' },
        { group: 'Support', label: 'Warranty', value: '3 years' }
      ],
      deal: null
    },

    /* ----------------------------------------------------- Automotive (2) */
    {
      id: 'ev-charger-volt-7kw',
      name: 'Volt Home Charger — 7kW Wallbox',
      type: 'product',
      category: 'automotive',
      subcategory: 'EV charging',
      brand: 'Volt',
      shortDescription: '7kW home wallbox for electric vehicles, installation arranged separately.',
      description:
        'A demo automotive accessory record. A 7kW wall-mounted charger with an app scheduler and a 5-metre cable. Installation is shown as a separate demo service once added later.',
      price: { amount: 649 },
      referencePrice: 749,
      location: { city: 'Rotterdam', country: 'Netherlands', format: 'local' },
      seller: { name: 'Volt Mobility', type: 'Brand store', rating: 4.4, verified: true },
      image: { icon: '🔌', gradient: 'linear-gradient(135deg,#E2E8F0,#CBD5E1)', alt: 'Wall-mounted EV charger' },
      badge: { label: 'Installation extra (demo)', tone: 'neutral' },
      status: 'available',
      listedAt: '2026-09-08',
      rating: { value: 4.4, count: 52 },
      highlights: ['7kW charging', 'App scheduling', '5 m cable'],
      attributes: [
        { group: 'Power', label: 'Output', value: '7 kW (1-phase)' },
        { group: 'Power', label: 'Cable', value: '5 m, fixed' },
        { group: 'Features', label: 'Scheduling', value: 'Companion app' },
        { group: 'Features', label: 'Weather rating', value: 'IP54' },
        { group: 'Support', label: 'Warranty', value: '3 years' }
      ],
      deal: {
        dealPrice: 649,
        referencePrice: 749,
        discountPercent: 13,
        validFrom: '2026-09-22',
        validTo: '2026-09-30',
        conditions: ['Demo condition: installation not included in this demo price']
      }
    },
    {
      id: 'service-autocare-full-service',
      name: 'AutoCare Full Service — Any Make',
      type: 'service',
      category: 'automotive',
      subcategory: 'Vehicle servicing',
      brand: 'AutoCare',
      shortDescription: 'Periodic vehicle service including inspection, fluids and a written report.',
      description:
        'A demo service record. Shows how PickVanta presents something you arrange rather than buy. Scope, location and turnaround are demonstration values only — no appointment is actually booked.',
      price: { min: 149, max: 289 },
      referencePrice: null,
      location: { city: 'Manchester', country: 'United Kingdom', format: 'local' },
      seller: { name: 'AutoCare Garages', type: 'Service provider', rating: 4.3, verified: true },
      image: { icon: '🔧', gradient: 'linear-gradient(135deg,#F1F5F9,#E2E8F0)', alt: 'Vehicle service' },
      badge: { label: 'Price varies by model', tone: 'neutral' },
      status: 'by-appointment',
      listedAt: '2026-08-30',
      rating: { value: 4.3, count: 87 },
      highlights: ['Any make or model', 'Written condition report', 'Same-day option'],
      attributes: [
        { group: 'Service', label: 'Included', value: 'Oil, filters, 30-point check' },
        { group: 'Service', label: 'Turnaround', value: 'Same day' },
        { group: 'Service', label: 'Appointment', value: 'Required' },
        { group: 'Service', label: 'Warranty', value: '6 months on work' }
      ],
      deal: null
    },

    /* --------------------------------------------------------- Travel (2) */
    {
      id: 'stay-sunrise-apartment-lagos',
      name: 'Sunrise 2-Bedroom Apartment — Lagos',
      type: 'service',
      category: 'travel',
      subcategory: 'Stays',
      brand: null,
      shortDescription: 'Two-bedroom demo stay with balcony, five minutes from the marina.',
      description:
        'A demo accommodation record. Stays are treated as services in PickVanta because they are arranged rather than owned. Prices are per night and are invented for demonstration.',
      price: { amount: 96, unit: 'night' },
      referencePrice: null,
      location: { city: 'Lagos', country: 'Portugal', format: 'local' },
      seller: { name: 'Sunrise Stays', type: 'Host', rating: 4.8, verified: true },
      image: { icon: '🏝️', gradient: 'linear-gradient(135deg,#CCFBF1,#99F6E0)', alt: 'Coastal apartment balcony' },
      badge: { label: 'Top rated (demo)', tone: 'good' },
      status: 'available',
      listedAt: '2026-09-14',
      rating: { value: 4.8, count: 156 },
      highlights: ['Sleeps 4', 'Balcony with sea view', 'Walk to marina'],
      attributes: [
        { group: 'Stay', label: 'Guests', value: '4 (2 bedrooms)' },
        { group: 'Stay', label: 'Minimum stay', value: '2 nights' },
        { group: 'Stay', label: 'Check-in', value: '15:00' },
        { group: 'Features', label: 'Included', value: 'Wi-Fi, kitchen, air conditioning' },
        { group: 'Conditions', label: 'Cancellation', value: 'Free up to 7 days (demo)' }
      ],
      deal: null
    },
    {
      id: 'travel-alpine-cabin-22',
      name: 'Alpine 22" Cabin Case — Carry-on',
      type: 'product',
      category: 'travel',
      subcategory: 'Luggage',
      brand: 'Wander',
      shortDescription: 'Carry-on case that meets most cabin limits at 2.1 kg empty.',
      description:
        'A demo luggage record with a deal attached, used to show how Deals communicates a discount against a reference price. Dimensions and materials are invented.',
      price: { amount: 89 },
      referencePrice: 139,
      location: { city: 'Nationwide', country: 'Online', format: 'online' },
      seller: { name: 'Wander & Co', type: 'Retailer', rating: 4.8, verified: true },
      image: { icon: '🧳', gradient: 'linear-gradient(135deg,#DCFCE7,#BBF7D0)', alt: 'Cabin suitcase' },
      badge: { label: 'Best demo discount', tone: 'good' },
      status: 'available',
      listedAt: '2026-09-16',
      rating: { value: 4.8, count: 118 },
      highlights: ['Cabin-legal size', '2.1 kg empty', '4-wheel spinner'],
      attributes: [
        { group: 'Design', label: 'Volume', value: '38 litres' },
        { group: 'Design', label: 'Weight', value: '2.1 kg' },
        { group: 'Design', label: 'Material', value: 'Polycarbonate shell' },
        { group: 'Features', label: 'Wheels', value: '4-wheel spinner' },
        { group: 'Features', label: 'Lock', value: 'Combination lock' },
        { group: 'Support', label: 'Warranty', value: '5 years' }
      ],
      deal: {
        dealPrice: 89,
        referencePrice: 139,
        discountPercent: 35,
        validFrom: '2026-09-18',
        validTo: '2026-10-12',
        conditions: ['Demo condition: two colourways included', 'Demo condition: reference price is a demo list price']
      }
    },

    /* ------------------------------------------------------- Business (2) */
    {
      id: 'service-nimbuscloud-backup',
      name: 'NimbusCloud Backup Pro — 2TB',
      type: 'service',
      category: 'business',
      subcategory: 'Cloud software',
      brand: 'NimbusCloud',
      shortDescription: 'Cloud backup subscription with versioning and device-wide restore.',
      description:
        'A demo subscription record. Digital services are treated as services in PickVanta. Storage, retention and price are invented and nothing is actually provisioned.',
      price: { amount: 12, unit: 'month' },
      referencePrice: 18,
      location: { city: 'Online', country: 'Worldwide', format: 'online' },
      seller: { name: 'NimbusCloud', type: 'Provider', rating: 4.4, verified: true },
      image: { icon: '☁️', gradient: 'linear-gradient(135deg,#E0E7FF,#C7D2FE)', alt: 'Cloud backup service' },
      badge: { label: 'Annual billing (demo)', tone: 'neutral' },
      status: 'available',
      listedAt: '2026-09-19',
      rating: { value: 4.4, count: 240 },
      highlights: ['2 TB storage', '30-day versioning', 'Up to 5 devices'],
      attributes: [
        { group: 'Plan', label: 'Storage', value: '2 TB' },
        { group: 'Plan', label: 'Devices', value: 'Up to 5' },
        { group: 'Plan', label: 'Versioning', value: '30 days' },
        { group: 'Plan', label: 'Contract', value: 'Monthly, cancel anytime (demo)' },
        { group: 'Support', label: 'Support', value: 'Email, 48 h response' }
      ],
      deal: {
        dealPrice: 12,
        referencePrice: 18,
        discountPercent: 33,
        validFrom: '2026-09-19',
        validTo: '2026-12-15',
        conditions: ['Demo condition: price shown per month on annual billing']
      }
    },
    {
      id: 'service-ledgerlite-invoicing',
      name: 'LedgerLite Invoicing — Small Teams',
      type: 'service',
      category: 'business',
      subcategory: 'Business software',
      brand: 'LedgerLite',
      shortDescription: 'Invoicing and expense tracking plan for teams of up to ten people.',
      description:
        'A demo business software record without a deal, so the Deals page has both discounted and non-discounted comparisons available. Features are invented for the interface.',
      price: { amount: 29, unit: 'month' },
      referencePrice: null,
      location: { city: 'Online', country: 'Worldwide', format: 'online' },
      seller: { name: 'LedgerLite', type: 'Provider', rating: 4.2, verified: false },
      image: { icon: '📊', gradient: 'linear-gradient(135deg,#F1F5F9,#E2E8F0)', alt: 'Invoicing software' },
      badge: null,
      status: 'available',
      listedAt: '2026-08-14',
      rating: { value: 4.2, count: 61 },
      highlights: ['Invoices and quotes', 'Expense tracking', 'Up to 10 users'],
      attributes: [
        { group: 'Plan', label: 'Users', value: 'Up to 10' },
        { group: 'Plan', label: 'Invoices', value: 'Unlimited' },
        { group: 'Plan', label: 'Contract', value: 'Monthly (demo)' },
        { group: 'Support', label: 'Support', value: 'Email and chat' }
      ],
      deal: null
    },

    /* ------------------------------------------------------ Education (2) */
    {
      id: 'course-spanish-for-travellers',
      name: 'Spanish for Travellers — 6-Week Course',
      type: 'service',
      category: 'education',
      subcategory: 'Language courses',
      brand: 'Lingua',
      shortDescription: 'Live online beginner course focused on travel situations.',
      description:
        'A demo course record. Courses are services in PickVanta. Class size, schedule and certification are demonstration details and no enrolment actually takes place.',
      price: { amount: 89 },
      referencePrice: 120,
      location: { city: 'Online', country: 'Worldwide', format: 'online' },
      seller: { name: 'Lingua Academy', type: 'Provider', rating: 4.6, verified: true },
      image: { icon: '🗣️', gradient: 'linear-gradient(135deg,#F3E8FF,#E9D5FF)', alt: 'Language course' },
      badge: { label: 'Next cohort (demo)', tone: 'accent' },
      status: 'limited',
      listedAt: '2026-09-11',
      rating: { value: 4.6, count: 74 },
      highlights: ['6 weeks, 2× weekly', 'Max 8 learners', 'Travel-focused vocabulary'],
      attributes: [
        { group: 'Course', label: 'Format', value: 'Live online' },
        { group: 'Course', label: 'Duration', value: '6 weeks, 2 sessions per week' },
        { group: 'Course', label: 'Level', value: 'Beginner (A1–A2)' },
        { group: 'Course', label: 'Class size', value: 'Max 8' },
        { group: 'Course', label: 'Certificate', value: 'On completion (demo)' }
      ],
      deal: {
        dealPrice: 89,
        referencePrice: 120,
        discountPercent: 26,
        validFrom: '2026-09-11',
        validTo: '2026-10-20',
        conditions: ['Demo condition: early-enrolment price']
      }
    },
    {
      id: 'course-data-foundations',
      name: 'Data Foundations Certificate',
      type: 'service',
      category: 'education',
      subcategory: 'Professional certificates',
      brand: 'Northline',
      shortDescription: 'Self-paced online certificate covering spreadsheets, SQL and reporting basics.',
      description:
        'A demo certificate programme. Self-paced, with a mentor session per module. Curriculum and pricing are invented for the interface demonstration.',
      price: { amount: 149 },
      referencePrice: 199,
      location: { city: 'Online', country: 'Worldwide', format: 'online' },
      seller: { name: 'Northline Learning', type: 'Provider', rating: 4.4, verified: true },
      image: { icon: '📈', gradient: 'linear-gradient(135deg,#DBEAFE,#BFDBFE)', alt: 'Data certificate course' },
      badge: { label: 'Self-paced (demo)', tone: 'neutral' },
      status: 'available',
      listedAt: '2026-09-06',
      rating: { value: 4.4, count: 133 },
      highlights: ['Self-paced', 'Mentor sessions', 'Certificate on completion'],
      attributes: [
        { group: 'Course', label: 'Format', value: 'Self-paced online' },
        { group: 'Course', label: 'Duration', value: 'Roughly 8 weeks part-time' },
        { group: 'Course', label: 'Modules', value: '6 modules, 1 mentor session each' },
        { group: 'Course', label: 'Certificate', value: 'On completion (demo)' }
      ],
      deal: {
        dealPrice: 149,
        referencePrice: 199,
        discountPercent: 25,
        validFrom: '2026-09-06',
        validTo: '2026-11-30',
        conditions: ['Demo condition: includes one resit (demo)']
      }
    },

    /* -------------------------------------------------------- Fashion (2) */
    {
      id: 'fashion-linen-overshirt',
      name: 'Coastline Linen Overshirt',
      type: 'product',
      category: 'fashion',
      subcategory: 'Shirts',
      brand: 'Coastline',
      shortDescription: 'Mid-weight linen overshirt with a relaxed cut and four pockets.',
      description:
        'A demo apparel record. Included so Discover is not only technology and home. Sizing, material composition and price are invented.',
      price: { amount: 74 },
      referencePrice: null,
      location: { city: 'Nationwide', country: 'Online', format: 'online' },
      seller: { name: 'Coastline', type: 'Brand store', rating: 4.3, verified: true },
      image: { icon: '👕', gradient: 'linear-gradient(135deg,#FFE4E6,#FECDD3)', alt: 'Linen overshirt' },
      badge: null,
      status: 'available',
      listedAt: '2026-09-13',
      rating: { value: 4.3, count: 47 },
      highlights: ['Mid-weight linen', 'Relaxed cut', 'Four pockets'],
      attributes: [
        { group: 'Product', label: 'Material', value: '62% linen, 38% cotton' },
        { group: 'Product', label: 'Fit', value: 'Relaxed' },
        { group: 'Product', label: 'Sizes', value: 'XS – XXL' },
        { group: 'Conditions', label: 'Returns', value: '30 days (demo)' }
      ],
      deal: null
    },
    {
      id: 'fashion-trailrun-sneaker',
      name: 'TrailRun Everyday Sneaker',
      type: 'product',
      category: 'fashion',
      subcategory: 'Footwear',
      brand: 'TrailRun',
      shortDescription: 'Lightweight everyday sneaker with a cushioned midsole.',
      description:
        'A demo footwear record. Weight, drop and drop-test claims are demonstration values used only to populate the interface.',
      price: { min: 95, max: 115 },
      referencePrice: null,
      location: { city: 'Nationwide', country: 'Online', format: 'online' },
      seller: { name: 'Stride House', type: 'Retailer', rating: 4.1, verified: false },
      image: { icon: '👟', gradient: 'linear-gradient(135deg,#F1F5F9,#E2E8F0)', alt: 'Everyday sneaker' },
      badge: { label: 'Price range (demo)', tone: 'neutral' },
      status: 'available',
      listedAt: '2026-08-19',
      rating: { value: 4.1, count: 29 },
      highlights: ['Lightweight', 'Cushioned midsole', 'Recycled upper'],
      attributes: [
        { group: 'Product', label: 'Weight', value: '268 g (size 42)' },
        { group: 'Product', label: 'Upper', value: 'Recycled knit' },
        { group: 'Product', label: 'Drop', value: '8 mm' },
        { group: 'Product', label: 'Sizes', value: '38 – 47' }
      ],
      deal: null
    },

    /* ------------------------------------------------------- Services (3) */
    {
      id: 'service-fibermax-home-300',
      name: 'FiberMax Home 300 — Fibre Broadband',
      type: 'service',
      category: 'services',
      subcategory: 'Internet',
      brand: 'FiberMax',
      shortDescription: '300 Mbit/s home fibre plan with a 24-month demo contract.',
      description:
        'A demo broadband plan. Internet providers are services in PickVanta: the platform helps you compare terms, not sell the line. Speeds, contract length and installation details are invented.',
      price: { amount: 39, unit: 'month' },
      referencePrice: 50,
      location: { city: 'Nationwide', country: 'Online', format: 'nationwide' },
      seller: { name: 'FiberMax', type: 'Provider', rating: 4.2, verified: true },
      image: { icon: '🛜', gradient: 'linear-gradient(135deg,#E0E7FF,#C7D2FE)', alt: 'Home fibre broadband' },
      badge: { label: 'Contract terms apply (demo)', tone: 'neutral' },
      status: 'available',
      listedAt: '2026-09-09',
      rating: { value: 4.2, count: 189 },
      highlights: ['300 Mbit/s download', 'Wi-Fi router included', 'Setup arranged locally'],
      attributes: [
        { group: 'Plan', label: 'Download', value: '300 Mbit/s' },
        { group: 'Plan', label: 'Upload', value: '150 Mbit/s' },
        { group: 'Plan', label: 'Contract', value: '24 months (demo)' },
        { group: 'Plan', label: 'Setup fee', value: '$0 (demo)' },
        { group: 'Support', label: 'Support', value: 'Phone, 7 days' }
      ],
      deal: {
        dealPrice: 39,
        referencePrice: 50,
        discountPercent: 22,
        validFrom: '2026-09-09',
        validTo: '2026-10-31',
        conditions: ['Demo condition: first 6 months at the offer price', 'Demo condition: 24-month contract required']
      }
    },
    {
      id: 'service-watchcare-repair',
      name: 'WatchCare Repair — Screen & Battery',
      type: 'service',
      category: 'services',
      subcategory: 'Repairs',
      brand: 'WatchCare',
      shortDescription: 'Watch and wearables repair service, price depends on the model.',
      description:
        'A demo repair service. Shows a service with a price range instead of a single price. Turnaround, warranty and pricing are invented and no repair is actually offered.',
      price: { min: 59, max: 149 },
      referencePrice: null,
      location: { city: 'Lisbon', country: 'Portugal', format: 'local' },
      seller: { name: 'WatchCare Studio', type: 'Service provider', rating: 4.5, verified: true },
      image: { icon: '🛠️', gradient: 'linear-gradient(135deg,#F1F5F9,#E2E8F0)', alt: 'Watch repair service' },
      badge: { label: 'Quote by model (demo)', tone: 'neutral' },
      status: 'on-request',
      listedAt: '2026-09-04',
      rating: { value: 4.5, count: 66 },
      highlights: ['Screen or battery', '48-hour turnaround', '6-month repair warranty'],
      attributes: [
        { group: 'Service', label: 'Covered', value: 'Screen, battery, seals' },
        { group: 'Service', label: 'Turnaround', value: '48 hours typical' },
        { group: 'Service', label: 'Warranty', value: '6 months on parts' },
        { group: 'Service', label: 'Availability', value: 'Quote required' }
      ],
      deal: null
    },
    {
      id: 'service-coverageplus-travel-insurance',
      name: 'CoveragePlus Travel Cover — Single Trip',
      type: 'service',
      category: 'services',
      subcategory: 'Insurance',
      brand: 'CoveragePlus',
      shortDescription: 'Single-trip travel cover with medical and baggage options.',
      description:
        'A demo insurance record. Insurance is a comparison-heavy service in PickVanta, so the structure highlights exclusions and excess rather than only price. All terms shown are invented.',
      price: { min: 24, max: 68 },
      referencePrice: null,
      location: { city: 'Nationwide', country: 'Online', format: 'nationwide' },
      seller: { name: 'CoveragePlus', type: 'Provider', rating: 4.0, verified: false },
      image: { icon: '🧾', gradient: 'linear-gradient(135deg,#FEF3C7,#FDE68A)', alt: 'Travel insurance cover' },
      badge: { label: 'Terms apply (demo)', tone: 'neutral' },
      status: 'on-request',
      listedAt: '2026-08-25',
      rating: { value: 4.0, count: 58 },
      highlights: ['Single trip cover', 'Medical + baggage options', 'Excess varies by plan'],
      attributes: [
        { group: 'Cover', label: 'Trip type', value: 'Single trip' },
        { group: 'Cover', label: 'Medical cover', value: 'Up to $250,000 (demo)' },
        { group: 'Cover', label: 'Baggage cover', value: 'Optional add-on' },
        { group: 'Cover', label: 'Excess', value: 'From $75 (demo)' },
        { group: 'Conditions', label: 'Exclusions', value: 'Listed before purchase (demo)' }
      ],
      deal: null
    }
  ];

  /* ---------------------------------------------------------------- guides */
  /* Structure only — full articles are not part of this stage. */
  const guides = [
    {
      id: 'guide-choose-smartphone',
      title: 'How to choose a smartphone',
      category: 'technology',
      icon: '📱',
      summary: 'What actually matters when comparing phones, and which specs rarely change your day-to-day experience.',
      readTime: '6 min read',
      level: 'Beginner',
      covers: ['Battery vs screen size trade-offs', 'Storage and update support', 'When a mid-range phone is enough']
    },
    {
      id: 'guide-buying-laptop',
      title: 'What to look for when buying a laptop',
      category: 'technology',
      icon: '💻',
      summary: 'A short framework for balancing weight, battery, memory and price before you compare models.',
      readTime: '7 min read',
      level: 'Beginner',
      covers: ['Memory and storage minimums', 'Ports, repairability and warranty', 'Tablet vs laptop decisions']
    },
    {
      id: 'guide-compare-internet',
      title: 'How to compare internet providers',
      category: 'services',
      icon: '🛜',
      summary: 'Speeds are only one line in the contract. Here is how to read contract length, fees and support.',
      readTime: '5 min read',
      level: 'Beginner',
      covers: ['Speed really needed per household', 'Contract length and exit costs', 'Installation and equipment fees']
    },
    {
      id: 'guide-furniture-before-buying',
      title: 'What to consider before buying furniture',
      category: 'home',
      icon: '🪑',
      summary: 'Measurements, materials and delivery conditions to check before committing to a large item.',
      readTime: '5 min read',
      level: 'Beginner',
      covers: ['Measuring doorways and rooms', 'Materials and expected lifespan', 'Assembly and returns policy']
    },
    {
      id: 'guide-read-a-deal',
      title: 'How to read a deal: reference price vs deal price',
      category: 'business',
      icon: '🏷️',
      summary: 'Understand what a discount claim is measured against, and when an offer is not really a saving.',
      readTime: '4 min read',
      level: 'Beginner',
      covers: ['Reference price definitions', 'Time-limited vs permanent offers', 'Conditions that change the value']
    },
    {
      id: 'guide-travel-cover',
      title: 'Travel cover: comparing policies that look the same',
      category: 'travel',
      icon: '🧾',
      summary: 'Excess, exclusions and claim limits matter more than the headline price of a travel policy.',
      readTime: '6 min read',
      level: 'Beginner',
      covers: ['What cover actually includes', 'Excess and claim limits', 'Pre-existing conditions']
    }
  ];

  /* ---------------------------------------------------------------- export */
  window.PICKVANTA_DATA = {
    version: 'step2-demo-1.0.0',
    demoNotice: 'Demonstration data only — nothing here is a real product, price, seller or offer.',
    types,
    categories,
    statuses,
    priceBands,
    sortOptions,
    locationOptions: [
      { code: 'any', label: 'All locations' },
      { code: 'online', label: 'Online / nationwide' },
      { code: 'local', label: 'Local sellers only' },
      { code: 'berlin', label: 'Berlin, Germany' },
      { code: 'lisbon', label: 'Lisbon, Portugal' },
      { code: 'manchester', label: 'Manchester, United Kingdom' },
      { code: 'rotterdam', label: 'Rotterdam, Netherlands' }
    ],
    /* Used by the Compare page when the visitor has not picked anything yet. */
    defaultCompareIds: ['headphones-quietmax-700', 'headphones-basswave-700', 'headphones-airflow-studio-pro'],
    items,
    guides
  };
})();
