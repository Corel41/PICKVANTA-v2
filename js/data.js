/* ==========================================================================
   PickVanta — demo data layer (Step 4 catalogue)
   --------------------------------------------------------------------------
   Static demo content only. There is no database, no API and no external
   service. Every record below is invented: fictional brands, fictional
   sellers/providers, illustrative prices in Kenyan Shillings and demonstration
   offers. Nothing here is a real listing, a real business or a current price.

   The shape of each record is intentionally close to a future database row so
   this file can later be replaced by a real data source without touching the
   UI logic:

     id, name, type, category, subcategory, brand, shortDescription,
     description, price, referencePrice, location, seller, image, attributes,
     deal, status, badge, tags, listedAt, rating, highlights

   type       : 'product' | 'service'   (products/services are distinct)
   price      : { amount | min/max, unit?, currency: 'KES' }
   attributes : [{ group, label, value }]  → flexible, not category specific
   deal       : null | { kind, headline, dealPrice, referencePrice,
                         discountPercent, validFrom, validTo, conditions[] }
                A deal is an offer attached to a product or a service — it is
                never modelled as an item of its own.
   tags       : short stable keywords used for search and related discovery
   guides     : { id, title, question, category, icon, summary, readTime,
                  level, covers[] }

   Locations are real Kenyan towns used to demonstrate local discovery, but no
   business, address, availability or price shown against them is real.
   ========================================================================== */
(() => {
  'use strict';

  const KES = 'KES';

  /* ---------------------------------------------------------------- types */
  const types = [
    { code: 'product', label: 'Product', blurb: 'Physical or digital goods' },
    { code: 'service', label: 'Service', blurb: 'Things you can arrange or book' }
  ];

  /* ----------------------------------------------------------- categories */
  const categories = [
    { slug: 'technology', label: 'Technology', icon: '💻', blurb: 'Phones, laptops, audio, networking' },
    { slug: 'home', label: 'Home', icon: '🏠', blurb: 'Furniture, appliances, lighting, storage' },
    { slug: 'automotive', label: 'Automotive', icon: '🚗', blurb: 'Tyres, batteries, electronics, detailing' },
    { slug: 'travel', label: 'Travel', icon: '✈️', blurb: 'Luggage, travel gear, stays, planning' },
    { slug: 'business', label: 'Business', icon: '💼', blurb: 'Software, design, registration support' },
    { slug: 'education', label: 'Education', icon: '🎓', blurb: 'Courses, certificates, tutoring, driving' },
    { slug: 'fashion', label: 'Fashion', icon: '👕', blurb: 'Footwear, clothing, bags, outerwear' },
    { slug: 'services', label: 'Services', icon: '🛠️', blurb: 'Internet, repairs, cleaning, local pros' }
  ];

  /* ------------------------------------------------------------- statuses */
  const statuses = [
    { code: 'available', label: 'Available', tone: 'ok', help: 'Listed as available in this demo' },
    { code: 'limited', label: 'Limited', tone: 'warn', help: 'Listed as limited in this demo' },
    { code: 'by-appointment', label: 'By appointment', tone: 'info', help: 'Arranged with the provider' },
    { code: 'on-request', label: 'On request', tone: 'info', help: 'Details shared by the provider' }
  ];

  /* ------------------------------------------------------- price band presets */
  /* Bands are chosen so the demo catalogue spreads across budget, mid-range and
     premium rather than clustering in one range. */
  const priceBands = [
    { code: 'any', label: 'Any price' },
    { code: 'under-5k', label: 'Under KSh 5,000', max: 5000 },
    { code: '5k-30k', label: 'KSh 5,000 – 30,000', min: 5000, max: 30000 },
    { code: '30k-100k', label: 'KSh 30,000 – 100,000', min: 30000, max: 100000 },
    { code: 'over-100k', label: 'KSh 100,000 and above', min: 100000 }
  ];

  /* ------------------------------------------------------------ sort options */
  const sortOptions = [
    { code: 'relevance', label: 'Relevance' },
    { code: 'newest', label: 'Newest' },
    { code: 'price-asc', label: 'Price: Low to High' },
    { code: 'price-desc', label: 'Price: High to Low' }
  ];

  /* --------------------------------------------------------- demo locations */
  /* Real towns, demonstration data. Used to show how local discovery could
     work; no business or availability shown against them is real. */
  const locationOptions = [
    { code: 'any', label: 'All locations' },
    { code: 'online', label: 'Online / nationwide' },
    { code: 'nairobi', label: 'Nairobi' },
    { code: 'mombasa', label: 'Mombasa' },
    { code: 'kisumu', label: 'Kisumu' },
    { code: 'nakuru', label: 'Nakuru' },
    { code: 'eldoret', label: 'Eldoret' },
    { code: 'kiambu', label: 'Kiambu' },
    { code: 'machakos', label: 'Machakos' },
    { code: 'thika', label: 'Thika' },
    { code: 'naivasha', label: 'Naivasha' }
  ];

  const items = [
    /* ====================================================== TECHNOLOGY (16) */
    {
      id: 'phone-zenith-x6-pro',
      name: 'Zenith X6 Pro — 256GB',
      type: 'product',
      category: 'technology',
      subcategory: 'Smartphones',
      brand: 'Zenith',
      shortDescription: 'Flagship-style demo phone with a 6.5" AMOLED display and triple camera.',
      description:
        'The flagship of the demo Zenith range: a 6.5-inch 120 Hz AMOLED display, a 50 MP triple camera and a 5,000 mAh battery. 5G, Wi-Fi 6 and 256 GB of storage in a 196 g body.',      price: { amount: 89999, currency: KES },
      referencePrice: 96000,
      location: { city: 'Nairobi', country: 'Kenya', format: 'local' },
      seller: { name: 'Zenith Store Nairobi', type: 'Brand store', rating: 4.5, verified: true },
      image: { icon: '📱', gradient: 'linear-gradient(135deg,#E0E7FF,#C7D2FE)', alt: 'Flagship smartphone' },
      badge: { label: 'Demo flagship', tone: 'accent' },
      attributes: [
        { group: 'Display', label: 'Display', value: '6.5" AMOLED, 120 Hz' },
        { group: 'Performance', label: 'Processor', value: 'Octa-core demo chip' },
        { group: 'Performance', label: 'RAM', value: '8 GB' },
        { group: 'Performance', label: 'Storage', value: '256 GB' },
        { group: 'Power', label: 'Battery', value: '5,000 mAh' },
        { group: 'Camera', label: 'Camera', value: '50 MP triple + 12 MP front' },
        { group: 'Camera', label: 'Connectivity', value: '5G, Wi-Fi 6, NFC, USB-C' },
        { group: 'Camera', label: 'Operating system', value: 'Demo OS 15' },
        { group: 'Design', label: 'Weight', value: '196 g' },
        { group: 'Support', label: 'Warranty', value: '2 years' }
      ],
      deal: {
        kind: 'percentage',
        headline: 'Launch price on the 256GB model',
        dealPrice: 79999,
        referencePrice: 89999,
        discountPercent: 11,
        validFrom: '2026-09-15',
        validTo: '2026-10-31',
        conditions: ['Demo condition: 256GB colour options included', 'Demo condition: one unit per demo order']
      },
      status: 'available',
      tags: ['smartphone', 'premium', 'camera', '5g', 'nairobi'],
      listedAt: '2026-09-18',
      rating: { value: 4.5, count: 128 },
      highlights: ['6.5" 120 Hz AMOLED display', '5,000 mAh battery', '5G with Wi-Fi 6']
    },
    {
      id: 'phone-nova-edge-5g',
      name: 'Nova Edge 5G — 256GB',
      type: 'product',
      category: 'technology',
      subcategory: 'Smartphones',
      brand: 'Nova',
      shortDescription: 'Mid-range demo phone with 5G, a large battery and a 90 Hz screen.',
      description:
        'A mid-range 5G phone built around a 6.7-inch 90 Hz screen and a 5,800 mAh battery. Comes with 8 GB of memory, 256 GB of storage and a 64 MP dual camera.',      price: { amount: 57999, currency: KES },
      referencePrice: null,
      location: { city: 'Mombasa', country: 'Kenya', format: 'local' },
      seller: { name: 'Coast Mobile Hub', type: 'Retailer', rating: 4.3, verified: true },
      image: { icon: '📲', gradient: 'linear-gradient(135deg,#DBEAFE,#BFDBFE)', alt: 'Mid-range 5G phone' },
      badge: null,
      attributes: [
        { group: 'Display', label: 'Display', value: '6.7" LCD, 90 Hz' },
        { group: 'Performance', label: 'Processor', value: 'Octa-core demo chip' },
        { group: 'Performance', label: 'RAM', value: '8 GB' },
        { group: 'Performance', label: 'Storage', value: '256 GB' },
        { group: 'Power', label: 'Battery', value: '5,800 mAh' },
        { group: 'Camera', label: 'Camera', value: '64 MP dual + 16 MP front' },
        { group: 'Camera', label: 'Connectivity', value: '5G, Wi-Fi 5, USB-C' },
        { group: 'Camera', label: 'Operating system', value: 'Demo OS 14' },
        { group: 'Design', label: 'Weight', value: '212 g' },
        { group: 'Support', label: 'Warranty', value: '18 months' }
      ],
      deal: null,
      status: 'available',
      tags: ['smartphone', 'mid-range', '5g', 'business', 'mombasa'],
      listedAt: '2026-09-06',
      rating: { value: 4.3, count: 74 },
      highlights: ['5G connectivity', '5,800 mAh battery', 'Large 6.7" screen']
    },
    {
      id: 'phone-kesi-prime-4',
      name: 'Kesi Prime 4 — 128GB',
      type: 'product',
      category: 'technology',
      subcategory: 'Smartphones',
      brand: 'Kesi',
      shortDescription: 'Budget demo phone aimed at students and first-time buyers.',
      description:
        'An entry-level 128 GB phone with a 6.5-inch screen, dual SIM and a 5,200 mAh battery. Suited to calls, messaging, maps and light everyday apps.',      price: { amount: 13499, currency: KES },
      referencePrice: null,
      location: { city: 'Nakuru', country: 'Kenya', format: 'local' },
      seller: { name: 'Rift Electronics', type: 'Retailer', rating: 4.1, verified: false },
      image: { icon: '📴', gradient: 'linear-gradient(135deg,#F1F5F9,#E2E8F0)', alt: 'Budget smartphone' },
      badge: { label: 'Budget demo pick', tone: 'neutral' },
      attributes: [
        { group: 'Display', label: 'Display', value: '6.5" LCD, 60 Hz' },
        { group: 'Performance', label: 'Processor', value: 'Entry demo chip' },
        { group: 'Performance', label: 'RAM', value: '4 GB' },
        { group: 'Performance', label: 'Storage', value: '128 GB' },
        { group: 'Power', label: 'Battery', value: '5,200 mAh' },
        { group: 'Camera', label: 'Camera', value: '13 MP dual + 8 MP front' },
        { group: 'Camera', label: 'Connectivity', value: '4G, Wi-Fi 5, USB-C' },
        { group: 'Camera', label: 'Operating system', value: 'Demo OS 13 Go' },
        { group: 'Design', label: 'Weight', value: '188 g' },
        { group: 'Support', label: 'Warranty', value: '1 year' }
      ],
      deal: null,
      status: 'available',
      tags: ['smartphone', 'budget', 'student', 'first-phone', 'nakuru'],
      listedAt: '2026-08-24',
      rating: { value: 4.1, count: 96 },
      highlights: ['Two-day battery', 'Dual SIM', 'Expandable storage']
    },
    {
      id: 'phone-zenith-x4-refurbished',
      name: 'Zenith X4 — Refurbished, 128GB',
      type: 'product',
      category: 'technology',
      subcategory: 'Smartphones',
      brand: 'Zenith',
      shortDescription: 'Refurbished older demo model with a condition grade and short warranty.',
      description:
        'A refurbished 128 GB handset graded condition B: 6.1-inch OLED screen, 5G and a battery reported above 85% health. Supplied with a charging cable and a six-month demo warranty.',      price: { amount: 18900, currency: KES },
      referencePrice: null,
      location: { city: 'Nairobi', country: 'Kenya', format: 'local' },
      seller: { name: 'RefurbPoint Nairobi', type: 'Retailer', rating: 4.0, verified: false },
      image: { icon: '♻️', gradient: 'linear-gradient(135deg,#DCFCE7,#BBF7D0)', alt: 'Refurbished smartphone' },
      badge: { label: 'Refurbished · demo', tone: 'warn' },
      attributes: [
        { group: 'Display', label: 'Display', value: '6.1" OLED, 60 Hz' },
        { group: 'Performance', label: 'Processor', value: 'Two-generation-old demo chip' },
        { group: 'Performance', label: 'RAM', value: '6 GB' },
        { group: 'Performance', label: 'Storage', value: '128 GB' },
        { group: 'Power', label: 'Battery', value: '3,600 mAh (health reported 85%+)' },
        { group: 'Camera', label: 'Camera', value: '12 MP dual + 8 MP front' },
        { group: 'Camera', label: 'Connectivity', value: '5G, Wi-Fi 6, USB-C' },
        { group: 'Camera', label: 'Operating system', value: 'Demo OS 14' },
        { group: 'Design', label: 'Weight', value: '174 g' },
        { group: 'Condition', label: 'Condition', value: 'Refurbished grade B (demo)' },
        { group: 'Condition', label: 'Included', value: 'Cable only, no box (demo)' },
        { group: 'Support', label: 'Warranty', value: '6 months' }
      ],
      deal: null,
      status: 'limited',
      tags: ['smartphone', 'refurbished', 'budget', 'student', 'value', 'nairobi'],
      listedAt: '2026-09-02',
      rating: { value: 4.0, count: 41 },
      highlights: ['Lower price, older model', 'Condition grade shown', '6-month demo warranty']
    },
    {
      id: 'laptop-slatebook-air-14',
      name: 'SlateBook Air 14 — 16GB / 512GB',
      type: 'product',
      category: 'technology',
      subcategory: 'Laptops',
      brand: 'Slate',
      shortDescription: 'Thin 14-inch demo laptop for everyday work, study and travel.',
      description:
        'A thin everyday laptop with a 14-inch 2.8K 90 Hz display, 16 GB of memory and a 512 GB SSD. Weighs 1.24 kg and carries USB-C, USB-A and HDMI ports.',      price: { amount: 124999, currency: KES },
      referencePrice: 129999,
      location: { city: 'Nairobi', country: 'Kenya', format: 'local' },
      seller: { name: 'SlatePoint Store', type: 'Brand store', rating: 4.6, verified: true },
      image: { icon: '💻', gradient: 'linear-gradient(135deg,#E0E7FF,#C7D2FE)', alt: 'Thin 14 inch laptop' },
      badge: { label: 'Demo best seller', tone: 'accent' },
      attributes: [
        { group: 'Performance', label: 'Processor', value: '8-core demo chip' },
        { group: 'Performance', label: 'RAM', value: '16 GB' },
        { group: 'Performance', label: 'Storage', value: '512 GB SSD' },
        { group: 'Performance', label: 'Graphics', value: 'Integrated' },
        { group: 'Display', label: 'Display', value: '14" 2.8K, 90 Hz' },
        { group: 'Power', label: 'Battery', value: 'Up to 18 hours (illustrative)' },
        { group: 'Design', label: 'Weight', value: '1.24 kg' },
        { group: 'Design', label: 'Ports', value: '2× USB-C, 1× USB-A, HDMI' },
        { group: 'Support', label: 'Warranty', value: '2 years' }
      ],
      deal: {
        kind: 'bundle',
        headline: 'Bundle: sleeve and wireless mouse included',
        dealPrice: 119999,
        referencePrice: 129999,
        discountPercent: 8,
        validFrom: '2026-09-10',
        validTo: '2026-11-30',
        conditions: ['Demo condition: bundle applies while demo stock lasts', 'Demo condition: accessories are demo items']
      },
      status: 'available',
      tags: ['laptop', 'remote-work', 'portable', 'premium', 'business', 'nairobi'],
      listedAt: '2026-09-12',
      rating: { value: 4.6, count: 88 },
      highlights: ['Weighs 1.24 kg', '18-hour advertised battery', '16 GB memory']
    },
    {
      id: 'laptop-slatebook-studio-16',
      name: 'SlateBook Studio 16 — 32GB / 1TB',
      type: 'product',
      category: 'technology',
      subcategory: 'Laptops',
      brand: 'Slate',
      shortDescription: 'Large-screen demo laptop for design, video and heavy multitasking.',
      description:
        'A 16-inch workstation laptop with a 3.2K 120 Hz screen, 32 GB of memory, a 1 TB SSD and dedicated graphics. Built for design, video editing and heavy multitasking.',      price: { amount: 219999, currency: KES },
      referencePrice: null,
      location: { city: 'Nairobi', country: 'Kenya', format: 'local' },
      seller: { name: 'SlatePoint Store', type: 'Brand store', rating: 4.6, verified: true },
      image: { icon: '🖥️', gradient: 'linear-gradient(135deg,#C7D2FE,#A5B4FC)', alt: 'Large screen laptop' },
      badge: null,
      attributes: [
        { group: 'Performance', label: 'Processor', value: '12-core demo chip' },
        { group: 'Performance', label: 'RAM', value: '32 GB' },
        { group: 'Performance', label: 'Storage', value: '1 TB SSD' },
        { group: 'Performance', label: 'Graphics', value: 'Dedicated demo GPU' },
        { group: 'Display', label: 'Display', value: '16" 3.2K, 120 Hz' },
        { group: 'Power', label: 'Battery', value: 'Up to 12 hours (illustrative)' },
        { group: 'Design', label: 'Weight', value: '1.92 kg' },
        { group: 'Design', label: 'Ports', value: '3× USB-C, SD card, HDMI' },
        { group: 'Support', label: 'Warranty', value: '3 years' }
      ],
      deal: null,
      status: 'available',
      tags: ['laptop', 'creator', 'gaming', 'premium', 'business'],
      listedAt: '2026-09-04',
      rating: { value: 4.4, count: 37 },
      highlights: ['32 GB memory', 'Dedicated graphics', 'Colour-accurate 16" panel']
    },
    {
      id: 'laptop-kesibook-14-student',
      name: 'Kesi Book 14 — 8GB / 256GB',
      type: 'product',
      category: 'technology',
      subcategory: 'Laptops',
      brand: 'Kesi',
      shortDescription: 'Entry-level demo laptop positioned for students and light office work.',
      description:
        'A 14-inch Full HD laptop for study and light office work: 8 GB of memory, a 256 GB SSD and up to ten hours of advertised battery life.',      price: { amount: 46999, currency: KES },
      referencePrice: null,
      location: { city: 'Eldoret', country: 'Kenya', format: 'local' },
      seller: { name: 'Highlands Computers', type: 'Retailer', rating: 4.2, verified: true },
      image: { icon: '📗', gradient: 'linear-gradient(135deg,#CCFBF1,#99F6E0)', alt: 'Entry level laptop' },
      badge: { label: 'Student demo pick', tone: 'good' },
      attributes: [
        { group: 'Performance', label: 'Processor', value: 'Quad-core demo chip' },
        { group: 'Performance', label: 'RAM', value: '8 GB' },
        { group: 'Performance', label: 'Storage', value: '256 GB SSD' },
        { group: 'Performance', label: 'Graphics', value: 'Integrated' },
        { group: 'Display', label: 'Display', value: '14" Full HD, 60 Hz' },
        { group: 'Power', label: 'Battery', value: 'Up to 10 hours (illustrative)' },
        { group: 'Design', label: 'Weight', value: '1.48 kg' },
        { group: 'Design', label: 'Ports', value: '1× USB-C, 2× USB-A, HDMI' },
        { group: 'Support', label: 'Warranty', value: '1 year' }
      ],
      deal: {
        kind: 'fixed-price',
        headline: 'Student price with any student ID',
        dealPrice: 42500,
        referencePrice: 46999,
        discountPercent: 10,
        validFrom: '2026-09-01',
        validTo: '2026-12-20',
        conditions: ['Demo condition: student ID required', 'Demo condition: one unit per student']
      },
      status: 'available',
      tags: ['laptop', 'student', 'budget', 'remote-work', 'eldoret'],
      listedAt: '2026-08-29',
      rating: { value: 4.2, count: 64 },
      highlights: ['Light for the price', 'Full HD screen', 'Student pricing demo']
    },
    {
      id: 'monitor-clearview-27-qhd',
      name: 'PixelWell 27" QHD Monitor',
      type: 'product',
      category: 'technology',
      subcategory: 'Monitors',
      brand: 'PixelWell',
      shortDescription: '27-inch QHD demo monitor with a height-adjustable stand.',
      description:
        'A 27-inch QHD IPS monitor with a 75 Hz refresh rate and a height-adjustable stand. Two HDMI inputs and a DisplayPort keep a desktop and a portable machine connected.',      price: { amount: 38500, currency: KES },
      referencePrice: null,
      location: { city: 'Nairobi', country: 'Kenya', format: 'local' },
      seller: { name: 'ScreenWorks Nairobi', type: 'Retailer', rating: 4.3, verified: true },
      image: { icon: '🖼️', gradient: 'linear-gradient(135deg,#DBEAFE,#BFDBFE)', alt: 'Desktop monitor' },
      badge: null,
      attributes: [
        { group: 'Display', label: 'Screen size', value: '27 inches' },
        { group: 'Display', label: 'Resolution', value: '2560 × 1440 (QHD)' },
        { group: 'Display', label: 'Panel', value: 'IPS demo panel' },
        { group: 'Display', label: 'Refresh rate', value: '75 Hz' },
        { group: 'Design', label: 'Stand', value: 'Height and tilt adjustable' },
        { group: 'Design', label: 'Ports', value: '2× HDMI, 1× DisplayPort' },
        { group: 'Support', label: 'Warranty', value: '3 years' }
      ],
      deal: null,
      status: 'available',
      tags: ['monitor', 'remote-work', 'student', 'business', 'nairobi'],
      listedAt: '2026-08-18',
      rating: { value: 4.3, count: 52 },
      highlights: ['QHD 27-inch panel', 'Adjustable stand', 'Three-year demo warranty']
    },
    {
      id: 'headphones-quietmax-700',
      name: 'QuietMax 700 — Wireless Over-Ear',
      type: 'product',
      category: 'technology',
      subcategory: 'Audio',
      brand: 'QuietMax',
      shortDescription: 'Adaptive noise cancelling over-ear headphones with 40-hour battery life.',
      description:
        'Over-ear headphones with adaptive noise cancelling, 40 mm drivers and 40 hours of playback per charge. Bluetooth multipoint keeps two devices connected, and a ten-minute charge adds hours of listening.',      price: { amount: 22900, currency: KES },
      referencePrice: 27900,
      location: { city: 'Nationwide', country: 'Kenya', format: 'online' },
      seller: { name: 'AudioNest Online', type: 'Retailer', rating: 4.6, verified: true },
      image: { icon: '🎧', gradient: 'linear-gradient(135deg,#E0E7FF,#C7D2FE)', alt: 'Wireless over-ear headphones' },
      badge: { label: 'Demo editor pick', tone: 'accent' },
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
        kind: 'percentage',
        headline: 'Price drop on the quiet-cancelling model',
        dealPrice: 22900,
        referencePrice: 27900,
        discountPercent: 18,
        validFrom: '2026-09-15',
        validTo: '2026-12-31',
        conditions: ['Demo condition: online sellers only', 'Demo condition: cannot be combined with other demo offers']
      },
      status: 'available',
      tags: ['audio', 'wireless', 'noise-cancelling', 'travel', 'remote-work'],
      listedAt: '2026-09-15',
      rating: { value: 4.6, count: 214 },
      highlights: ['Adaptive noise cancelling', '40-hour battery', 'USB-C quick charge']
    },
    {
      id: 'headphones-basswave-700',
      name: 'BassWave 700 — Bass Boost Over-Ear',
      type: 'product',
      category: 'technology',
      subcategory: 'Audio',
      brand: 'BassWave',
      shortDescription: 'Bass-forward over-ear headphones with a simpler feature set.',
      description:
        'Bass-forward over-ear headphones with 45 mm drivers, a foldable frame and 30 hours of playback. Bluetooth 5.0 with a standard USB-C charge.',      price: { amount: 12900, currency: KES },
      referencePrice: null,
      location: { city: 'Nationwide', country: 'Kenya', format: 'online' },
      seller: { name: 'SoundCart Kenya', type: 'Retailer', rating: 4.2, verified: true },
      image: { icon: '🎵', gradient: 'linear-gradient(135deg,#FEF3C7,#FDE68A)', alt: 'Bass boost over-ear headphones' },
      badge: { label: 'Budget demo pick', tone: 'neutral' },
      attributes: [
        { group: 'Audio', label: 'Noise cancellation', value: 'No (passive isolation)' },
        { group: 'Audio', label: 'Drivers', value: '45 mm dynamic' },
        { group: 'Power', label: 'Battery', value: '30 hours' },
        { group: 'Power', label: 'Charging', value: 'USB-C, standard charge' },
        { group: 'Design', label: 'Weight', value: '286 g' },
        { group: 'Connectivity', label: 'Connectivity', value: 'Bluetooth 5.0' },
        { group: 'Support', label: 'Warranty', value: '1 year' }
      ],
      deal: null,
      status: 'available',
      tags: ['audio', 'bass', 'budget', 'student'],
      listedAt: '2026-08-22',
      rating: { value: 4.1, count: 64 },
      highlights: ['Strong bass tuning', '30-hour battery', 'Foldable frame']
    },
    {
      id: 'headphones-airflow-studio-pro',
      name: 'AirFlow Studio Pro — Spatial Audio',
      type: 'product',
      category: 'technology',
      subcategory: 'Audio',
      brand: 'AirFlow',
      shortDescription: 'Premium over-ear headphones with spatial audio and a companion EQ app.',
      description:
        'Premium over-ear headphones with hybrid noise cancelling, 42 mm planar drivers and 60 hours of playback. Spatial audio, multipoint Bluetooth 5.4 and a 3.5 mm input for wired listening.',      price: { amount: 34500, currency: KES },
      referencePrice: null,
      location: { city: 'Nationwide', country: 'Kenya', format: 'online' },
      seller: { name: 'AirFlow Direct', type: 'Brand store', rating: 4.7, verified: true },
      image: { icon: '✨', gradient: 'linear-gradient(135deg,#EEF2FF,#E0E7FF)', alt: 'Premium spatial audio headphones' },
      badge: { label: 'Premium demo pick', tone: 'accent' },
      attributes: [
        { group: 'Audio', label: 'Noise cancellation', value: 'Hybrid ANC' },
        { group: 'Audio', label: 'Drivers', value: '42 mm planar' },
        { group: 'Power', label: 'Battery', value: '60 hours' },
        { group: 'Power', label: 'Charging', value: 'USB-C, 5 min quick charge' },
        { group: 'Design', label: 'Weight', value: '268 g' },
        { group: 'Connectivity', label: 'Connectivity', value: 'Bluetooth 5.4, multipoint, 3.5 mm' },
        { group: 'Support', label: 'Warranty', value: '2 years' }
      ],
      deal: null,
      status: 'limited',
      tags: ['audio', 'premium', 'spatial', 'professional'],
      listedAt: '2026-09-12',
      rating: { value: 4.5, count: 41 },
      highlights: ['Spatial audio', 'Companion EQ app', 'Lightweight frame']
    },
    {
      id: 'router-fibermax-ax3000',
      name: 'FiberMax AX3000 Wi-Fi 6 Router',
      type: 'product',
      category: 'technology',
      subcategory: 'Networking',
      brand: 'FiberMax',
      shortDescription: 'Dual-band Wi-Fi 6 demo router for homes and small offices.',
      description:
        'A dual-band Wi-Fi 6 router rated up to 3,000 Mbps with four Gigabit LAN ports and one WAN port. The demo coverage figure is up to 120 m² for a home or small office.',      price: { amount: 9800, currency: KES },
      referencePrice: null,
      location: { city: 'Nationwide', country: 'Kenya', format: 'nationwide' },
      seller: { name: 'FiberMax Store', type: 'Provider', rating: 4.2, verified: true },
      image: { icon: '📶', gradient: 'linear-gradient(135deg,#DBEAFE,#BFDBFE)', alt: 'Wi-Fi router' },
      badge: null,
      attributes: [
        { group: 'Wireless', label: 'Wi-Fi standard', value: 'Wi-Fi 6 (802.11ax)' },
        { group: 'Wireless', label: 'Speed', value: 'Up to 3,000 Mbps combined' },
        { group: 'Wireless', label: 'Bands', value: 'Dual band (2.4 + 5 GHz)' },
        { group: 'Wireless', label: 'Coverage', value: 'Up to 120 m² (illustrative)' },
        { group: 'Wired', label: 'Ports', value: '4× Gigabit LAN, 1× WAN' },
        { group: 'Wired', label: 'SIM support', value: 'No (fibre or cable only)' },
        { group: 'Support', label: 'Warranty', value: '2 years' }
      ],
      deal: null,
      status: 'available',
      tags: ['networking', 'wifi', 'wireless', 'remote-work', 'fast', 'family', 'router'],
      listedAt: '2026-09-08',
      rating: { value: 4.2, count: 118 },
      highlights: ['Wi-Fi 6 dual band', 'Four Gigabit LAN ports', 'Works with fibre plans']
    },
    {
      id: 'router-netlink-lte-mifi',
      name: 'MeshPoint LTE MiFi — Portable',
      type: 'product',
      category: 'technology',
      subcategory: 'Networking',
      brand: 'MeshPoint',
      shortDescription: 'Portable battery-powered LTE hotspot with SIM support.',
      description:
        'A pocket-sized LTE hotspot that takes a nano SIM and shares the connection over dual-band Wi-Fi 5. A 3,000 mAh battery runs up to ten hours between charges.',      price: { amount: 5400, currency: KES },
      referencePrice: null,
      location: { city: 'Mombasa', country: 'Kenya', format: 'local' },
      seller: { name: 'Coast Mobile Hub', type: 'Retailer', rating: 4.3, verified: true },
      image: { icon: '📡', gradient: 'linear-gradient(135deg,#CCFBF1,#99F6E0)', alt: 'Portable LTE hotspot' },
      badge: { label: 'Portable demo pick', tone: 'neutral' },
      attributes: [
        { group: 'Wireless', label: 'Wi-Fi standard', value: 'Wi-Fi 5 (802.11ac)' },
        { group: 'Wireless', label: 'Speed', value: 'Up to 300 Mbps (LTE Cat 6)' },
        { group: 'Wireless', label: 'Bands', value: 'Dual band' },
        { group: 'Wireless', label: 'Coverage', value: 'Up to 35 m² (illustrative)' },
        { group: 'Wired', label: 'Ports', value: '1× micro-USB charging' },
        { group: 'Wired', label: 'SIM support', value: 'Yes (nano SIM, SIM not included)' },
        { group: 'Power', label: 'Battery', value: '3,000 mAh, up to 10 hours' },
        { group: 'Support', label: 'Warranty', value: '1 year' }
      ],
      deal: null,
      status: 'available',
      tags: ['networking', 'wireless', 'portable', 'travel', 'budget', 'sim', 'mombasa'],
      listedAt: '2026-08-27',
      rating: { value: 4.3, count: 57 },
      highlights: ['Needs only a SIM', '10-hour battery', 'Fits in a pocket']
    },
    {
      id: 'tablet-slatepad-11',
      name: 'SlatePad 11 — 128GB, Wi-Fi',
      type: 'product',
      category: 'technology',
      subcategory: 'Tablets',
      brand: 'Slate',
      shortDescription: '11-inch demo tablet for notes, reading and light study work.',
      description:
        'An 11-inch tablet with a 90 Hz screen, 6 GB of memory and 128 GB of storage. Stylus support and an 8,000 mAh battery suit notes, reading and light study work.',      price: { amount: 62000, currency: KES },
      referencePrice: null,
      location: { city: 'Nairobi', country: 'Kenya', format: 'local' },
      seller: { name: 'SlatePoint Store', type: 'Brand store', rating: 4.6, verified: true },
      image: { icon: '📔', gradient: 'linear-gradient(135deg,#EDE9FE,#DDD6FE)', alt: 'Tablet with stylus' },
      badge: null,
      attributes: [
        { group: 'Display', label: 'Display', value: '11" LCD, 90 Hz' },
        { group: 'Performance', label: 'Processor', value: '6-core demo chip' },
        { group: 'Performance', label: 'RAM', value: '6 GB' },
        { group: 'Performance', label: 'Storage', value: '128 GB' },
        { group: 'Power', label: 'Battery', value: '8,000 mAh' },
        { group: 'Connectivity', label: 'Connectivity', value: 'Wi-Fi 6, USB-C, stylus support' },
        { group: 'Design', label: 'Weight', value: '486 g' },
        { group: 'Support', label: 'Warranty', value: '2 years' }
      ],
      deal: {
        kind: 'bundle',
        headline: 'Folio case included at this price',
        dealPrice: 58900,
        referencePrice: 62000,
        discountPercent: 5,
        validFrom: '2026-09-05',
        validTo: '2026-11-15',
        conditions: ['Demo condition: case is a demo accessory', 'Demo condition: colour availability is demo data']
      },
      status: 'available',
      tags: ['tablet', 'student', 'remote-work', 'beginner', 'nairobi'],
      listedAt: '2026-09-09',
      rating: { value: 4.4, count: 63 },
      highlights: ['Stylus support', '90 Hz screen', 'Folio case demo bundle']
    },
    {
      id: 'watch-pulsefit-6',
      name: 'Beatline Watch 6 — GPS, LTE',
      type: 'product',
      category: 'technology',
      subcategory: 'Wearables',
      brand: 'Beatline',
      shortDescription: 'Demo smartwatch with GPS, heart-rate tracking and LTE option.',
      description:
        'A fitness watch with a 1.4-inch always-on AMOLED display, GPS, heart-rate and SpO₂ sensors. Rated 5 ATM for water resistance with up to nine days of battery life.',      price: { amount: 32900, currency: KES },
      referencePrice: 38900,
      location: { city: 'Nairobi', country: 'Kenya', format: 'local' },
      seller: { name: 'Beatline Direct', type: 'Brand store', rating: 4.4, verified: true },
      image: { icon: '⌚', gradient: 'linear-gradient(135deg,#FFE4E6,#FECDD3)', alt: 'Smartwatch' },
      badge: { label: 'Fitness demo pick', tone: 'good' },
      attributes: [
        { group: 'Display', label: 'Display', value: '1.4" AMOLED, always-on' },
        { group: 'Power', label: 'Battery', value: 'Up to 9 days (illustrative)' },
        { group: 'Sensors', label: 'Sensors', value: 'Heart rate, SpO₂, GPS' },
        { group: 'Sensors', label: 'Water resistance', value: '5 ATM' },
        { group: 'Sensors', label: 'Connectivity', value: 'Bluetooth 5.2, optional LTE' },
        { group: 'Design', label: 'Compatibility', value: 'Android and iOS (demo app)' },
        { group: 'Design', label: 'Weight', value: '38 g' },
        { group: 'Support', label: 'Warranty', value: '2 years' }
      ],
      deal: {
        kind: 'limited',
        headline: 'Short demo window on the LTE variant',
        dealPrice: 27900,
        referencePrice: 32900,
        discountPercent: 15,
        validFrom: '2026-09-20',
        validTo: '2026-09-30',
        conditions: ['Demo condition: LTE variant only', 'Demo condition: ends on the stated demo date']
      },
      status: 'limited',
      tags: ['wearables', 'fitness', 'health', 'premium', 'nairobi'],
      listedAt: '2026-09-19',
      rating: { value: 4.4, count: 145 },
      highlights: ['GPS and heart-rate tracking', 'Always-on AMOLED', 'Optional LTE']
    },
    {
      id: 'accessory-glidepro-mouse',
      name: 'GlidePro Silent Wireless Mouse',
      type: 'product',
      category: 'technology',
      subcategory: 'Accessories',
      brand: 'GlidePro',
      shortDescription: 'Quiet wireless mouse with a rechargeable battery and USB-C.',
      description:
        'A rechargeable wireless mouse with quiet switches, five buttons and both Bluetooth and 2.4 GHz connectivity. USB-C charging gives up to 60 days between charges.',      price: { amount: 2450, currency: KES },
      referencePrice: null,
      location: { city: 'Nationwide', country: 'Kenya', format: 'online' },
      seller: { name: 'DeskKit Online', type: 'Retailer', rating: 4.5, verified: true },
      image: { icon: '🖱️', gradient: 'linear-gradient(135deg,#F1F5F9,#E2E8F0)', alt: 'Wireless mouse' },
      badge: { label: 'Budget accessory', tone: 'neutral' },
      attributes: [
        { group: 'Design', label: 'Buttons', value: '5 (quiet switches)' },
        { group: 'Design', label: 'Wireless', value: '2.4 GHz USB receiver + Bluetooth' },
        { group: 'Power', label: 'Battery', value: 'Rechargeable, up to 60 days' },
        { group: 'Design', label: 'Compatibility', value: 'Windows, macOS, ChromeOS, Android' },
        { group: 'Support', label: 'Warranty', value: '1 year' }
      ],
      deal: null,
      status: 'available',
      tags: ['accessories', 'remote-work', 'student', 'budget', 'wireless', 'laptop'],
      listedAt: '2026-08-15',
      rating: { value: 4.5, count: 210 },
      highlights: ['Silent clicks', 'Bluetooth or receiver', 'USB-C charging']
    },

    /* ========================================================== HOME (6) */
    {
      id: 'chair-ergoform-mesh',
      name: 'ErgoForm Mesh Office Chair',
      type: 'product',
      category: 'home',
      subcategory: 'Furniture',
      brand: 'ErgoForm',
      shortDescription: 'Adjustable mesh task chair with lumbar support and a five-year warranty.',
      description:
        'A mesh-back task chair with adjustable lumbar support, 4D armrests and a breathable foam seat. Rated to 120 kg and covered by a five-year demo warranty.',      price: { amount: 18900, currency: KES },
      referencePrice: 22300,
      location: { city: 'Nairobi', country: 'Kenya', format: 'local' },
      seller: { name: 'HomeNest Nairobi', type: 'Retailer', rating: 4.4, verified: true },
      image: { icon: '💺', gradient: 'linear-gradient(135deg,#FEF3C7,#FDE68A)', alt: 'Mesh office chair' },
      badge: { label: 'Great demo value', tone: 'good' },
      attributes: [
        { group: 'Comfort', label: 'Lumbar support', value: 'Adjustable' },
        { group: 'Comfort', label: 'Armrests', value: '4D adjustable' },
        { group: 'Design', label: 'Material', value: 'Mesh back, foam seat' },
        { group: 'Design', label: 'Dimensions', value: '68 × 66 × 118 cm' },
        { group: 'Design', label: 'Weight capacity', value: '120 kg' },
        { group: 'Support', label: 'Assembly', value: 'Self-assembly, tools included' },
        { group: 'Support', label: 'Warranty', value: '5 years' }
      ],
      deal: {
        kind: 'percentage',
        headline: 'Reduced while the demo promotion runs',
        dealPrice: 18900,
        referencePrice: 22300,
        discountPercent: 15,
        validFrom: '2026-09-01',
        validTo: '2026-11-15',
        conditions: ['Demo condition: Nairobi delivery area only', 'Demo condition: assembly not included']
      },
      status: 'limited',
      tags: ['furniture', 'office', 'remote-work', 'ergonomics', 'nairobi'],
      listedAt: '2026-09-10',
      rating: { value: 4.4, count: 86 },
      highlights: ['Adjustable lumbar support', 'Breathable mesh back', 'Five-year demo warranty']
    },
    {
      id: 'desk-ergoform-standing',
      name: 'ErgoForm Standing Desk — 120 cm',
      type: 'product',
      category: 'home',
      subcategory: 'Furniture',
      brand: 'ErgoForm',
      shortDescription: 'Electric height-adjustable demo desk with four memory presets.',
      description:
        'A 120 × 60 cm desk with electric height adjustment between 72 and 120 cm. Four memory presets store your sitting and standing positions.',      price: { amount: 42500, currency: KES },
      referencePrice: null,
      location: { city: 'Nairobi', country: 'Kenya', format: 'local' },
      seller: { name: 'HomeNest Nairobi', type: 'Retailer', rating: 4.4, verified: true },
      image: { icon: '🪑', gradient: 'linear-gradient(135deg,#FDE68A,#FCD34D)', alt: 'Height adjustable desk' },
      badge: null,
      attributes: [
        { group: 'Design', label: 'Material', value: 'Powder-coated steel, laminate top' },
        { group: 'Design', label: 'Dimensions', value: '120 × 60 cm, 72–120 cm high' },
        { group: 'Design', label: 'Weight capacity', value: '80 kg' },
        { group: 'Features', label: 'Adjustment', value: 'Electric, 4 memory presets' },
        { group: 'Support', label: 'Assembly', value: 'Self-assembly, tools included' },
        { group: 'Support', label: 'Warranty', value: '5 years' }
      ],
      deal: null,
      status: 'available',
      tags: ['furniture', 'office', 'remote-work', 'premium', 'nairobi'],
      listedAt: '2026-08-21',
      rating: { value: 4.3, count: 39 },
      highlights: ['Electric height adjustment', 'Four memory presets', 'Five-year demo warranty']
    },
    {
      id: 'mattress-dreamrest-6x6',
      name: 'Nightform 6×6 Mattress — Medium',
      type: 'product',
      category: 'home',
      subcategory: 'Furniture',
      brand: 'Nightform',
      shortDescription: 'Medium-firm demo mattress with a removable, washable cover.',
      description:
        'A 6 × 6 ft pocket-spring mattress with a medium-firm feel and a 25 cm profile. The cover unzips for washing and a 14-night trial is included in the demo terms.',      price: { amount: 34900, currency: KES },
      referencePrice: null,
      location: { city: 'Kisumu', country: 'Kenya', format: 'local' },
      seller: { name: 'Lakeview Furnishings', type: 'Retailer', rating: 4.1, verified: false },
      image: { icon: '🛏️', gradient: 'linear-gradient(135deg,#E0E7FF,#C7D2FE)', alt: 'Mattress' },
      badge: null,
      attributes: [
        { group: 'Design', label: 'Size', value: '6 × 6 ft (183 × 183 cm)' },
        { group: 'Comfort', label: 'Firmness', value: 'Medium-firm' },
        { group: 'Design', label: 'Thickness', value: '25 cm' },
        { group: 'Design', label: 'Material', value: 'Pocket spring with foam layer' },
        { group: 'Support', label: 'Trial period', value: '14 nights (demo)' },
        { group: 'Support', label: 'Warranty', value: '7 years' }
      ],
      deal: null,
      status: 'available',
      tags: ['furniture', 'family', 'bedroom', 'kisumu'],
      listedAt: '2026-08-12',
      rating: { value: 4.1, count: 27 },
      highlights: ['Medium-firm support', 'Washable cover', 'Seven-year demo warranty']
    },
    {
      id: 'fridge-chillbox-mini-45l',
      name: 'ChillBox Mini Fridge — 45L',
      type: 'product',
      category: 'home',
      subcategory: 'Appliances',
      brand: 'ChillBox',
      shortDescription: 'Compact 45-litre demo fridge with a quiet compressor.',
      description:
        'A 45-litre compact fridge with two adjustable shelves, a reversible door and a 32 dB compressor. Sits in a 50 × 45 × 51 cm footprint with a demo energy rating of A+.',      price: { amount: 21500, currency: KES },
      referencePrice: 24900,
      location: { city: 'Thika', country: 'Kenya', format: 'local' },
      seller: { name: 'Thika Home Appliances', type: 'Retailer', rating: 4.2, verified: true },
      image: { icon: '🧊', gradient: 'linear-gradient(135deg,#CCFBF1,#99F6E0)', alt: 'Compact fridge' },
      badge: null,
      attributes: [
        { group: 'Capacity', label: 'Volume', value: '45 litres' },
        { group: 'Capacity', label: 'Shelves', value: '2 adjustable' },
        { group: 'Performance', label: 'Energy', value: 'Demo rating A+' },
        { group: 'Performance', label: 'Noise', value: '32 dB' },
        { group: 'Design', label: 'Dimensions', value: '50 × 45 × 51 cm' },
        { group: 'Support', label: 'Warranty', value: '3 years' }
      ],
      deal: {
        kind: 'fixed-price',
        headline: 'Fixed demo price on the 45L model',
        dealPrice: 21500,
        referencePrice: 24900,
        discountPercent: 14,
        validFrom: '2026-09-02',
        validTo: '2026-10-20',
        conditions: ['Demo condition: delivery within Thika and Nairobi (demo)', 'Demo condition: one unit per demo order']
      },
      status: 'available',
      tags: ['appliance', 'kitchen', 'budget', 'compact-living', 'thika'],
      listedAt: '2026-09-03',
      rating: { value: 4.2, count: 44 },
      highlights: ['45-litre capacity', 'Low-noise compressor', 'Reversible door']
    },
    {
      id: 'light-lumaglow-solar-kit',
      name: 'LumaGlow Solar Home Light Kit',
      type: 'product',
      category: 'home',
      subcategory: 'Lighting',
      brand: 'LumaGlow',
      shortDescription: 'Solar charging kit with three LED lamps and a phone charging port.',
      description:
        'A solar kit with a charging panel, three 3 W LED lamps and a phone charging port. A 4,000 mAh battery stores power for up to eight hours of lighting per charge.',      price: { amount: 6400, currency: KES },
      referencePrice: null,
      location: { city: 'Machakos', country: 'Kenya', format: 'local' },
      seller: { name: 'Machakos Power Supplies', type: 'Retailer', rating: 4.0, verified: false },
      image: { icon: '💡', gradient: 'linear-gradient(135deg,#FEF9C3,#FDE68A)', alt: 'Solar light kit' },
      badge: { label: 'Everyday demo pick', tone: 'neutral' },
      attributes: [
        { group: 'Power', label: 'Output', value: '3 × 3 W LED lamps' },
        { group: 'Power', label: 'Battery', value: '4,000 mAh storage' },
        { group: 'Power', label: 'Runtime', value: 'Up to 8 hours per charge (illustrative)' },
        { group: 'Included', label: 'Included', value: 'Panel, 3 lamps, cables, phone port' },
        { group: 'Support', label: 'Warranty', value: '1 year' }
      ],
      deal: null,
      status: 'available',
      tags: ['lighting', 'solar', 'budget', 'family', 'machakos'],
      listedAt: '2026-08-08',
      rating: { value: 4.0, count: 61 },
      highlights: ['Charges during the day', 'Three lamp points', 'Phone charging port']
    },
    {
      id: 'storage-stackwise-shelving',
      name: 'StackWise 4-Tier Shelving Unit',
      type: 'product',
      category: 'home',
      subcategory: 'Storage',
      brand: 'StackWise',
      shortDescription: 'Four-tier demo shelving unit for storage rooms and small offices.',
      description:
        'A four-tier powder-coated steel shelving unit measuring 90 × 40 × 180 cm. Each shelf holds up to 50 kg and the frame can be bolted to a wall.',      price: { amount: 7900, currency: KES },
      referencePrice: null,
      location: { city: 'Nairobi', country: 'Kenya', format: 'local' },
      seller: { name: 'HomeNest Nairobi', type: 'Retailer', rating: 4.4, verified: true },
      image: { icon: '🗄️', gradient: 'linear-gradient(135deg,#E2E8F0,#CBD5E1)', alt: 'Shelving unit' },
      badge: null,
      attributes: [
        { group: 'Design', label: 'Material', value: 'Powder-coated steel' },
        { group: 'Design', label: 'Dimensions', value: '90 × 40 × 180 cm' },
        { group: 'Design', label: 'Load per shelf', value: '50 kg' },
        { group: 'Support', label: 'Assembly', value: 'Self-assembly, tools included' },
        { group: 'Support', label: 'Warranty', value: '2 years' }
      ],
      deal: null,
      status: 'available',
      tags: ['storage', 'home-office', 'budget', 'nairobi'],
      listedAt: '2026-07-30',
      rating: { value: 4.2, count: 33 },
      highlights: ['Four tiers', '50 kg per shelf', 'Bolts to the wall (fixings included)']
    },
    /* ==================================================== AUTOMOTIVE (5) */
    {
      id: 'tyre-roadgrip-195-65',
      name: 'RoadGrip Tyre 195/65 R15',
      type: 'product',
      category: 'automotive',
      subcategory: 'Tyres',
      brand: 'RoadGrip',
      shortDescription: 'All-season demo tyre sold per unit, fitting arranged locally.',
      description:
        'An all-season 195/65 R15 tyre with load index 91 and an H speed rating. Priced per tyre, with fitting and balancing arranged at the demo centre.',      price: { amount: 8900, currency: KES },
      referencePrice: 9800,
      location: { city: 'Nairobi', country: 'Kenya', format: 'local' },
      seller: { name: 'RoadGrip Tyre Centre', type: 'Retailer', rating: 4.3, verified: true },
      image: { icon: '🛞', gradient: 'linear-gradient(135deg,#E2E8F0,#CBD5E1)', alt: 'Car tyre' },
      badge: { label: 'Sold per tyre', tone: 'neutral' },
      attributes: [
        { group: 'Fitment', label: 'Size', value: '195/65 R15' },
        { group: 'Fitment', label: 'Load index', value: '91' },
        { group: 'Fitment', label: 'Speed rating', value: 'H (210 km/h)' },
        { group: 'Performance', label: 'Season', value: 'All-season' },
        { group: 'Performance', label: 'Tread warranty', value: '40,000 km (demo)' },
        { group: 'Support', label: 'Fitting', value: 'Arranged at the demo centre' }
      ],
      deal: {
        kind: 'fixed-price',
        headline: 'Fitting and balancing included at this price',
        dealPrice: 8900,
        referencePrice: 9800,
        discountPercent: 9,
        validFrom: '2026-09-08',
        validTo: '2026-10-15',
        conditions: ['Demo condition: price is per tyre', 'Demo condition: fitting demo applies to four tyres or more']
      },
      status: 'available',
      tags: ['tyres', 'car', 'maintenance', 'nairobi'],
      listedAt: '2026-09-07',
      rating: { value: 4.3, count: 58 },
      highlights: ['Per-tyre pricing', 'All-season tread', 'Fitting can be arranged']
    },
    {
      id: 'battery-voltstart-70ah',
      name: 'VoltStart Car Battery 70Ah',
      type: 'product',
      category: 'automotive',
      subcategory: 'Batteries',
      brand: 'VoltStart',
      shortDescription: 'Maintenance-free 70Ah demo battery with a two-year warranty.',
      description:
        'A sealed maintenance-free 70 Ah battery rated at 640 A cold cranking. Standard terminal layout with a two-year demo warranty and old-battery trade-in accepted.',      price: { amount: 12400, currency: KES },
      referencePrice: null,
      location: { city: 'Nakuru', country: 'Kenya', format: 'local' },
      seller: { name: 'Rift Auto Parts', type: 'Retailer', rating: 4.2, verified: true },
      image: { icon: '🔋', gradient: 'linear-gradient(135deg,#DCFCE7,#BBF7D0)', alt: 'Car battery' },
      badge: null,
      attributes: [
        { group: 'Power', label: 'Capacity', value: '70 Ah' },
        { group: 'Power', label: 'Cold cranking', value: '640 A (demo figure)' },
        { group: 'Design', label: 'Type', value: 'Maintenance-free, sealed' },
        { group: 'Design', label: 'Terminal layout', value: 'Standard, left positive' },
        { group: 'Support', label: 'Warranty', value: '2 years' },
        { group: 'Support', label: 'Old battery', value: 'Trade-in accepted (demo)' }
      ],
      deal: null,
      status: 'available',
      tags: ['car', 'maintenance', 'battery', 'nakuru'],
      listedAt: '2026-08-16',
      rating: { value: 4.2, count: 46 },
      highlights: ['Maintenance-free', 'Trade-in accepted (demo)', 'Two-year demo warranty']
    },
    {
      id: 'dashcam-roadview-2k',
      name: 'RoadView 2K Dash Camera',
      type: 'product',
      category: 'automotive',
      subcategory: 'Electronics',
      brand: 'RoadView',
      shortDescription: 'Front-facing 2K demo dash camera with loop recording.',
      description:
        'A windscreen dash camera recording 2K video at 30 fps with a 140° field of view. Loop recording, night mode and support for microSD cards up to 128 GB.',      price: { amount: 9750, currency: KES },
      referencePrice: null,
      location: { city: 'Kisumu', country: 'Kenya', format: 'local' },
      seller: { name: 'Lakeview Auto Accessories', type: 'Retailer', rating: 4.1, verified: false },
      image: { icon: '🎥', gradient: 'linear-gradient(135deg,#DBEAFE,#BFDBFE)', alt: 'Dash camera' },
      badge: null,
      attributes: [
        { group: 'Video', label: 'Resolution', value: '2K (2560 × 1440) at 30 fps' },
        { group: 'Video', label: 'Field of view', value: '140°' },
        { group: 'Video', label: 'Night recording', value: 'Yes (demo mode)' },
        { group: 'Storage', label: 'Storage support', value: 'microSD up to 128 GB (card not included)' },
        { group: 'Design', label: 'Mounting', value: 'Adhesive windscreen mount' },
        { group: 'Support', label: 'Warranty', value: '1 year' }
      ],
      deal: null,
      status: 'available',
      tags: ['car', 'accessories', 'safety', 'kisumu'],
      listedAt: '2026-08-05',
      rating: { value: 4.1, count: 29 },
      highlights: ['2K recording', 'Loop recording', 'Windscreen mount included']
    },
    {
      id: 'detailing-shinelab-full-detail',
      name: 'ShineLab Full Interior & Exterior Detail',
      type: 'service',
      category: 'automotive',
      subcategory: 'Detailing',
      brand: null,
      shortDescription: 'Demo detailing package covering interior deep clean and exterior wash and wax.',
      description:
        'A detailing package covering interior deep clean and exterior wash and wax, including seat shampoo, dashboard care and tyre dressing. Takes three to four hours and can be carried out at your location within the demo service area.',      price: { min: 3500, max: 6500, currency: KES },
      referencePrice: 8000,
      location: { city: 'Nairobi', country: 'Kenya', format: 'local' },
      seller: { name: 'ShineLab Detailing (demo)', type: 'Service provider', rating: 4.5, verified: true },
      image: { icon: '🧼', gradient: 'linear-gradient(135deg,#CCFBF1,#99F6E0)', alt: 'Car detailing service' },
      badge: { label: 'Package price', tone: 'neutral' },
      attributes: [
        { group: 'Service', label: 'Package', value: 'Interior deep clean + exterior wash and wax' },
        { group: 'Service', label: 'Included', value: 'Vacuum, seat shampoo, dashboard care, tyre dressing' },
        { group: 'Service', label: 'Duration', value: '3–4 hours' },
        { group: 'Coverage', label: 'Service area', value: 'Nairobi and Kiambu (demo)' },
        { group: 'Coverage', label: 'Availability', value: 'Weekdays and Saturdays' },
        { group: 'Coverage', label: 'Mobile service', value: 'Available within the demo area' },
        { group: 'Support', label: 'Price basis', value: 'Final price depends on vehicle size (demo)' }
      ],
      deal: {
        kind: 'package',
        headline: 'Package price for medium cars (demo)',
        dealPrice: 4500,
        referencePrice: 5600,
        discountPercent: 20,
        validFrom: '2026-09-12',
        validTo: '2026-11-30',
        conditions: ['Demo condition: applies to medium-size vehicles', 'Demo condition: large vehicles quoted separately']
      },
      status: 'by-appointment',
      tags: ['detailing', 'car-care', 'nairobi', 'professional', 'car'],
      listedAt: '2026-09-11',
      rating: { value: 4.5, count: 72 },
      highlights: ['Interior and exterior in one visit', 'Mobile service in the demo area', 'Price varies by vehicle size']
    },
    {
      id: 'detailing-gleamworks-ceramic',
      name: 'GleamWorks Ceramic Coating Package',
      type: 'service',
      category: 'automotive',
      subcategory: 'Detailing',
      brand: null,
      shortDescription: 'Demo ceramic coating service including paint preparation.',
      description:
        'A workshop coating service: paint preparation with clay bar and polish, then a ceramic layer and an interior wipe-down. One full drop-off day, with a 12-month demo coating warranty.',      price: { amount: 28000, currency: KES },
      referencePrice: 35000,
      location: { city: 'Kiambu', country: 'Kenya', format: 'local' },
      seller: { name: 'GleamWorks Auto Care (demo)', type: 'Service provider', rating: 4.6, verified: true },
      image: { icon: '✨', gradient: 'linear-gradient(135deg,#EDE9FE,#DDD6FE)', alt: 'Ceramic coating service' },
      badge: { label: 'Premium demo service', tone: 'accent' },
      attributes: [
        { group: 'Service', label: 'Package', value: 'Paint preparation + ceramic coating' },
        { group: 'Service', label: 'Included', value: 'Wash, clay bar, polish, coating, interior wipe-down' },
        { group: 'Service', label: 'Duration', value: '1 full day (drop-off)' },
        { group: 'Coverage', label: 'Service area', value: 'Kiambu and northern Nairobi (demo)' },
        { group: 'Coverage', label: 'Availability', value: 'Booked slots only' },
        { group: 'Coverage', label: 'Mobile service', value: 'No — workshop only' },
        { group: 'Support', label: 'Price basis', value: 'Fixed per vehicle size (demo)' },
        { group: 'Support', label: 'Demo coating warranty', value: '12 months' }
      ],
      deal: {
        kind: 'package',
        headline: 'Workshop price with paint preparation included',
        dealPrice: 28000,
        referencePrice: 35000,
        discountPercent: 20,
        validFrom: '2026-09-05',
        validTo: '2026-12-10',
        conditions: ['Demo condition: workshop bookings only', 'Demo condition: demo coating warranty of 12 months']
      },
      status: 'by-appointment',
      tags: ['detailing', 'car-care', 'premium', 'kiambu', 'car'],
      listedAt: '2026-09-01',
      rating: { value: 4.6, count: 38 },
      highlights: ['Paint preparation included', 'Full-day workshop service', '12-month demo coating warranty']
    },

    /* ======================================================= TRAVEL (4) */
    {
      id: 'luggage-alpine-cabin-22',
      name: 'Skyward 22" Cabin Case — Carry-on',
      type: 'product',
      category: 'travel',
      subcategory: 'Luggage',
      brand: 'Skyward',
      shortDescription: 'Carry-on demo case that meets most cabin limits at 2.1 kg empty.',
      description:
        'A 38-litre carry-on case in a polycarbonate shell weighing 2.1 kg empty. Four spinner wheels, a combination lock and a five-year demo warranty.',      price: { amount: 9900, currency: KES },
      referencePrice: 13900,
      location: { city: 'Nationwide', country: 'Kenya', format: 'online' },
      seller: { name: 'Roamkit & Co (demo)', type: 'Retailer', rating: 4.6, verified: true },
      image: { icon: '🧳', gradient: 'linear-gradient(135deg,#DCFCE7,#BBF7D0)', alt: 'Cabin suitcase' },
      badge: { label: 'Best demo discount', tone: 'good' },
      attributes: [
        { group: 'Design', label: 'Volume', value: '38 litres' },
        { group: 'Design', label: 'Weight', value: '2.1 kg' },
        { group: 'Design', label: 'Material', value: 'Polycarbonate shell' },
        { group: 'Features', label: 'Wheels', value: '4-wheel spinner' },
        { group: 'Features', label: 'Lock', value: 'Combination lock' },
        { group: 'Support', label: 'Warranty', value: '5 years' }
      ],
      deal: {
        kind: 'percentage',
        headline: 'Cabin case demo price, two colourways',
        dealPrice: 9900,
        referencePrice: 13900,
        discountPercent: 29,
        validFrom: '2026-09-18',
        validTo: '2026-10-12',
        conditions: ['Demo condition: two colourways included', 'Demo condition: reference price is an illustrative list price']
      },
      status: 'available',
      tags: ['luggage', 'travel', 'cabin', 'weekend', 'budget'],
      listedAt: '2026-09-16',
      rating: { value: 4.6, count: 118 },
      highlights: ['Cabin-legal size', '2.1 kg empty', 'Four-wheel spinner']
    },
    {
      id: 'luggage-wander-duffel-45',
      name: 'Roamkit 45L Duffel Bag',
      type: 'product',
      category: 'travel',
      subcategory: 'Luggage',
      brand: 'Roamkit',
      shortDescription: 'Soft 45-litre demo duffel with a separate shoe compartment.',
      description:
        'A soft 45-litre duffel weighing under a kilogram, with a separate shoe compartment and a padlock loop. Carries on a shoulder strap and folds flat when empty.',      price: { amount: 5600, currency: KES },
      referencePrice: null,
      location: { city: 'Nationwide', country: 'Kenya', format: 'online' },
      seller: { name: 'Roamkit & Co (demo)', type: 'Retailer', rating: 4.6, verified: true },
      image: { icon: '🎒', gradient: 'linear-gradient(135deg,#CCFBF1,#99F6E0)', alt: 'Travel duffel bag' },
      badge: null,
      attributes: [
        { group: 'Design', label: 'Volume', value: '45 litres' },
        { group: 'Design', label: 'Weight', value: '0.9 kg' },
        { group: 'Design', label: 'Material', value: 'Recycled polyester (demo)' },
        { group: 'Features', label: 'Wheels', value: 'None — shoulder strap' },
        { group: 'Features', label: 'Lock', value: 'Padlock loop only' },
        { group: 'Support', label: 'Warranty', value: '2 years' }
      ],
      deal: null,
      status: 'available',
      tags: ['luggage', 'travel', 'budget', 'weekend', 'student'],
      listedAt: '2026-08-14',
      rating: { value: 4.4, count: 47 },
      highlights: ['Separate shoe pocket', 'Under 1 kg empty', 'Folds flat for storage']
    },
    {
      id: 'stay-sunrise-apartment-diani',
      name: 'Sunrise 2-Bedroom Apartment — Diani',
      type: 'service',
      category: 'travel',
      subcategory: 'Stays',
      brand: null,
      shortDescription: 'Two-bedroom demo stay near the beach with a balcony and full kitchen.',
      description:
        'A two-bedroom apartment sleeping four guests, with a full kitchen, air conditioning, Wi-Fi and parking. Two-night minimum stay, with free cancellation up to seven days before arrival in the demo terms.',      price: { amount: 8500, unit: 'night', currency: KES },
      referencePrice: null,
      location: { city: 'Mombasa', country: 'Kenya', format: 'local' },
      seller: { name: 'Sunrise Stays (demo host)', type: 'Host', rating: 4.8, verified: true },
      image: { icon: '🏝️', gradient: 'linear-gradient(135deg,#CCFBF1,#99F6E0)', alt: 'Coastal apartment' },
      badge: { label: 'Top rated (demo)', tone: 'good' },
      attributes: [
        { group: 'Stay', label: 'Guests', value: '4 (2 bedrooms)' },
        { group: 'Stay', label: 'Minimum stay', value: '2 nights' },
        { group: 'Stay', label: 'Check-in', value: '15:00' },
        { group: 'Included', label: 'Included', value: 'Wi-Fi, kitchen, air conditioning, parking' },
        { group: 'Coverage', label: 'Service area', value: 'Diani, south coast (demo)' },
        { group: 'Coverage', label: 'Availability', value: 'Weekends and holidays book first (demo)' },
        { group: 'Conditions', label: 'Cancellation', value: 'Free up to 7 days before arrival (demo)' }
      ],
      deal: null,
      status: 'available',
      tags: ['stays', 'family', 'coastal', 'weekend', 'mombasa', 'holiday'],
      listedAt: '2026-09-14',
      rating: { value: 4.8, count: 156 },
      highlights: ['Sleeps four', 'Walk to the beach', 'Self-catering kitchen']
    },
    {
      id: 'service-safariline-trip-planning',
      name: 'Safariline Trip Planning Service',
      type: 'service',
      category: 'travel',
      subcategory: 'Trip planning',
      brand: null,
      shortDescription: 'Demo planning package that builds an itinerary and budget outline.',
      description:
        'A planning package that produces a written itinerary, an accommodation shortlist and a cost estimate for your dates. Delivered online within three working days with two revision rounds included.',      price: { amount: 6000, currency: KES },
      referencePrice: null,
      location: { city: 'Online', country: 'Kenya', format: 'online' },
      seller: { name: 'Safariline Travel Planning (demo)', type: 'Service provider', rating: 4.4, verified: true },
      image: { icon: '🗺️', gradient: 'linear-gradient(135deg,#DBEAFE,#BFDBFE)', alt: 'Travel planning service' },
      badge: null,
      attributes: [
        { group: 'Service', label: 'Package', value: 'Itinerary + budget outline' },
        { group: 'Service', label: 'Included', value: 'Route plan, accommodation shortlist, cost estimate' },
        { group: 'Service', label: 'Turnaround', value: '3 working days' },
        { group: 'Coverage', label: 'Delivery method', value: 'Online (document pack)' },
        { group: 'Coverage', label: 'Availability', value: 'Two revision rounds included (demo)' },
        { group: 'Support', label: 'Contact', value: 'Demo interaction only — no real booking or messaging' }
      ],
      deal: null,
      status: 'available',
      tags: ['trip-planning', 'holiday', 'professional', 'online', 'beginner'],
      listedAt: '2026-08-30',
      rating: { value: 4.4, count: 31 },
      highlights: ['Written itinerary and budget', 'Three-day turnaround', 'Two revisions included']
    },

    /* ===================================================== BUSINESS (4) */
    {
      id: 'service-ledgerlite-invoicing',
      name: 'LedgerLite Invoicing — Small Teams',
      type: 'service',
      category: 'business',
      subcategory: 'Software',
      brand: 'LedgerLite',
      shortDescription: 'Invoicing and expense plan for teams of up to ten people.',
      description:
        'Invoicing and expense tracking for teams of up to ten people, with unlimited invoices and a mobile app. Monthly billing with no contract and a 14-day trial in the demo plan.',      price: { amount: 2900, unit: 'month', currency: KES },
      referencePrice: null,
      location: { city: 'Online', country: 'Kenya', format: 'online' },
      seller: { name: 'LedgerLite (demo provider)', type: 'Provider', rating: 4.2, verified: false },
      image: { icon: '📊', gradient: 'linear-gradient(135deg,#F1F5F9,#E2E8F0)', alt: 'Invoicing software' },
      badge: null,
      attributes: [
        { group: 'Plan', label: 'Users', value: 'Up to 10' },
        { group: 'Plan', label: 'Invoices', value: 'Unlimited' },
        { group: 'Plan', label: 'Contract', value: 'Monthly, cancel anytime (demo)' },
        { group: 'Coverage', label: 'Delivery method', value: 'Online (browser and mobile app)' },
        { group: 'Support', label: 'Support', value: 'Email and chat' },
        { group: 'Support', label: 'Trial', value: '14 days (demo)' }
      ],
      deal: null,
      status: 'available',
      tags: ['software', 'invoicing', 'small-business', 'business', 'online'],
      listedAt: '2026-08-14',
      rating: { value: 4.2, count: 61 },
      highlights: ['Unlimited invoices', 'Up to ten users', 'Cancel anytime (demo)']
    },
    {
      id: 'service-nimbuscloud-backup',
      name: 'NimbusCloud Backup Pro — 2TB',
      type: 'service',
      category: 'business',
      subcategory: 'Software',
      brand: 'NimbusCloud',
      shortDescription: 'Cloud backup subscription with 30-day version history.',
      description:
        'Cloud backup for up to five devices with 2 TB of storage and 30 days of version history. Billed monthly or annually, with email support in the demo plan.',      price: { amount: 1600, unit: 'month', currency: KES },
      referencePrice: 2400,
      location: { city: 'Online', country: 'Kenya', format: 'online' },
      seller: { name: 'NimbusCloud (demo provider)', type: 'Provider', rating: 4.4, verified: true },
      image: { icon: '☁️', gradient: 'linear-gradient(135deg,#E0E7FF,#C7D2FE)', alt: 'Cloud backup service' },
      badge: { label: 'Annual billing (demo)', tone: 'neutral' },
      attributes: [
        { group: 'Plan', label: 'Storage', value: '2 TB' },
        { group: 'Plan', label: 'Devices', value: 'Up to 5' },
        { group: 'Plan', label: 'Retention', value: '30-day version history' },
        { group: 'Plan', label: 'Contract', value: 'Monthly or annual (demo)' },
        { group: 'Coverage', label: 'Delivery method', value: 'Online (desktop and mobile apps)' },
        { group: 'Support', label: 'Support', value: 'Email, 48-hour response (demo)' }
      ],
      deal: {
        kind: 'billing',
        headline: 'Annual billing price (per month, demo)',
        dealPrice: 1600,
        referencePrice: 2400,
        discountPercent: 33,
        validFrom: '2026-09-19',
        validTo: '2026-12-15',
        conditions: ['Demo condition: price shown per month on annual billing', 'Demo condition: nothing is provisioned in this build']
      },
      status: 'available',
      tags: ['cloud', 'backup', 'software', 'business', 'small-business', 'online'],
      listedAt: '2026-09-17',
      rating: { value: 4.4, count: 240 },
      highlights: ['2 TB storage', 'Five devices', 'Annual billing option']
    },
    {
      id: 'service-studionine-web-design',
      name: 'StudioNine Website Design Package',
      type: 'service',
      category: 'business',
      subcategory: 'Web design',
      brand: null,
      shortDescription: 'Demo five-page website package with one revision round and handover.',
      description:
        'A design package covering up to five pages: layout design, build, basic search setup and a handover session. Delivered in ten to fifteen working days with two revision rounds.',      price: { min: 65000, max: 140000, currency: KES },
      referencePrice: null,
      location: { city: 'Nairobi', country: 'Kenya', format: 'local' },
      seller: { name: 'StudioNine Design (demo)', type: 'Service provider', rating: 4.5, verified: true },
      image: { icon: '🎨', gradient: 'linear-gradient(135deg,#EDE9FE,#DDD6FE)', alt: 'Website design service' },
      badge: { label: 'Quote-based', tone: 'neutral' },
      attributes: [
        { group: 'Service', label: 'Package', value: 'Up to 5 pages, content-ready' },
        { group: 'Service', label: 'Included', value: 'Layout design, build, basic SEO setup, handover session' },
        { group: 'Service', label: 'Timeline', value: '10–15 working days' },
        { group: 'Coverage', label: 'Delivery method', value: 'Online with two video calls' },
        { group: 'Coverage', label: 'Availability', value: 'Two projects per month (demo)' },
        { group: 'Support', label: 'Revisions', value: '2 rounds included' },
        { group: 'Support', label: 'Price basis', value: 'Final quote depends on page count (demo)' }
      ],
      deal: null,
      status: 'on-request',
      tags: ['web-design', 'professional', 'business', 'startup', 'nairobi'],
      listedAt: '2026-08-26',
      rating: { value: 4.5, count: 44 },
      highlights: ['Five-page package', 'Two revision rounds', 'Handover session included']
    },
    {
      id: 'service-bizreg-assist',
      name: 'BizReg Business Registration Assist',
      type: 'service',
      category: 'business',
      subcategory: 'Business registration',
      brand: null,
      shortDescription: 'Demo assistance package for business name registration paperwork.',
      description:
        'Assistance with business-name registration paperwork: form filling, a submission checklist and document review. Typically five to ten working days, with official government fees payable separately.',      price: { amount: 12500, currency: KES },
      referencePrice: null,
      location: { city: 'Nationwide', country: 'Kenya', format: 'nationwide' },
      seller: { name: 'BizReg Assist (demo)', type: 'Service provider', rating: 4.1, verified: false },
      image: { icon: '📄', gradient: 'linear-gradient(135deg,#F1F5F9,#E2E8F0)', alt: 'Business registration service' },
      badge: null,
      attributes: [
        { group: 'Service', label: 'Package', value: 'Name search + registration paperwork' },
        { group: 'Service', label: 'Included', value: 'Form filling, submission checklist, document review' },
        { group: 'Service', label: 'Timeline', value: '5–10 working days (demo)' },
        { group: 'Coverage', label: 'Delivery method', value: 'Online and phone (demo)' },
        { group: 'Coverage', label: 'Service area', value: 'Nationwide (demo)' },
        { group: 'Support', label: 'Government fees', value: 'Not included — payable separately (demo)' }
      ],
      deal: null,
      status: 'available',
      tags: ['business-registration', 'professional', 'startup', 'compliance', 'online'],
      listedAt: '2026-08-09',
      rating: { value: 4.1, count: 52 },
      highlights: ['Document checklist included', 'Five to ten day timeline', 'Official fees excluded']
    },

    /* ==================================================== EDUCATION (4) */
    {
      id: 'course-spanish-for-travellers',
      name: 'Spanish for Travellers — 6-Week Course',
      type: 'service',
      category: 'education',
      subcategory: 'Languages',
      brand: null,
      shortDescription: 'Live online beginner course focused on travel situations.',
      description:
        'A six-week live online course for beginners, with two sessions a week and a maximum of eight learners. Focused on travel situations such as directions, bookings and ordering food.',      price: { amount: 12400, currency: KES },
      referencePrice: 15500,
      location: { city: 'Online', country: 'Kenya', format: 'online' },
      seller: { name: 'Lingua Academy (demo)', type: 'Provider', rating: 4.6, verified: true },
      image: { icon: '🗣️', gradient: 'linear-gradient(135deg,#F3E8FF,#E9D5FF)', alt: 'Language course' },
      badge: { label: 'Next cohort (demo)', tone: 'accent' },
      attributes: [
        { group: 'Course', label: 'Format', value: 'Live online sessions' },
        { group: 'Course', label: 'Duration', value: '6 weeks, 2 sessions per week' },
        { group: 'Course', label: 'Level', value: 'Beginner (A1–A2)' },
        { group: 'Course', label: 'Class size', value: 'Maximum 8 learners' },
        { group: 'Course', label: 'Certificate', value: 'On completion (demo)' },
        { group: 'Coverage', label: 'Delivery method', value: 'Online (video call)' }
      ],
      deal: {
        kind: 'fixed-price',
        headline: 'Early-enrolment demo price',
        dealPrice: 9900,
        referencePrice: 12400,
        discountPercent: 20,
        validFrom: '2026-09-11',
        validTo: '2026-10-20',
        conditions: ['Demo condition: early-enrolment price', 'Demo condition: no real enrolment takes place']
      },
      status: 'limited',
      tags: ['language', 'course', 'travel', 'beginner', 'online', 'student'],
      listedAt: '2026-09-11',
      rating: { value: 4.6, count: 74 },
      highlights: ['Travel-focused vocabulary', 'Maximum eight learners', 'Certificate on completion (demo)']
    },
    {
      id: 'course-data-foundations',
      name: 'Data Foundations Certificate',
      type: 'service',
      category: 'education',
      subcategory: 'Certificates',
      brand: null,
      shortDescription: 'Self-paced online certificate covering spreadsheets, SQL and reporting basics.',
      description:
        'A self-paced certificate covering spreadsheets, SQL and reporting basics across six modules. Each module includes a live mentor session, and a certificate is issued on completion.',      price: { amount: 18900, currency: KES },
      referencePrice: 22500,
      location: { city: 'Online', country: 'Kenya', format: 'online' },
      seller: { name: 'Northline Learning (demo)', type: 'Provider', rating: 4.4, verified: true },
      image: { icon: '📈', gradient: 'linear-gradient(135deg,#DBEAFE,#BFDBFE)', alt: 'Data certificate course' },
      badge: { label: 'Self-paced (demo)', tone: 'neutral' },
      attributes: [
        { group: 'Course', label: 'Format', value: 'Self-paced online' },
        { group: 'Course', label: 'Duration', value: 'Roughly 8 weeks part-time' },
        { group: 'Course', label: 'Level', value: 'Beginner to intermediate' },
        { group: 'Course', label: 'Modules', value: '6 modules, 1 mentor session each' },
        { group: 'Course', label: 'Certificate', value: 'On completion (demo)' },
        { group: 'Coverage', label: 'Delivery method', value: 'Online (recorded + live mentor)' }
      ],
      deal: {
        kind: 'percentage',
        headline: 'Enrolment window discount (demo)',
        dealPrice: 15900,
        referencePrice: 18900,
        discountPercent: 16,
        validFrom: '2026-09-06',
        validTo: '2026-11-30',
        conditions: ['Demo condition: includes one resit', 'Demo condition: mentor sessions are demo content']
      },
      status: 'available',
      tags: ['certificate', 'data', 'professional', 'online', 'business', 'student'],
      listedAt: '2026-09-06',
      rating: { value: 4.4, count: 133 },
      highlights: ['Six modules with mentors', 'Self-paced', 'Certificate on completion (demo)']
    },
    {
      id: 'service-mindpath-maths-tutoring',
      name: 'MindPath Maths Tutoring — Secondary',
      type: 'service',
      category: 'education',
      subcategory: 'Tutoring',
      brand: null,
      shortDescription: 'Demo tutoring sessions for secondary school maths, in person or online.',
      description:
        'One-to-one secondary maths tutoring in 90-minute sessions, at home within the demo service area or online. Weekday evenings and Saturdays, with a ten-session package available.',      price: { amount: 2200, unit: 'session', currency: KES },
      referencePrice: null,
      location: { city: 'Nairobi', country: 'Kenya', format: 'local' },
      seller: { name: 'MindPath Tutors (demo)', type: 'Service provider', rating: 4.3, verified: false },
      image: { icon: '📐', gradient: 'linear-gradient(135deg,#DCFCE7,#BBF7D0)', alt: 'Maths tutoring service' },
      badge: { label: 'Per session', tone: 'neutral' },
      attributes: [
        { group: 'Service', label: 'Format', value: 'One-to-one, in person or online' },
        { group: 'Service', label: 'Session length', value: '90 minutes' },
        { group: 'Service', label: 'Subjects', value: 'Secondary maths (demo syllabus coverage)' },
        { group: 'Coverage', label: 'Service area', value: 'Nairobi, in person in Westlands area (demo)' },
        { group: 'Coverage', label: 'Availability', value: 'Weekday evenings and Saturdays' },
        { group: 'Support', label: 'Package', value: '10-session package available (demo)' }
      ],
      deal: null,
      status: 'by-appointment',
      tags: ['tutoring', 'student', 'family', 'nairobi', 'education'],
      listedAt: '2026-08-19',
      rating: { value: 4.3, count: 36 },
      highlights: ['90-minute sessions', 'Ten-session package available', 'Evening and weekend slots']
    },
    {
      id: 'service-safedrive-driving-lessons',
      name: 'SafeDrive Driving Lessons',
      type: 'service',
      category: 'education',
      subcategory: 'Driving',
      brand: null,
      shortDescription: 'Demo driving lessons with a package option and instructor-led practice.',
      description:
        'In-car driving lessons of 45 minutes in a dual-control vehicle, covering town driving, parking and road rules. Available daily except Sunday, with a twelve-lesson package option.',      price: { min: 1800, max: 2000, unit: 'lesson', currency: KES },
      referencePrice: null,
      location: { city: 'Kisumu', country: 'Kenya', format: 'local' },
      seller: { name: 'SafeDrive School (demo)', type: 'Service provider', rating: 4.2, verified: true },
      image: { icon: '🚦', gradient: 'linear-gradient(135deg,#FEF3C7,#FDE68A)', alt: 'Driving lessons' },
      badge: { label: 'Package available', tone: 'neutral' },
      attributes: [
        { group: 'Service', label: 'Format', value: 'In-car lessons with an instructor' },
        { group: 'Service', label: 'Lesson length', value: '45 minutes' },
        { group: 'Service', label: 'Package', value: '12-lesson package available (demo)' },
        { group: 'Coverage', label: 'Service area', value: 'Kisumu town and nearby estates (demo)' },
        { group: 'Coverage', label: 'Availability', value: 'Daily except Sunday' },
        { group: 'Support', label: 'Vehicle', value: 'Manual demo vehicle with dual controls' }
      ],
      deal: null,
      status: 'by-appointment',
      tags: ['driving', 'lessons', 'beginner', 'kisumu', 'education'],
      listedAt: '2026-08-02',
      rating: { value: 4.2, count: 89 },
      highlights: ['45-minute lessons', 'Twelve-lesson package', 'Dual-control vehicle']
    },

    /* ====================================================== FASHION (4) */
    {
      id: 'fashion-trailrun-sneaker',
      name: 'Stridewell Everyday Sneaker',
      type: 'product',
      category: 'fashion',
      subcategory: 'Footwear',
      brand: 'Stridewell',
      shortDescription: 'Lightweight everyday demo sneaker with a cushioned midsole.',
      description:
        'An everyday sneaker with a knit upper and a cushioned EVA midsole, weighing 268 g in size 42. Available in sizes 38 to 47 with 30-day demo returns.',      price: { min: 5200, max: 6400, currency: KES },
      referencePrice: null,
      location: { city: 'Nationwide', country: 'Kenya', format: 'online' },
      seller: { name: 'Stride House (demo)', type: 'Retailer', rating: 4.1, verified: false },
      image: { icon: '👟', gradient: 'linear-gradient(135deg,#F1F5F9,#E2E8F0)', alt: 'Everyday sneaker' },
      badge: { label: 'Price range (demo)', tone: 'neutral' },
      attributes: [
        { group: 'Product', label: 'Weight', value: '268 g (size 42)' },
        { group: 'Product', label: 'Upper', value: 'Recycled knit (demo)' },
        { group: 'Product', label: 'Sole', value: 'Cushioned EVA midsole' },
        { group: 'Product', label: 'Sizes', value: '38 – 47' },
        { group: 'Support', label: 'Returns', value: '30 days (demo)' }
      ],
      deal: null,
      status: 'available',
      tags: ['footwear', 'everyday', 'budget', 'student', 'lightweight'],
      listedAt: '2026-08-01',
      rating: { value: 4.1, count: 29 },
      highlights: ['Lightweight knit upper', 'Sizes 38–47', '30-day demo returns']
    },
    {
      id: 'fashion-coastline-overshirt',
      name: 'Coastline Linen Overshirt',
      type: 'product',
      category: 'fashion',
      subcategory: 'Clothing',
      brand: 'Coastline',
      shortDescription: 'Mid-weight linen overshirt with a relaxed cut and four pockets.',
      description:
        'A relaxed linen-cotton overshirt with four pockets and a mid-weight feel. Machine washable and available in sizes XS to XXL.',      price: { amount: 4900, currency: KES },
      referencePrice: null,
      location: { city: 'Nationwide', country: 'Kenya', format: 'online' },
      seller: { name: 'Coastline (demo brand store)', type: 'Brand store', rating: 4.3, verified: true },
      image: { icon: '👕', gradient: 'linear-gradient(135deg,#FFE4E6,#FECDD3)', alt: 'Linen overshirt' },
      badge: null,
      attributes: [
        { group: 'Product', label: 'Material', value: '62% linen, 38% cotton (demo)' },
        { group: 'Product', label: 'Fit', value: 'Relaxed' },
        { group: 'Product', label: 'Sizes', value: 'XS – XXL' },
        { group: 'Product', label: 'Care', value: 'Machine wash cold' },
        { group: 'Support', label: 'Returns', value: '30 days (demo)' }
      ],
      deal: null,
      status: 'available',
      tags: ['clothing', 'everyday', 'linen', 'budget'],
      listedAt: '2026-07-28',
      rating: { value: 4.3, count: 41 },
      highlights: ['Breathable linen blend', 'Four pockets', 'Relaxed cut']
    },
    {
      id: 'bag-urbansling-laptop-backpack',
      name: 'UrbanSling 15" Laptop Backpack',
      type: 'product',
      category: 'fashion',
      subcategory: 'Bags',
      brand: 'UrbanSling',
      shortDescription: 'Padded 15-inch laptop backpack with a water-resistant base.',
      description:
        'A 22-litre backpack with a padded sleeve for notebooks up to 15.6 inches and a water-resistant base. Weighs 0.8 kg and carries study or work gear comfortably.',      price: { amount: 4200, currency: KES },
      referencePrice: null,
      location: { city: 'Nairobi', country: 'Kenya', format: 'local' },
      seller: { name: 'UrbanSling (demo brand store)', type: 'Brand store', rating: 4.4, verified: true },
      image: { icon: '🎒', gradient: 'linear-gradient(135deg,#DBEAFE,#BFDBFE)', alt: 'Laptop backpack' },
      badge: { label: 'Student demo pick', tone: 'good' },
      attributes: [
        { group: 'Product', label: 'Laptop size', value: 'Fits up to 15.6 inches' },
        { group: 'Product', label: 'Volume', value: '22 litres' },
        { group: 'Product', label: 'Weight', value: '0.8 kg' },
        { group: 'Product', label: 'Material', value: 'Water-resistant polyester (demo)' },
        { group: 'Support', label: 'Warranty', value: '2 years' }
      ],
      deal: null,
      status: 'available',
      tags: ['bags', 'laptop', 'student', 'remote-work', 'travel', 'nairobi'],
      listedAt: '2026-09-13',
      rating: { value: 4.4, count: 78 },
      highlights: ['Padded 15.6" laptop sleeve', '22-litre capacity', 'Water-resistant base']
    },
    {
      id: 'jacket-highland-rain-shell',
      name: 'Mistwall Rain Shell Jacket',
      type: 'product',
      category: 'fashion',
      subcategory: 'Outerwear',
      brand: 'Mistwall',
      shortDescription: 'Packable demo rain jacket with taped seams.',
      description:
        'A packable rain shell with taped seams and a 10,000 mm demo waterproof rating. Folds into its own pocket, weighs 410 g and comes in sizes S to XXL.',      price: { amount: 7500, currency: KES },
      referencePrice: null,
      location: { city: 'Eldoret', country: 'Kenya', format: 'local' },
      seller: { name: 'Mistwall Outfitters (demo)', type: 'Retailer', rating: 4.2, verified: false },
      image: { icon: '🧥', gradient: 'linear-gradient(135deg,#E0E7FF,#C7D2FE)', alt: 'Rain shell jacket' },
      badge: null,
      attributes: [
        { group: 'Product', label: 'Waterproof rating', value: '10,000 mm (demo)' },
        { group: 'Product', label: 'Material', value: 'Coated polyester with taped seams' },
        { group: 'Product', label: 'Packed size', value: 'Folds into its own pocket' },
        { group: 'Product', label: 'Weight', value: '410 g' },
        { group: 'Product', label: 'Sizes', value: 'S – XXL' },
        { group: 'Support', label: 'Warranty', value: '2 years' }
      ],
      deal: null,
      status: 'available',
      tags: ['clothing', 'outerwear', 'travel', 'rain', 'eldoret'],
      listedAt: '2026-08-11',
      rating: { value: 4.2, count: 34 },
      highlights: ['Taped seams', 'Packs into its own pocket', 'Light 410 g shell']
    },

    /* ===================================================== SERVICES (8) */
    {
      id: 'service-fibermax-fibre-300',
      name: 'FiberMax Home 300 — Fibre Plan',
      type: 'service',
      category: 'services',
      subcategory: 'Internet',
      brand: 'FiberMax',
      shortDescription: '300 Mbps home fibre plan with a router included and a demo contract term.',
      description:
        'A 300 Mbps download and 150 Mbps upload fibre plan with a router included and a 12-month demo contract. Support runs seven days a week and installation is booked within five days.',      price: { amount: 3400, unit: 'month', currency: KES },
      referencePrice: 4300,
      location: { city: 'Nationwide', country: 'Kenya', format: 'nationwide' },
      seller: { name: 'FiberMax (demo provider)', type: 'Provider', rating: 4.2, verified: true },
      image: { icon: '🛜', gradient: 'linear-gradient(135deg,#E0E7FF,#C7D2FE)', alt: 'Home fibre broadband' },
      badge: { label: 'Contract terms apply (demo)', tone: 'neutral' },
      attributes: [
        { group: 'Plan', label: 'Download', value: '300 Mbps' },
        { group: 'Plan', label: 'Upload', value: '150 Mbps' },
        { group: 'Plan', label: 'Contract', value: '12 months (demo)' },
        { group: 'Plan', label: 'Setup fee', value: 'KSh 0 in this demo' },
        { group: 'Coverage', label: 'Service area', value: 'Nairobi, Mombasa, Kisumu, Nakuru, Eldoret (demo)' },
        { group: 'Coverage', label: 'Availability', value: 'Installation booked within 5 days (demo)' },
        { group: 'Support', label: 'Support', value: 'Phone and WhatsApp, 7 days (demo)' }
      ],
      deal: {
        kind: 'introductory',
        headline: 'First three months at the demo introductory price',
        dealPrice: 2700,
        referencePrice: 3400,
        discountPercent: 21,
        validFrom: '2026-09-09',
        validTo: '2026-10-31',
        conditions: ['Demo condition: introductory price for the first 3 months', 'Demo condition: 12-month demo contract required']
      },
      status: 'available',
      tags: ['internet', 'broadband', 'remote-work', 'family', 'fast', 'online'],
      listedAt: '2026-09-09',
      rating: { value: 4.2, count: 189 },
      highlights: ['300 Mbps download', 'Router included (demo)', 'Five-day installation window']
    },
    {
      id: 'service-netlink-install-visit',
      name: 'MeshPoint Installation & Setup Visit',
      type: 'service',
      category: 'services',
      subcategory: 'Internet installation',
      brand: 'MeshPoint',
      shortDescription: 'Demo installation visit covering cabling, router setup and a speed check.',
      description:
        'An installation visit covering cabling, router setup, Wi-Fi naming and a speed check, taking about 90 minutes. Same-day or next-day appointments from Monday to Saturday.',      price: { amount: 2500, currency: KES },
      referencePrice: null,
      location: { city: 'Nairobi', country: 'Kenya', format: 'local' },
      seller: { name: 'MeshPoint Installations (demo)', type: 'Service provider', rating: 4.1, verified: true },
      image: { icon: '🔧', gradient: 'linear-gradient(135deg,#CCFBF1,#99F6E0)', alt: 'Internet installation service' },
      badge: null,
      attributes: [
        { group: 'Service', label: 'Included', value: 'Cable routing, router setup, Wi-Fi name and password, speed check' },
        { group: 'Service', label: 'Turnaround', value: 'Same day or next day (demo)' },
        { group: 'Service', label: 'Duration', value: '90 minutes typical' },
        { group: 'Coverage', label: 'Service area', value: 'Nairobi, Kiambu and Thika (demo)' },
        { group: 'Coverage', label: 'Availability', value: 'Monday to Saturday' },
        { group: 'Support', label: 'Materials', value: 'Basic cabling included (demo)' }
      ],
      deal: null,
      status: 'by-appointment',
      tags: ['internet', 'installation', 'nairobi', 'fast', 'remote-work'],
      listedAt: '2026-08-25',
      rating: { value: 4.1, count: 63 },
      highlights: ['Same or next day visit', 'Router setup included', 'Speed check after install']
    },
    {
      id: 'service-fixpoint-phone-repair',
      name: 'FixPoint Phone Screen Replacement',
      type: 'service',
      category: 'services',
      subcategory: 'Repairs',
      brand: null,
      shortDescription: 'Demo screen replacement service, priced by phone model with a 6-month warranty.',
      description:
        'Screen replacement for common phone models, including testing and cleaning, usually finished within two to four hours. Replaced parts carry a six-month demo warranty.',      price: { min: 3500, max: 24000, currency: KES },
      referencePrice: 4500,
      location: { city: 'Nairobi', country: 'Kenya', format: 'local' },
      seller: { name: 'FixPoint Repairs (demo)', type: 'Service provider', rating: 4.4, verified: true },
      image: { icon: '📱', gradient: 'linear-gradient(135deg,#F1F5F9,#E2E8F0)', alt: 'Phone repair service' },
      badge: { label: 'Quote by model', tone: 'neutral' },
      attributes: [
        { group: 'Service', label: 'Included', value: 'Screen replacement, testing, cleaning' },
        { group: 'Service', label: 'Turnaround', value: '2–4 hours for common demo models' },
        { group: 'Service', label: 'Warranty', value: '6 months on the replaced part (demo)' },
        { group: 'Coverage', label: 'Service area', value: 'Nairobi walk-in centre (demo)' },
        { group: 'Coverage', label: 'Availability', value: 'Monday to Saturday' },
        { group: 'Support', label: 'Price basis', value: 'Final price depends on phone model (demo)' }
      ],
      deal: {
        kind: 'fixed-price',
        headline: 'Demo starting price on common models',
        dealPrice: 3500,
        referencePrice: 4500,
        discountPercent: 22,
        validFrom: '2026-09-01',
        validTo: '2026-10-31',
        conditions: ['Demo condition: applies to common demo models only', 'Demo condition: parts availability is not real']
      },
      status: 'available',
      tags: ['repair', 'smartphone', 'fast', 'nairobi', 'student'],
      listedAt: '2026-08-20',
      rating: { value: 4.4, count: 97 },
      highlights: ['Two to four hour turnaround', 'Six-month demo warranty', 'Quote depends on model']
    },
    {
      id: 'service-techbench-laptop-repair',
      name: 'TechBench Laptop Diagnostics & Repair',
      type: 'service',
      category: 'services',
      subcategory: 'Repairs',
      brand: null,
      shortDescription: 'Demo diagnostics and repair service for laptops, quoted after inspection.',
      description:
        'Diagnostics first: the workshop inspects the machine, quotes the repair and only proceeds once you approve. Typical turnaround is 24 to 72 hours with a three-month warranty on repaired parts.',      price: { min: 1500, max: 18000, currency: KES },
      referencePrice: null,
      location: { city: 'Nairobi', country: 'Kenya', format: 'local' },
      seller: { name: 'TechBench (demo)', type: 'Service provider', rating: 4.3, verified: true },
      image: { icon: '🛠️', gradient: 'linear-gradient(135deg,#E2E8F0,#CBD5E1)', alt: 'Laptop repair service' },
      badge: { label: 'Diagnostics first', tone: 'neutral' },
      attributes: [
        { group: 'Service', label: 'Included', value: 'Diagnostics, quote, repair if approved' },
        { group: 'Service', label: 'Turnaround', value: '24–72 hours depending on parts (demo)' },
        { group: 'Service', label: 'Warranty', value: '3 months on repaired parts (demo)' },
        { group: 'Coverage', label: 'Service area', value: 'Nairobi, drop-off or courier (demo)' },
        { group: 'Coverage', label: 'Availability', value: 'Monday to Saturday' },
        { group: 'Support', label: 'Price basis', value: 'Quote after diagnostics (demo)' }
      ],
      deal: null,
      status: 'on-request',
      tags: ['repair', 'laptop', 'student', 'business', 'nairobi', 'remote-work'],
      listedAt: '2026-08-17',
      rating: { value: 4.3, count: 58 },
      highlights: ['Diagnostics before repair', 'Three-day typical turnaround', 'Courier option in Nairobi']
    },
    {
      id: 'service-sparklehome-deep-clean',
      name: 'SparkleHome Deep Cleaning',
      type: 'service',
      category: 'services',
      subcategory: 'Cleaning',
      brand: null,
      shortDescription: 'Demo home deep-cleaning package priced by house size.',
      description:
        'A full home deep clean covering the kitchen, bathrooms, floors, windows and dusting, with a team of two to four cleaners. Cleaning supplies are included and bookings are made two days ahead.',      price: { min: 4500, max: 14000, currency: KES },
      referencePrice: 9200,
      location: { city: 'Nairobi', country: 'Kenya', format: 'local' },
      seller: { name: 'SparkleHome Cleaning (demo)', type: 'Service provider', rating: 4.3, verified: true },
      image: { icon: '🧽', gradient: 'linear-gradient(135deg,#CCFBF1,#99F6E0)', alt: 'Home cleaning service' },
      badge: { label: 'Price by house size', tone: 'neutral' },
      attributes: [
        { group: 'Service', label: 'Package', value: 'Full home deep clean' },
        { group: 'Service', label: 'Included', value: 'Kitchen, bathrooms, floors, windows, dusting' },
        { group: 'Service', label: 'Team size', value: '2–4 cleaners (demo)' },
        { group: 'Service', label: 'Duration', value: '4–7 hours depending on size' },
        { group: 'Coverage', label: 'Service area', value: 'Nairobi, Kiambu and Machakos (demo)' },
        { group: 'Coverage', label: 'Availability', value: 'Book 2 days ahead (demo)' },
        { group: 'Support', label: 'Supplies', value: 'Cleaning supplies included (demo)' }
      ],
      deal: {
        kind: 'package',
        headline: 'Fixed demo price for a 3-bedroom home',
        dealPrice: 7500,
        referencePrice: 9200,
        discountPercent: 18,
        validFrom: '2026-09-14',
        validTo: '2026-11-14',
        conditions: ['Demo condition: applies to 3-bedroom homes', 'Demo condition: larger homes quoted separately']
      },
      status: 'by-appointment',
      tags: ['cleaning', 'home', 'family', 'nairobi', 'professional'],
      listedAt: '2026-09-08',
      rating: { value: 4.3, count: 112 },
      highlights: ['Supplies included', 'Team of two to four', 'Booking two days ahead']
    },
    {
      id: 'service-movemate-house-moving',
      name: 'MoveMate House Moving Service',
      type: 'service',
      category: 'services',
      subcategory: 'Moving',
      brand: null,
      shortDescription: 'Demo moving service with packing, transport and unloading options.',
      description:
        'A moving service with a truck, a crew of three and basic wrapping materials, with packing available as an add-on. Quoted on distance, volume and floor access.',      price: { min: 8000, max: 55000, currency: KES },
      referencePrice: null,
      location: { city: 'Nairobi', country: 'Kenya', format: 'local' },
      seller: { name: 'MoveMate Movers (demo)', type: 'Service provider', rating: 4.2, verified: true },
      image: { icon: '🚚', gradient: 'linear-gradient(135deg,#DBEAFE,#BFDBFE)', alt: 'House moving service' },
      badge: { label: 'Quote-based', tone: 'neutral' },
      attributes: [
        { group: 'Service', label: 'Package', value: 'Transport and loading, packing optional' },
        { group: 'Service', label: 'Included', value: 'Truck, crew of 3, basic wrapping materials' },
        { group: 'Service', label: 'Duration', value: 'Half day for a 2-bedroom home (demo estimate)' },
        { group: 'Coverage', label: 'Service area', value: 'Nairobi metro and upcountry routes (demo)' },
        { group: 'Coverage', label: 'Availability', value: 'Weekdays and Saturdays' },
        { group: 'Support', label: 'Price basis', value: 'Distance, volume and floor access (demo)' }
      ],
      deal: null,
      status: 'on-request',
      tags: ['moving', 'home', 'family', 'nairobi', 'professional'],
      listedAt: '2026-08-07',
      rating: { value: 4.2, count: 66 },
      highlights: ['Crew of three', 'Packing add-on available', 'Quote based on distance and volume']
    },
    {
      id: 'service-lightframe-photography',
      name: 'Lightframe Event Photography',
      type: 'service',
      category: 'services',
      subcategory: 'Photography',
      brand: null,
      shortDescription: 'Demo event photography package with edited digital delivery.',
      description:
        'Event photography with four or eight hours of coverage, colour editing and an online gallery delivered within ten working days. Booking at least two weeks ahead is recommended.',      price: { min: 18000, max: 65000, currency: KES },
      referencePrice: null,
      location: { city: 'Naivasha', country: 'Kenya', format: 'local' },
      seller: { name: 'Lightframe Studio (demo)', type: 'Service provider', rating: 4.5, verified: true },
      image: { icon: '📷', gradient: 'linear-gradient(135deg,#EDE9FE,#DDD6FE)', alt: 'Event photography service' },
      badge: { label: 'Package pricing', tone: 'neutral' },
      attributes: [
        { group: 'Service', label: 'Package', value: 'Half-day or full-day event coverage' },
        { group: 'Service', label: 'Included', value: 'Coverage, colour editing, online gallery' },
        { group: 'Service', label: 'Duration', value: '4 or 8 hours of coverage' },
        { group: 'Coverage', label: 'Service area', value: 'Naivasha and Nairobi (demo)' },
        { group: 'Coverage', label: 'Availability', value: 'Book at least 2 weeks ahead (demo)' },
        { group: 'Support', label: 'Delivery', value: 'Online gallery within 10 working days (demo)' },
        { group: 'Support', label: 'Travel', value: 'Travel beyond the demo area quoted separately' }
      ],
      deal: null,
      status: 'available',
      tags: ['photography', 'event', 'professional', 'naivasha', 'family'],
      listedAt: '2026-09-04',
      rating: { value: 4.5, count: 42 },
      highlights: ['Half-day or full-day coverage', 'Edited online gallery', 'Two-week booking notice']
    },
    {
      id: 'service-fittrack-personal-training',
      name: 'FitTrack Personal Training — 10 Sessions',
      type: 'service',
      category: 'services',
      subcategory: 'Fitness',
      brand: null,
      shortDescription: 'Demo personal training package with a plan review and progress check-ins.',
      description:
        'A ten-session personal training package in 60-minute sessions, including a plan review, two progress check-ins and a demo plan sheet. Early-morning and evening slots within the demo service area.',      price: { amount: 1500, unit: 'session', currency: KES },
      referencePrice: 18000,
      location: { city: 'Nairobi', country: 'Kenya', format: 'local' },
      seller: { name: 'FitTrack Coaching (demo)', type: 'Service provider', rating: 4.4, verified: false },
      image: { icon: '🏋️', gradient: 'linear-gradient(135deg,#FFE4E6,#FECDD3)', alt: 'Personal training service' },
      badge: { label: 'Package available', tone: 'neutral' },
      attributes: [
        { group: 'Service', label: 'Package', value: '10 sessions (demo)' },
        { group: 'Service', label: 'Session length', value: '60 minutes' },
        { group: 'Service', label: 'Included', value: 'Plan review, two progress check-ins, demo plan sheet' },
        { group: 'Coverage', label: 'Service area', value: 'Nairobi gyms and home visits (demo)' },
        { group: 'Coverage', label: 'Availability', value: 'Early mornings and evenings' },
        { group: 'Support', label: 'Price basis', value: 'Package price shown per session (demo)' }
      ],
      deal: {
        kind: 'package',
        headline: 'Package price per session when buying ten',
        dealPrice: 1500,
        referencePrice: 1800,
        discountPercent: 17,
        validFrom: '2026-09-16',
        validTo: '2026-11-16',
        conditions: ['Demo condition: package of ten sessions', 'Demo condition: sessions are demo content only']
      },
      status: 'available',
      tags: ['fitness', 'health', 'professional', 'nairobi', 'package'],
      listedAt: '2026-09-15',
      rating: { value: 4.4, count: 51 },
      highlights: ['Ten-session package', 'Two progress check-ins', 'Plan sheet included (demo)']
    }
  ];

  /* ---------------------------------------------------------------- guides */
  /* Outlines only — full articles are intentionally not written yet. */
  const guides = [
    {
      id: 'guide-compare-smartphones',
      title: 'How to compare smartphones',
      question: 'Which specifications actually change how a phone feels day to day?',
      category: 'technology',
      icon: '📱',
      summary: 'A short framework for reading display, battery, storage and camera specs without getting lost in numbers.',
      readTime: '6 min read',
      level: 'Beginner',
      covers: ['Battery vs screen size trade-offs', 'Storage and update support', 'When a mid-range phone is enough']
    },
    {
      id: 'guide-laptop-for-work',
      title: 'How to choose a laptop for work',
      question: 'How do I balance weight, battery, memory and price for my work?',
      category: 'technology',
      icon: '💻',
      summary: 'What to decide before comparing laptops, and which specifications rarely matter for everyday work.',
      readTime: '7 min read',
      level: 'Beginner',
      covers: ['Memory and storage minimums', 'Ports, repairability and warranty', 'When a tablet or desktop fits better']
    },
    {
      id: 'guide-used-phone-checks',
      title: 'What to check before buying a used phone',
      question: 'What should I verify before paying for a refurbished or second-hand phone?',
      category: 'technology',
      icon: '♻️',
      summary: 'Condition grades, battery health claims and the questions to ask about a refurbished device.',
      readTime: '5 min read',
      level: 'Beginner',
      covers: ['Condition grades and what they mean', 'Battery health and repair history', 'Warranty differences from new stock']
    },
    {
      id: 'guide-home-internet',
      title: 'How to choose a home internet package',
      question: 'How much speed does my household actually need, and what else is in the contract?',
      category: 'services',
      icon: '🛜',
      summary: 'Speeds are only one line in the contract. How to read contract length, fees and support terms.',
      readTime: '5 min read',
      level: 'Beginner',
      covers: ['Speed needed per household size', 'Contract length and exit costs', 'Installation and equipment fees']
    },
    {
      id: 'guide-wifi-router',
      title: 'What to look for in a Wi-Fi router',
      question: 'Which router specifications matter in a normal home or small office?',
      category: 'technology',
      icon: '📶',
      summary: 'Wi-Fi standard, bands, coverage and SIM support explained without the marketing language.',
      readTime: '5 min read',
      level: 'Beginner',
      covers: ['Wi-Fi 5 vs Wi-Fi 6 in practice', 'Bands, channels and coverage limits', 'When a portable or SIM router is better']
    },
    {
      id: 'guide-car-detailing',
      title: 'How to compare car detailing services',
      question: 'How do I tell two detailing packages apart when both say "full detail"?',
      category: 'automotive',
      icon: '🧼',
      summary: 'Package scope, materials, duration and mobile service — the parts that decide what you actually get.',
      readTime: '5 min read',
      level: 'Beginner',
      covers: ['What a full detail should include', 'Ceramic coating vs wax', 'Mobile or workshop service trade-offs']
    },
    {
      id: 'guide-office-chair',
      title: 'How to choose an office chair',
      question: 'Which adjustments matter if I sit for several hours a day?',
      category: 'home',
      icon: '💺',
      summary: 'Lumbar support, seat depth, armrests and warranty — what to test before committing.',
      readTime: '5 min read',
      level: 'Beginner',
      covers: ['Adjustability that actually helps', 'Materials and expected lifespan', 'Warranty and spare parts']
    },
    {
      id: 'guide-service-providers',
      title: 'How to compare service providers',
      question: 'What should I compare when the service is a person, not a product?',
      category: 'services',
      icon: '🛠️',
      summary: 'Scope, turnaround, service area, warranty on work and price basis — a reusable checklist.',
      readTime: '6 min read',
      level: 'Beginner',
      covers: ['Included vs excluded work', 'Turnaround and availability', 'Warranty and follow-up terms']
    },
    {
      id: 'guide-evaluate-a-deal',
      title: 'How to evaluate a deal',
      question: 'Is this discount claim actually a saving?',
      category: 'business',
      icon: '🏷️',
      summary: 'Understand what a reference price is measured against, and when an offer is not really a saving.',
      readTime: '4 min read',
      level: 'Beginner',
      covers: ['Reference price definitions', 'Time-limited vs permanent offers', 'Conditions that change the value']
    },
    {
      id: 'guide-questions-before-hiring',
      title: 'Questions to ask before hiring a service provider',
      question: 'Which questions should I ask before agreeing to a service?',
      category: 'services',
      icon: '❓',
      summary: 'A practical list of questions about scope, timing, extras and warranties you can ask any provider.',
      readTime: '4 min read',
      level: 'Beginner',
      covers: ['Scope and exclusions', 'Timing and delays', 'Payment, warranty and follow-up']
    }
  ];

  /* ---------------------------------------------------------------- export */
  window.PICKVANTA_DATA = {
    version: 'step4-demo-2.0.0',
    demoNotice: 'Demonstration catalogue only — every listing, price, seller, provider and offer here is invented.',
    types: types,
    categories: categories,
    statuses: statuses,
    priceBands: priceBands,
    sortOptions: sortOptions,
    locationOptions: locationOptions,
    /* Used by the Compare page when the visitor has not picked anything yet. */
    defaultCompareIds: ['headphones-quietmax-700', 'headphones-basswave-700', 'headphones-airflow-studio-pro'],
    /* Curated homepage selection — deliberately spread across categories and
       across budget / mid-range / premium so the homepage never becomes a
       catalogue dump. The full catalogue lives in Discover. */
    /* One record per category, mixing products and services and spanning the
       budget / mid-range / premium price bands. */
    homeFeaturedIds: [
      'laptop-slatebook-air-14',
      'chair-ergoform-mesh',
      'detailing-shinelab-full-detail',
      'luggage-alpine-cabin-22',
      'service-studionine-web-design',
      'service-safedrive-driving-lessons',
      'bag-urbansling-laptop-backpack',
      'service-fibermax-fibre-300'
    ],
    homeDealIds: ['headphones-quietmax-700', 'service-sparklehome-deep-clean', 'tyre-roadgrip-195-65'],
    homeGuideIds: ['guide-compare-smartphones', 'guide-service-providers', 'guide-evaluate-a-deal'],
    items: items,
    guides: guides
  };
})();
