/* ==========================================================================
   PickVanta — demo catalogue (js/data.js)
   --------------------------------------------------------------------------
   DEMONSTRATION DATA ONLY. Every listing, price, seller, provider and offer in
   this file is invented for the demo build. Nothing here is real inventory,
   real contact information or a real business.

   This file is the *data source*, not the interface: pages read records only
   through the domain model (js/domain.js) and the data-access layer
   (js/store.js). Swapping this file for an API response is the intended path.

   Canonical shape (see js/domain.js for the full model and validators):

     taxonomy    [{ id, slug, label, icon, blurb, subcategories: [{ id, label }] }]
                 — the single source of truth for category and subcategory names
     locations   [{ id, label, city, county, country, format }]
     sellers     [{ id, name, slug, type, description, location, contact,
                    verificationStatus, status }] — references only, no accounts
     listings    [{ id, type: 'product'|'service', name, slug, shortDescription,
                    description, brand, category, subcategory, tags, highlights,
                    images: [{ id, src, alt, icon, gradient, position }],
                    price: { amount|min+max, currency, priceType },
                    referencePrice, location: { country, county, city, area,
                    serviceArea, format }, availability, sellerId,
                    specifications: [{ label, value, group }], status,
                    createdAt, updatedAt, offerId }]
     offers      [{ id, listingId, title, description, kind, originalPrice,
                    offerPrice, discountPercent, currency, startsAt, endsAt,
                    availability, sellerId, status, conditions }]
     guides      [{ id, title, slug, category, tags, summary,
                    sections: [{ id, title, body }], relatedListingIds, status }]

   Invariants kept by this file (checked by js/domain.js validators):
     • `type` is always stated, never inferred from other fields;
     • money is structured (amount + currency) — no formatted "KSh …" strings;
     • `status` is the lifecycle (draft/published/archived); `availability` is
       what the listing says right now (available/limited/…);
     • an offer always references its listing through `listingId`, and the
       listing points back with `offerId` — an offer is never its own product;
     • no ratings, reviews, sales counts, popularity or verdict fields exist.
   ========================================================================== */
window.PICKVANTA_DATA = (function () {
  'use strict';

  const version = "step7-demo-4.0.0";
  const demoNotice = "Demonstration catalogue only — every listing, price, seller, provider and offer here is invented.";

  /* Category → subcategory taxonomy. Subcategory ids are what records store. */
  const taxonomy = [
    {
      "id": "technology",
      "slug": "technology",
      "label": "Technology",
      "icon": "💻",
      "blurb": "Phones, laptops, audio, networking",
      "position": 0,
      "subcategories": [
        {
          "id": "accessories",
          "slug": "accessories",
          "label": "Accessories",
          "category": "technology",
          "position": 0
        },
        {
          "id": "audio",
          "slug": "audio",
          "label": "Audio",
          "category": "technology",
          "position": 1
        },
        {
          "id": "laptops",
          "slug": "laptops",
          "label": "Laptops",
          "category": "technology",
          "position": 2
        },
        {
          "id": "monitors",
          "slug": "monitors",
          "label": "Monitors",
          "category": "technology",
          "position": 3
        },
        {
          "id": "networking",
          "slug": "networking",
          "label": "Networking",
          "category": "technology",
          "position": 4
        },
        {
          "id": "smartphones",
          "slug": "smartphones",
          "label": "Smartphones",
          "category": "technology",
          "position": 5
        },
        {
          "id": "tablets",
          "slug": "tablets",
          "label": "Tablets",
          "category": "technology",
          "position": 6
        },
        {
          "id": "wearables",
          "slug": "wearables",
          "label": "Wearables",
          "category": "technology",
          "position": 7
        }
      ]
    },
    {
      "id": "home",
      "slug": "home",
      "label": "Home",
      "icon": "🏠",
      "blurb": "Furniture, appliances, lighting, storage",
      "position": 1,
      "subcategories": [
        {
          "id": "appliances",
          "slug": "appliances",
          "label": "Appliances",
          "category": "home",
          "position": 0
        },
        {
          "id": "furniture",
          "slug": "furniture",
          "label": "Furniture",
          "category": "home",
          "position": 1
        },
        {
          "id": "lighting",
          "slug": "lighting",
          "label": "Lighting",
          "category": "home",
          "position": 2
        },
        {
          "id": "storage",
          "slug": "storage",
          "label": "Storage",
          "category": "home",
          "position": 3
        }
      ]
    },
    {
      "id": "automotive",
      "slug": "automotive",
      "label": "Automotive",
      "icon": "🚗",
      "blurb": "Tyres, batteries, electronics, detailing",
      "position": 2,
      "subcategories": [
        {
          "id": "batteries",
          "slug": "batteries",
          "label": "Batteries",
          "category": "automotive",
          "position": 0
        },
        {
          "id": "detailing",
          "slug": "detailing",
          "label": "Detailing",
          "category": "automotive",
          "position": 1
        },
        {
          "id": "electronics",
          "slug": "electronics",
          "label": "Electronics",
          "category": "automotive",
          "position": 2
        },
        {
          "id": "tyres",
          "slug": "tyres",
          "label": "Tyres",
          "category": "automotive",
          "position": 3
        }
      ]
    },
    {
      "id": "travel",
      "slug": "travel",
      "label": "Travel",
      "icon": "✈️",
      "blurb": "Luggage, travel gear, stays, planning",
      "position": 3,
      "subcategories": [
        {
          "id": "luggage",
          "slug": "luggage",
          "label": "Luggage",
          "category": "travel",
          "position": 0
        },
        {
          "id": "stays",
          "slug": "stays",
          "label": "Stays",
          "category": "travel",
          "position": 1
        },
        {
          "id": "trip-planning",
          "slug": "trip-planning",
          "label": "Trip planning",
          "category": "travel",
          "position": 2
        }
      ]
    },
    {
      "id": "business",
      "slug": "business",
      "label": "Business",
      "icon": "💼",
      "blurb": "Software, design, registration support",
      "position": 4,
      "subcategories": [
        {
          "id": "business-registration",
          "slug": "business-registration",
          "label": "Business registration",
          "category": "business",
          "position": 0
        },
        {
          "id": "software",
          "slug": "software",
          "label": "Software",
          "category": "business",
          "position": 1
        },
        {
          "id": "web-design",
          "slug": "web-design",
          "label": "Web design",
          "category": "business",
          "position": 2
        }
      ]
    },
    {
      "id": "education",
      "slug": "education",
      "label": "Education",
      "icon": "🎓",
      "blurb": "Courses, certificates, tutoring, driving",
      "position": 5,
      "subcategories": [
        {
          "id": "certificates",
          "slug": "certificates",
          "label": "Certificates",
          "category": "education",
          "position": 0
        },
        {
          "id": "driving",
          "slug": "driving",
          "label": "Driving",
          "category": "education",
          "position": 1
        },
        {
          "id": "languages",
          "slug": "languages",
          "label": "Languages",
          "category": "education",
          "position": 2
        },
        {
          "id": "tutoring",
          "slug": "tutoring",
          "label": "Tutoring",
          "category": "education",
          "position": 3
        }
      ]
    },
    {
      "id": "fashion",
      "slug": "fashion",
      "label": "Fashion",
      "icon": "👕",
      "blurb": "Footwear, clothing, bags, outerwear",
      "position": 6,
      "subcategories": [
        {
          "id": "bags",
          "slug": "bags",
          "label": "Bags",
          "category": "fashion",
          "position": 0
        },
        {
          "id": "clothing",
          "slug": "clothing",
          "label": "Clothing",
          "category": "fashion",
          "position": 1
        },
        {
          "id": "footwear",
          "slug": "footwear",
          "label": "Footwear",
          "category": "fashion",
          "position": 2
        },
        {
          "id": "outerwear",
          "slug": "outerwear",
          "label": "Outerwear",
          "category": "fashion",
          "position": 3
        }
      ]
    },
    {
      "id": "services",
      "slug": "services",
      "label": "Services",
      "icon": "🛠️",
      "blurb": "Internet, repairs, cleaning, local pros",
      "position": 7,
      "subcategories": [
        {
          "id": "cleaning",
          "slug": "cleaning",
          "label": "Cleaning",
          "category": "services",
          "position": 0
        },
        {
          "id": "fitness",
          "slug": "fitness",
          "label": "Fitness",
          "category": "services",
          "position": 1
        },
        {
          "id": "internet",
          "slug": "internet",
          "label": "Internet",
          "category": "services",
          "position": 2
        },
        {
          "id": "internet-installation",
          "slug": "internet-installation",
          "label": "Internet installation",
          "category": "services",
          "position": 3
        },
        {
          "id": "moving",
          "slug": "moving",
          "label": "Moving",
          "category": "services",
          "position": 4
        },
        {
          "id": "photography",
          "slug": "photography",
          "label": "Photography",
          "category": "services",
          "position": 5
        },
        {
          "id": "repairs",
          "slug": "repairs",
          "label": "Repairs",
          "category": "services",
          "position": 6
        }
      ]
    }
  ];

  /* Places used by the demo catalogue (Kenya-focused). */
  const locations = [
    {
      "id": "online",
      "label": "Online / nationwide",
      "city": "",
      "county": "",
      "country": "Kenya",
      "format": "online"
    },
    {
      "id": "local",
      "label": "Anywhere in Kenya",
      "city": "",
      "county": "",
      "country": "Kenya",
      "format": "local"
    },
    {
      "id": "eldoret",
      "label": "Eldoret",
      "city": "Eldoret",
      "county": "Uasin Gishu County",
      "country": "Kenya",
      "format": "local"
    },
    {
      "id": "kiambu",
      "label": "Kiambu",
      "city": "Kiambu",
      "county": "Kiambu County",
      "country": "Kenya",
      "format": "local"
    },
    {
      "id": "kisumu",
      "label": "Kisumu",
      "city": "Kisumu",
      "county": "Kisumu County",
      "country": "Kenya",
      "format": "local"
    },
    {
      "id": "machakos",
      "label": "Machakos",
      "city": "Machakos",
      "county": "Machakos County",
      "country": "Kenya",
      "format": "local"
    },
    {
      "id": "mombasa",
      "label": "Mombasa",
      "city": "Mombasa",
      "county": "Mombasa County",
      "country": "Kenya",
      "format": "local"
    },
    {
      "id": "nairobi",
      "label": "Nairobi",
      "city": "Nairobi",
      "county": "Nairobi County",
      "country": "Kenya",
      "format": "local"
    },
    {
      "id": "naivasha",
      "label": "Naivasha",
      "city": "Naivasha",
      "county": "Nakuru County",
      "country": "Kenya",
      "format": "local"
    },
    {
      "id": "nakuru",
      "label": "Nakuru",
      "city": "Nakuru",
      "county": "Nakuru County",
      "country": "Kenya",
      "format": "local"
    },
    {
      "id": "thika",
      "label": "Thika",
      "city": "Thika",
      "county": "Kiambu County",
      "country": "Kenya",
      "format": "local"
    }
  ];

  /* Sellers/providers. References only — no accounts, no contact details. */
  const sellers = [
    {
      "id": "seller-zenith-store-nairobi",
      "name": "Zenith Store Nairobi",
      "slug": "zenith-store-nairobi",
      "type": "brand-store",
      "description": "",
      "location": {
        "country": "Kenya",
        "county": "Nairobi County",
        "city": "Nairobi",
        "area": "",
        "serviceArea": [],
        "format": "local"
      },
      "contact": {
        "email": null,
        "phone": null,
        "website": null
      },
      "verificationStatus": "demo-verified",
      "status": "published"
    },
    {
      "id": "seller-coast-mobile-hub",
      "name": "Coast Mobile Hub",
      "slug": "coast-mobile-hub",
      "type": "retailer",
      "description": "",
      "location": {
        "country": "Kenya",
        "county": "Mombasa County",
        "city": "Mombasa",
        "area": "",
        "serviceArea": [],
        "format": "local"
      },
      "contact": {
        "email": null,
        "phone": null,
        "website": null
      },
      "verificationStatus": "demo-verified",
      "status": "published"
    },
    {
      "id": "seller-rift-electronics",
      "name": "Rift Electronics",
      "slug": "rift-electronics",
      "type": "retailer",
      "description": "",
      "location": {
        "country": "Kenya",
        "county": "Nakuru County",
        "city": "Nakuru",
        "area": "",
        "serviceArea": [],
        "format": "local"
      },
      "contact": {
        "email": null,
        "phone": null,
        "website": null
      },
      "verificationStatus": "unverified",
      "status": "published"
    },
    {
      "id": "seller-refurbpoint-nairobi",
      "name": "RefurbPoint Nairobi",
      "slug": "refurbpoint-nairobi",
      "type": "retailer",
      "description": "",
      "location": {
        "country": "Kenya",
        "county": "Nairobi County",
        "city": "Nairobi",
        "area": "",
        "serviceArea": [],
        "format": "local"
      },
      "contact": {
        "email": null,
        "phone": null,
        "website": null
      },
      "verificationStatus": "unverified",
      "status": "published"
    },
    {
      "id": "seller-slatepoint-store",
      "name": "SlatePoint Store",
      "slug": "slatepoint-store",
      "type": "brand-store",
      "description": "",
      "location": {
        "country": "Kenya",
        "county": "Nairobi County",
        "city": "Nairobi",
        "area": "",
        "serviceArea": [],
        "format": "local"
      },
      "contact": {
        "email": null,
        "phone": null,
        "website": null
      },
      "verificationStatus": "demo-verified",
      "status": "published"
    },
    {
      "id": "seller-highlands-computers",
      "name": "Highlands Computers",
      "slug": "highlands-computers",
      "type": "retailer",
      "description": "",
      "location": {
        "country": "Kenya",
        "county": "Uasin Gishu County",
        "city": "Eldoret",
        "area": "",
        "serviceArea": [],
        "format": "local"
      },
      "contact": {
        "email": null,
        "phone": null,
        "website": null
      },
      "verificationStatus": "demo-verified",
      "status": "published"
    },
    {
      "id": "seller-screenworks-nairobi",
      "name": "ScreenWorks Nairobi",
      "slug": "screenworks-nairobi",
      "type": "retailer",
      "description": "",
      "location": {
        "country": "Kenya",
        "county": "Nairobi County",
        "city": "Nairobi",
        "area": "",
        "serviceArea": [],
        "format": "local"
      },
      "contact": {
        "email": null,
        "phone": null,
        "website": null
      },
      "verificationStatus": "demo-verified",
      "status": "published"
    },
    {
      "id": "seller-audionest-online",
      "name": "AudioNest Online",
      "slug": "audionest-online",
      "type": "retailer",
      "description": "",
      "location": {
        "country": "Kenya",
        "county": "",
        "city": "",
        "area": "",
        "serviceArea": [],
        "format": "online"
      },
      "contact": {
        "email": null,
        "phone": null,
        "website": null
      },
      "verificationStatus": "demo-verified",
      "status": "published"
    },
    {
      "id": "seller-soundcart-kenya",
      "name": "SoundCart Kenya",
      "slug": "soundcart-kenya",
      "type": "retailer",
      "description": "",
      "location": {
        "country": "Kenya",
        "county": "",
        "city": "",
        "area": "",
        "serviceArea": [],
        "format": "online"
      },
      "contact": {
        "email": null,
        "phone": null,
        "website": null
      },
      "verificationStatus": "demo-verified",
      "status": "published"
    },
    {
      "id": "seller-airflow-direct",
      "name": "AirFlow Direct",
      "slug": "airflow-direct",
      "type": "brand-store",
      "description": "",
      "location": {
        "country": "Kenya",
        "county": "",
        "city": "",
        "area": "",
        "serviceArea": [],
        "format": "online"
      },
      "contact": {
        "email": null,
        "phone": null,
        "website": null
      },
      "verificationStatus": "demo-verified",
      "status": "published"
    },
    {
      "id": "seller-fibermax-store",
      "name": "FiberMax Store",
      "slug": "fibermax-store",
      "type": "provider",
      "description": "",
      "location": {
        "country": "Kenya",
        "county": "",
        "city": "",
        "area": "",
        "serviceArea": [],
        "format": "nationwide"
      },
      "contact": {
        "email": null,
        "phone": null,
        "website": null
      },
      "verificationStatus": "demo-verified",
      "status": "published"
    },
    {
      "id": "seller-beatline-direct",
      "name": "Beatline Direct",
      "slug": "beatline-direct",
      "type": "brand-store",
      "description": "",
      "location": {
        "country": "Kenya",
        "county": "Nairobi County",
        "city": "Nairobi",
        "area": "",
        "serviceArea": [],
        "format": "local"
      },
      "contact": {
        "email": null,
        "phone": null,
        "website": null
      },
      "verificationStatus": "demo-verified",
      "status": "published"
    },
    {
      "id": "seller-deskkit-online",
      "name": "DeskKit Online",
      "slug": "deskkit-online",
      "type": "retailer",
      "description": "",
      "location": {
        "country": "Kenya",
        "county": "",
        "city": "",
        "area": "",
        "serviceArea": [],
        "format": "online"
      },
      "contact": {
        "email": null,
        "phone": null,
        "website": null
      },
      "verificationStatus": "demo-verified",
      "status": "published"
    },
    {
      "id": "seller-homenest-nairobi",
      "name": "HomeNest Nairobi",
      "slug": "homenest-nairobi",
      "type": "retailer",
      "description": "",
      "location": {
        "country": "Kenya",
        "county": "Nairobi County",
        "city": "Nairobi",
        "area": "",
        "serviceArea": [],
        "format": "local"
      },
      "contact": {
        "email": null,
        "phone": null,
        "website": null
      },
      "verificationStatus": "demo-verified",
      "status": "published"
    },
    {
      "id": "seller-lakeview-furnishings",
      "name": "Lakeview Furnishings",
      "slug": "lakeview-furnishings",
      "type": "retailer",
      "description": "",
      "location": {
        "country": "Kenya",
        "county": "Kisumu County",
        "city": "Kisumu",
        "area": "",
        "serviceArea": [],
        "format": "local"
      },
      "contact": {
        "email": null,
        "phone": null,
        "website": null
      },
      "verificationStatus": "unverified",
      "status": "published"
    },
    {
      "id": "seller-thika-home-appliances",
      "name": "Thika Home Appliances",
      "slug": "thika-home-appliances",
      "type": "retailer",
      "description": "",
      "location": {
        "country": "Kenya",
        "county": "Kiambu County",
        "city": "Thika",
        "area": "",
        "serviceArea": [],
        "format": "local"
      },
      "contact": {
        "email": null,
        "phone": null,
        "website": null
      },
      "verificationStatus": "demo-verified",
      "status": "published"
    },
    {
      "id": "seller-machakos-power-supplies",
      "name": "Machakos Power Supplies",
      "slug": "machakos-power-supplies",
      "type": "retailer",
      "description": "",
      "location": {
        "country": "Kenya",
        "county": "Machakos County",
        "city": "Machakos",
        "area": "",
        "serviceArea": [],
        "format": "local"
      },
      "contact": {
        "email": null,
        "phone": null,
        "website": null
      },
      "verificationStatus": "unverified",
      "status": "published"
    },
    {
      "id": "seller-roadgrip-tyre-centre",
      "name": "RoadGrip Tyre Centre",
      "slug": "roadgrip-tyre-centre",
      "type": "retailer",
      "description": "",
      "location": {
        "country": "Kenya",
        "county": "Nairobi County",
        "city": "Nairobi",
        "area": "",
        "serviceArea": [],
        "format": "local"
      },
      "contact": {
        "email": null,
        "phone": null,
        "website": null
      },
      "verificationStatus": "demo-verified",
      "status": "published"
    },
    {
      "id": "seller-rift-auto-parts",
      "name": "Rift Auto Parts",
      "slug": "rift-auto-parts",
      "type": "retailer",
      "description": "",
      "location": {
        "country": "Kenya",
        "county": "Nakuru County",
        "city": "Nakuru",
        "area": "",
        "serviceArea": [],
        "format": "local"
      },
      "contact": {
        "email": null,
        "phone": null,
        "website": null
      },
      "verificationStatus": "demo-verified",
      "status": "published"
    },
    {
      "id": "seller-lakeview-auto-accessories",
      "name": "Lakeview Auto Accessories",
      "slug": "lakeview-auto-accessories",
      "type": "retailer",
      "description": "",
      "location": {
        "country": "Kenya",
        "county": "Kisumu County",
        "city": "Kisumu",
        "area": "",
        "serviceArea": [],
        "format": "local"
      },
      "contact": {
        "email": null,
        "phone": null,
        "website": null
      },
      "verificationStatus": "unverified",
      "status": "published"
    },
    {
      "id": "seller-shinelab-detailing-demo",
      "name": "ShineLab Detailing (demo)",
      "slug": "shinelab-detailing-demo",
      "type": "service-provider",
      "description": "",
      "location": {
        "country": "Kenya",
        "county": "Nairobi County",
        "city": "Nairobi",
        "area": "",
        "serviceArea": [
          "Nairobi",
          "Kiambu"
        ],
        "format": "local"
      },
      "contact": {
        "email": null,
        "phone": null,
        "website": null
      },
      "verificationStatus": "demo-verified",
      "status": "published"
    },
    {
      "id": "seller-gleamworks-auto-care-demo",
      "name": "GleamWorks Auto Care (demo)",
      "slug": "gleamworks-auto-care-demo",
      "type": "service-provider",
      "description": "",
      "location": {
        "country": "Kenya",
        "county": "Kiambu County",
        "city": "Kiambu",
        "area": "",
        "serviceArea": [
          "Nairobi",
          "Kiambu"
        ],
        "format": "local"
      },
      "contact": {
        "email": null,
        "phone": null,
        "website": null
      },
      "verificationStatus": "demo-verified",
      "status": "published"
    },
    {
      "id": "seller-roamkit-co-demo",
      "name": "Roamkit & Co (demo)",
      "slug": "roamkit-co-demo",
      "type": "retailer",
      "description": "",
      "location": {
        "country": "Kenya",
        "county": "",
        "city": "",
        "area": "",
        "serviceArea": [],
        "format": "online"
      },
      "contact": {
        "email": null,
        "phone": null,
        "website": null
      },
      "verificationStatus": "demo-verified",
      "status": "published"
    },
    {
      "id": "seller-sunrise-stays-demo-host",
      "name": "Sunrise Stays (demo host)",
      "slug": "sunrise-stays-demo-host",
      "type": "host",
      "description": "",
      "location": {
        "country": "Kenya",
        "county": "Mombasa County",
        "city": "Mombasa",
        "area": "",
        "serviceArea": [
          "Diani"
        ],
        "format": "local"
      },
      "contact": {
        "email": null,
        "phone": null,
        "website": null
      },
      "verificationStatus": "demo-verified",
      "status": "published"
    },
    {
      "id": "seller-safariline-travel-planning-demo",
      "name": "Safariline Travel Planning (demo)",
      "slug": "safariline-travel-planning-demo",
      "type": "service-provider",
      "description": "",
      "location": {
        "country": "Kenya",
        "county": "",
        "city": "",
        "area": "",
        "serviceArea": [],
        "format": "online"
      },
      "contact": {
        "email": null,
        "phone": null,
        "website": null
      },
      "verificationStatus": "demo-verified",
      "status": "published"
    },
    {
      "id": "seller-ledgerlite-demo-provider",
      "name": "LedgerLite (demo provider)",
      "slug": "ledgerlite-demo-provider",
      "type": "provider",
      "description": "",
      "location": {
        "country": "Kenya",
        "county": "",
        "city": "",
        "area": "",
        "serviceArea": [],
        "format": "online"
      },
      "contact": {
        "email": null,
        "phone": null,
        "website": null
      },
      "verificationStatus": "unverified",
      "status": "published"
    },
    {
      "id": "seller-nimbuscloud-demo-provider",
      "name": "NimbusCloud (demo provider)",
      "slug": "nimbuscloud-demo-provider",
      "type": "provider",
      "description": "",
      "location": {
        "country": "Kenya",
        "county": "",
        "city": "",
        "area": "",
        "serviceArea": [],
        "format": "online"
      },
      "contact": {
        "email": null,
        "phone": null,
        "website": null
      },
      "verificationStatus": "demo-verified",
      "status": "published"
    },
    {
      "id": "seller-studionine-design-demo",
      "name": "StudioNine Design (demo)",
      "slug": "studionine-design-demo",
      "type": "service-provider",
      "description": "",
      "location": {
        "country": "Kenya",
        "county": "Nairobi County",
        "city": "Nairobi",
        "area": "",
        "serviceArea": [],
        "format": "local"
      },
      "contact": {
        "email": null,
        "phone": null,
        "website": null
      },
      "verificationStatus": "demo-verified",
      "status": "published"
    },
    {
      "id": "seller-bizreg-assist-demo",
      "name": "BizReg Assist (demo)",
      "slug": "bizreg-assist-demo",
      "type": "service-provider",
      "description": "",
      "location": {
        "country": "Kenya",
        "county": "",
        "city": "",
        "area": "",
        "serviceArea": [],
        "format": "nationwide"
      },
      "contact": {
        "email": null,
        "phone": null,
        "website": null
      },
      "verificationStatus": "unverified",
      "status": "published"
    },
    {
      "id": "seller-lingua-academy-demo",
      "name": "Lingua Academy (demo)",
      "slug": "lingua-academy-demo",
      "type": "provider",
      "description": "",
      "location": {
        "country": "Kenya",
        "county": "",
        "city": "",
        "area": "",
        "serviceArea": [],
        "format": "online"
      },
      "contact": {
        "email": null,
        "phone": null,
        "website": null
      },
      "verificationStatus": "demo-verified",
      "status": "published"
    },
    {
      "id": "seller-northline-learning-demo",
      "name": "Northline Learning (demo)",
      "slug": "northline-learning-demo",
      "type": "provider",
      "description": "",
      "location": {
        "country": "Kenya",
        "county": "",
        "city": "",
        "area": "",
        "serviceArea": [],
        "format": "online"
      },
      "contact": {
        "email": null,
        "phone": null,
        "website": null
      },
      "verificationStatus": "demo-verified",
      "status": "published"
    },
    {
      "id": "seller-mindpath-tutors-demo",
      "name": "MindPath Tutors (demo)",
      "slug": "mindpath-tutors-demo",
      "type": "service-provider",
      "description": "",
      "location": {
        "country": "Kenya",
        "county": "Nairobi County",
        "city": "Nairobi",
        "area": "",
        "serviceArea": [
          "Nairobi"
        ],
        "format": "local"
      },
      "contact": {
        "email": null,
        "phone": null,
        "website": null
      },
      "verificationStatus": "unverified",
      "status": "published"
    },
    {
      "id": "seller-safedrive-school-demo",
      "name": "SafeDrive School (demo)",
      "slug": "safedrive-school-demo",
      "type": "service-provider",
      "description": "",
      "location": {
        "country": "Kenya",
        "county": "Kisumu County",
        "city": "Kisumu",
        "area": "",
        "serviceArea": [
          "Kisumu"
        ],
        "format": "local"
      },
      "contact": {
        "email": null,
        "phone": null,
        "website": null
      },
      "verificationStatus": "demo-verified",
      "status": "published"
    },
    {
      "id": "seller-stride-house-demo",
      "name": "Stride House (demo)",
      "slug": "stride-house-demo",
      "type": "retailer",
      "description": "",
      "location": {
        "country": "Kenya",
        "county": "",
        "city": "",
        "area": "",
        "serviceArea": [],
        "format": "online"
      },
      "contact": {
        "email": null,
        "phone": null,
        "website": null
      },
      "verificationStatus": "unverified",
      "status": "published"
    },
    {
      "id": "seller-coastline-demo-brand-store",
      "name": "Coastline (demo brand store)",
      "slug": "coastline-demo-brand-store",
      "type": "brand-store",
      "description": "",
      "location": {
        "country": "Kenya",
        "county": "",
        "city": "",
        "area": "",
        "serviceArea": [],
        "format": "online"
      },
      "contact": {
        "email": null,
        "phone": null,
        "website": null
      },
      "verificationStatus": "demo-verified",
      "status": "published"
    },
    {
      "id": "seller-urbansling-demo-brand-store",
      "name": "UrbanSling (demo brand store)",
      "slug": "urbansling-demo-brand-store",
      "type": "brand-store",
      "description": "",
      "location": {
        "country": "Kenya",
        "county": "Nairobi County",
        "city": "Nairobi",
        "area": "",
        "serviceArea": [],
        "format": "local"
      },
      "contact": {
        "email": null,
        "phone": null,
        "website": null
      },
      "verificationStatus": "demo-verified",
      "status": "published"
    },
    {
      "id": "seller-mistwall-outfitters-demo",
      "name": "Mistwall Outfitters (demo)",
      "slug": "mistwall-outfitters-demo",
      "type": "retailer",
      "description": "",
      "location": {
        "country": "Kenya",
        "county": "Uasin Gishu County",
        "city": "Eldoret",
        "area": "",
        "serviceArea": [],
        "format": "local"
      },
      "contact": {
        "email": null,
        "phone": null,
        "website": null
      },
      "verificationStatus": "unverified",
      "status": "published"
    },
    {
      "id": "seller-fibermax-demo-provider",
      "name": "FiberMax (demo provider)",
      "slug": "fibermax-demo-provider",
      "type": "provider",
      "description": "",
      "location": {
        "country": "Kenya",
        "county": "",
        "city": "",
        "area": "",
        "serviceArea": [],
        "format": "nationwide"
      },
      "contact": {
        "email": null,
        "phone": null,
        "website": null
      },
      "verificationStatus": "demo-verified",
      "status": "published"
    },
    {
      "id": "seller-meshpoint-installations-demo",
      "name": "MeshPoint Installations (demo)",
      "slug": "meshpoint-installations-demo",
      "type": "service-provider",
      "description": "",
      "location": {
        "country": "Kenya",
        "county": "Nairobi County",
        "city": "Nairobi",
        "area": "",
        "serviceArea": [
          "Nairobi",
          "Thika",
          "Kiambu"
        ],
        "format": "local"
      },
      "contact": {
        "email": null,
        "phone": null,
        "website": null
      },
      "verificationStatus": "demo-verified",
      "status": "published"
    },
    {
      "id": "seller-fixpoint-repairs-demo",
      "name": "FixPoint Repairs (demo)",
      "slug": "fixpoint-repairs-demo",
      "type": "service-provider",
      "description": "",
      "location": {
        "country": "Kenya",
        "county": "Nairobi County",
        "city": "Nairobi",
        "area": "",
        "serviceArea": [
          "Nairobi"
        ],
        "format": "local"
      },
      "contact": {
        "email": null,
        "phone": null,
        "website": null
      },
      "verificationStatus": "demo-verified",
      "status": "published"
    },
    {
      "id": "seller-techbench-demo",
      "name": "TechBench (demo)",
      "slug": "techbench-demo",
      "type": "service-provider",
      "description": "",
      "location": {
        "country": "Kenya",
        "county": "Nairobi County",
        "city": "Nairobi",
        "area": "",
        "serviceArea": [
          "Nairobi"
        ],
        "format": "local"
      },
      "contact": {
        "email": null,
        "phone": null,
        "website": null
      },
      "verificationStatus": "demo-verified",
      "status": "published"
    },
    {
      "id": "seller-sparklehome-cleaning-demo",
      "name": "SparkleHome Cleaning (demo)",
      "slug": "sparklehome-cleaning-demo",
      "type": "service-provider",
      "description": "",
      "location": {
        "country": "Kenya",
        "county": "Nairobi County",
        "city": "Nairobi",
        "area": "",
        "serviceArea": [
          "Nairobi",
          "Kiambu",
          "Machakos"
        ],
        "format": "local"
      },
      "contact": {
        "email": null,
        "phone": null,
        "website": null
      },
      "verificationStatus": "demo-verified",
      "status": "published"
    },
    {
      "id": "seller-movemate-movers-demo",
      "name": "MoveMate Movers (demo)",
      "slug": "movemate-movers-demo",
      "type": "service-provider",
      "description": "",
      "location": {
        "country": "Kenya",
        "county": "Nairobi County",
        "city": "Nairobi",
        "area": "",
        "serviceArea": [
          "Nairobi"
        ],
        "format": "local"
      },
      "contact": {
        "email": null,
        "phone": null,
        "website": null
      },
      "verificationStatus": "demo-verified",
      "status": "published"
    },
    {
      "id": "seller-lightframe-studio-demo",
      "name": "Lightframe Studio (demo)",
      "slug": "lightframe-studio-demo",
      "type": "service-provider",
      "description": "",
      "location": {
        "country": "Kenya",
        "county": "Nakuru County",
        "city": "Naivasha",
        "area": "",
        "serviceArea": [
          "Nairobi",
          "Naivasha"
        ],
        "format": "local"
      },
      "contact": {
        "email": null,
        "phone": null,
        "website": null
      },
      "verificationStatus": "demo-verified",
      "status": "published"
    },
    {
      "id": "seller-fittrack-coaching-demo",
      "name": "FitTrack Coaching (demo)",
      "slug": "fittrack-coaching-demo",
      "type": "service-provider",
      "description": "",
      "location": {
        "country": "Kenya",
        "county": "Nairobi County",
        "city": "Nairobi",
        "area": "",
        "serviceArea": [
          "Nairobi"
        ],
        "format": "local"
      },
      "contact": {
        "email": null,
        "phone": null,
        "website": null
      },
      "verificationStatus": "unverified",
      "status": "published"
    }
  ];

  /* Listings: products and services. */
  const listings = [
    {
      "id": "phone-zenith-x6-pro",
      "type": "product",
      "name": "Zenith X6 Pro — 256GB",
      "slug": "zenith-x6-pro-256gb",
      "shortDescription": "Flagship-style demo phone with a 6.5\" AMOLED display and triple camera.",
      "description": "The flagship of the demo Zenith range: a 6.5-inch 120 Hz AMOLED display, a 50 MP triple camera and a 5,000 mAh battery. 5G, Wi-Fi 6 and 256 GB of storage in a 196 g body.",
      "brand": "Zenith",
      "category": "technology",
      "subcategory": "smartphones",
      "tags": [
        "smartphone",
        "premium",
        "camera",
        "5g",
        "nairobi"
      ],
      "highlights": [
        "6.5\" 120 Hz AMOLED display",
        "5,000 mAh battery",
        "5G with Wi-Fi 6"
      ],
      "images": [
        {
          "id": "img-1",
          "position": 0,
          "src": null,
          "alt": "Flagship smartphone",
          "icon": "📱",
          "gradient": "linear-gradient(135deg,#E0E7FF,#C7D2FE)"
        }
      ],
      "price": {
        "amount": 89999,
        "min": null,
        "max": null,
        "priceType": "fixed"
      },
      "currency": "KES",
      "referencePrice": 96000,
      "location": {
        "country": "Kenya",
        "county": "Nairobi County",
        "city": "Nairobi",
        "area": "",
        "serviceArea": [],
        "format": "local"
      },
      "availability": "available",
      "sellerId": "seller-zenith-store-nairobi",
      "specifications": [
        {
          "label": "Display",
          "value": "6.5\" AMOLED, 120 Hz",
          "group": "Display",
          "position": 0
        },
        {
          "label": "Processor",
          "value": "Octa-core demo chip",
          "group": "Performance",
          "position": 1
        },
        {
          "label": "RAM",
          "value": "8 GB",
          "group": "Performance",
          "position": 2
        },
        {
          "label": "Storage",
          "value": "256 GB",
          "group": "Performance",
          "position": 3
        },
        {
          "label": "Battery",
          "value": "5,000 mAh",
          "group": "Power",
          "position": 4
        },
        {
          "label": "Camera",
          "value": "50 MP triple + 12 MP front",
          "group": "Camera",
          "position": 5
        },
        {
          "label": "Connectivity",
          "value": "5G, Wi-Fi 6, NFC, USB-C",
          "group": "Camera",
          "position": 6
        },
        {
          "label": "Operating system",
          "value": "Demo OS 15",
          "group": "Camera",
          "position": 7
        },
        {
          "label": "Weight",
          "value": "196 g",
          "group": "Design",
          "position": 8
        },
        {
          "label": "Warranty",
          "value": "2 years",
          "group": "Support",
          "position": 9
        }
      ],
      "status": "published",
      "createdAt": "2026-09-18",
      "updatedAt": "2026-09-18",
      "offerId": "offer-phone-zenith-x6-pro"
    },
    {
      "id": "phone-nova-edge-5g",
      "type": "product",
      "name": "Nova Edge 5G — 256GB",
      "slug": "nova-edge-5g-256gb",
      "shortDescription": "Mid-range demo phone with 5G, a large battery and a 90 Hz screen.",
      "description": "A mid-range 5G phone built around a 6.7-inch 90 Hz screen and a 5,800 mAh battery. Comes with 8 GB of memory, 256 GB of storage and a 64 MP dual camera.",
      "brand": "Nova",
      "category": "technology",
      "subcategory": "smartphones",
      "tags": [
        "smartphone",
        "mid-range",
        "5g",
        "business",
        "mombasa"
      ],
      "highlights": [
        "5G connectivity",
        "5,800 mAh battery",
        "Large 6.7\" screen"
      ],
      "images": [
        {
          "id": "img-1",
          "position": 0,
          "src": null,
          "alt": "Mid-range 5G phone",
          "icon": "📲",
          "gradient": "linear-gradient(135deg,#DBEAFE,#BFDBFE)"
        }
      ],
      "price": {
        "amount": 57999,
        "min": null,
        "max": null,
        "priceType": "fixed"
      },
      "currency": "KES",
      "referencePrice": null,
      "location": {
        "country": "Kenya",
        "county": "Mombasa County",
        "city": "Mombasa",
        "area": "",
        "serviceArea": [],
        "format": "local"
      },
      "availability": "available",
      "sellerId": "seller-coast-mobile-hub",
      "specifications": [
        {
          "label": "Display",
          "value": "6.7\" LCD, 90 Hz",
          "group": "Display",
          "position": 0
        },
        {
          "label": "Processor",
          "value": "Octa-core demo chip",
          "group": "Performance",
          "position": 1
        },
        {
          "label": "RAM",
          "value": "8 GB",
          "group": "Performance",
          "position": 2
        },
        {
          "label": "Storage",
          "value": "256 GB",
          "group": "Performance",
          "position": 3
        },
        {
          "label": "Battery",
          "value": "5,800 mAh",
          "group": "Power",
          "position": 4
        },
        {
          "label": "Camera",
          "value": "64 MP dual + 16 MP front",
          "group": "Camera",
          "position": 5
        },
        {
          "label": "Connectivity",
          "value": "5G, Wi-Fi 5, USB-C",
          "group": "Camera",
          "position": 6
        },
        {
          "label": "Operating system",
          "value": "Demo OS 14",
          "group": "Camera",
          "position": 7
        },
        {
          "label": "Weight",
          "value": "212 g",
          "group": "Design",
          "position": 8
        },
        {
          "label": "Warranty",
          "value": "18 months",
          "group": "Support",
          "position": 9
        }
      ],
      "status": "published",
      "createdAt": "2026-09-06",
      "updatedAt": "2026-09-06",
      "offerId": null
    },
    {
      "id": "phone-kesi-prime-4",
      "type": "product",
      "name": "Kesi Prime 4 — 128GB",
      "slug": "kesi-prime-4-128gb",
      "shortDescription": "Budget demo phone aimed at students and first-time buyers.",
      "description": "An entry-level 128 GB phone with a 6.5-inch screen, dual SIM and a 5,200 mAh battery. Suited to calls, messaging, maps and light everyday apps.",
      "brand": "Kesi",
      "category": "technology",
      "subcategory": "smartphones",
      "tags": [
        "smartphone",
        "budget",
        "student",
        "first-phone",
        "nakuru"
      ],
      "highlights": [
        "Two-day battery",
        "Dual SIM",
        "Expandable storage"
      ],
      "images": [
        {
          "id": "img-1",
          "position": 0,
          "src": null,
          "alt": "Budget smartphone",
          "icon": "📴",
          "gradient": "linear-gradient(135deg,#F1F5F9,#E2E8F0)"
        }
      ],
      "price": {
        "amount": 13499,
        "min": null,
        "max": null,
        "priceType": "fixed"
      },
      "currency": "KES",
      "referencePrice": null,
      "location": {
        "country": "Kenya",
        "county": "Nakuru County",
        "city": "Nakuru",
        "area": "",
        "serviceArea": [],
        "format": "local"
      },
      "availability": "available",
      "sellerId": "seller-rift-electronics",
      "specifications": [
        {
          "label": "Display",
          "value": "6.5\" LCD, 60 Hz",
          "group": "Display",
          "position": 0
        },
        {
          "label": "Processor",
          "value": "Entry demo chip",
          "group": "Performance",
          "position": 1
        },
        {
          "label": "RAM",
          "value": "4 GB",
          "group": "Performance",
          "position": 2
        },
        {
          "label": "Storage",
          "value": "128 GB",
          "group": "Performance",
          "position": 3
        },
        {
          "label": "Battery",
          "value": "5,200 mAh",
          "group": "Power",
          "position": 4
        },
        {
          "label": "Camera",
          "value": "13 MP dual + 8 MP front",
          "group": "Camera",
          "position": 5
        },
        {
          "label": "Connectivity",
          "value": "4G, Wi-Fi 5, USB-C",
          "group": "Camera",
          "position": 6
        },
        {
          "label": "Operating system",
          "value": "Demo OS 13 Go",
          "group": "Camera",
          "position": 7
        },
        {
          "label": "Weight",
          "value": "188 g",
          "group": "Design",
          "position": 8
        },
        {
          "label": "Warranty",
          "value": "1 year",
          "group": "Support",
          "position": 9
        }
      ],
      "status": "published",
      "createdAt": "2026-08-24",
      "updatedAt": "2026-08-24",
      "offerId": null
    },
    {
      "id": "phone-zenith-x4-refurbished",
      "type": "product",
      "name": "Zenith X4 — Refurbished, 128GB",
      "slug": "zenith-x4-refurbished-128gb",
      "shortDescription": "Refurbished older demo model with a condition grade and short warranty.",
      "description": "A refurbished 128 GB handset graded condition B: 6.1-inch OLED screen, 5G and a battery reported above 85% health. Supplied with a charging cable and a six-month demo warranty.",
      "brand": "Zenith",
      "category": "technology",
      "subcategory": "smartphones",
      "tags": [
        "smartphone",
        "refurbished",
        "budget",
        "student",
        "value",
        "nairobi"
      ],
      "highlights": [
        "Lower price, older model",
        "Condition grade shown",
        "6-month demo warranty"
      ],
      "images": [
        {
          "id": "img-1",
          "position": 0,
          "src": null,
          "alt": "Refurbished smartphone",
          "icon": "♻️",
          "gradient": "linear-gradient(135deg,#DCFCE7,#BBF7D0)"
        }
      ],
      "price": {
        "amount": 18900,
        "min": null,
        "max": null,
        "priceType": "fixed"
      },
      "currency": "KES",
      "referencePrice": null,
      "location": {
        "country": "Kenya",
        "county": "Nairobi County",
        "city": "Nairobi",
        "area": "",
        "serviceArea": [],
        "format": "local"
      },
      "availability": "limited",
      "sellerId": "seller-refurbpoint-nairobi",
      "specifications": [
        {
          "label": "Display",
          "value": "6.1\" OLED, 60 Hz",
          "group": "Display",
          "position": 0
        },
        {
          "label": "Processor",
          "value": "Two-generation-old demo chip",
          "group": "Performance",
          "position": 1
        },
        {
          "label": "RAM",
          "value": "6 GB",
          "group": "Performance",
          "position": 2
        },
        {
          "label": "Storage",
          "value": "128 GB",
          "group": "Performance",
          "position": 3
        },
        {
          "label": "Battery",
          "value": "3,600 mAh (health reported 85%+)",
          "group": "Power",
          "position": 4
        },
        {
          "label": "Camera",
          "value": "12 MP dual + 8 MP front",
          "group": "Camera",
          "position": 5
        },
        {
          "label": "Connectivity",
          "value": "5G, Wi-Fi 6, USB-C",
          "group": "Camera",
          "position": 6
        },
        {
          "label": "Operating system",
          "value": "Demo OS 14",
          "group": "Camera",
          "position": 7
        },
        {
          "label": "Weight",
          "value": "174 g",
          "group": "Design",
          "position": 8
        },
        {
          "label": "Condition",
          "value": "Refurbished grade B (demo)",
          "group": "Condition",
          "position": 9
        },
        {
          "label": "Included",
          "value": "Cable only, no box (demo)",
          "group": "Condition",
          "position": 10
        },
        {
          "label": "Warranty",
          "value": "6 months",
          "group": "Support",
          "position": 11
        }
      ],
      "status": "published",
      "createdAt": "2026-09-02",
      "updatedAt": "2026-09-02",
      "offerId": null
    },
    {
      "id": "laptop-slatebook-air-14",
      "type": "product",
      "name": "SlateBook Air 14 — 16GB / 512GB",
      "slug": "slatebook-air-14-16gb-512gb",
      "shortDescription": "Thin 14-inch demo laptop for everyday work, study and travel.",
      "description": "A thin everyday laptop with a 14-inch 2.8K 90 Hz display, 16 GB of memory and a 512 GB SSD. Weighs 1.24 kg and carries USB-C, USB-A and HDMI ports.",
      "brand": "Slate",
      "category": "technology",
      "subcategory": "laptops",
      "tags": [
        "laptop",
        "remote-work",
        "portable",
        "premium",
        "business",
        "nairobi"
      ],
      "highlights": [
        "Weighs 1.24 kg",
        "18-hour advertised battery",
        "16 GB memory"
      ],
      "images": [
        {
          "id": "img-1",
          "position": 0,
          "src": null,
          "alt": "Thin 14 inch laptop",
          "icon": "💻",
          "gradient": "linear-gradient(135deg,#E0E7FF,#C7D2FE)"
        }
      ],
      "price": {
        "amount": 124999,
        "min": null,
        "max": null,
        "priceType": "fixed"
      },
      "currency": "KES",
      "referencePrice": 129999,
      "location": {
        "country": "Kenya",
        "county": "Nairobi County",
        "city": "Nairobi",
        "area": "",
        "serviceArea": [],
        "format": "local"
      },
      "availability": "available",
      "sellerId": "seller-slatepoint-store",
      "specifications": [
        {
          "label": "Processor",
          "value": "8-core demo chip",
          "group": "Performance",
          "position": 0
        },
        {
          "label": "RAM",
          "value": "16 GB",
          "group": "Performance",
          "position": 1
        },
        {
          "label": "Storage",
          "value": "512 GB SSD",
          "group": "Performance",
          "position": 2
        },
        {
          "label": "Graphics",
          "value": "Integrated",
          "group": "Performance",
          "position": 3
        },
        {
          "label": "Display",
          "value": "14\" 2.8K, 90 Hz",
          "group": "Display",
          "position": 4
        },
        {
          "label": "Battery",
          "value": "Up to 18 hours (illustrative)",
          "group": "Power",
          "position": 5
        },
        {
          "label": "Weight",
          "value": "1.24 kg",
          "group": "Design",
          "position": 6
        },
        {
          "label": "Ports",
          "value": "2× USB-C, 1× USB-A, HDMI",
          "group": "Design",
          "position": 7
        },
        {
          "label": "Warranty",
          "value": "2 years",
          "group": "Support",
          "position": 8
        }
      ],
      "status": "published",
      "createdAt": "2026-09-12",
      "updatedAt": "2026-09-12",
      "offerId": "offer-laptop-slatebook-air-14"
    },
    {
      "id": "laptop-slatebook-studio-16",
      "type": "product",
      "name": "SlateBook Studio 16 — 32GB / 1TB",
      "slug": "slatebook-studio-16-32gb-1tb",
      "shortDescription": "Large-screen demo laptop for design, video and heavy multitasking.",
      "description": "A 16-inch workstation laptop with a 3.2K 120 Hz screen, 32 GB of memory, a 1 TB SSD and dedicated graphics. Built for design, video editing and heavy multitasking.",
      "brand": "Slate",
      "category": "technology",
      "subcategory": "laptops",
      "tags": [
        "laptop",
        "creator",
        "gaming",
        "premium",
        "business"
      ],
      "highlights": [
        "32 GB memory",
        "Dedicated graphics",
        "Colour-accurate 16\" panel"
      ],
      "images": [
        {
          "id": "img-1",
          "position": 0,
          "src": null,
          "alt": "Large screen laptop",
          "icon": "🖥️",
          "gradient": "linear-gradient(135deg,#C7D2FE,#A5B4FC)"
        }
      ],
      "price": {
        "amount": 219999,
        "min": null,
        "max": null,
        "priceType": "fixed"
      },
      "currency": "KES",
      "referencePrice": null,
      "location": {
        "country": "Kenya",
        "county": "Nairobi County",
        "city": "Nairobi",
        "area": "",
        "serviceArea": [],
        "format": "local"
      },
      "availability": "available",
      "sellerId": "seller-slatepoint-store",
      "specifications": [
        {
          "label": "Processor",
          "value": "12-core demo chip",
          "group": "Performance",
          "position": 0
        },
        {
          "label": "RAM",
          "value": "32 GB",
          "group": "Performance",
          "position": 1
        },
        {
          "label": "Storage",
          "value": "1 TB SSD",
          "group": "Performance",
          "position": 2
        },
        {
          "label": "Graphics",
          "value": "Dedicated demo GPU",
          "group": "Performance",
          "position": 3
        },
        {
          "label": "Display",
          "value": "16\" 3.2K, 120 Hz",
          "group": "Display",
          "position": 4
        },
        {
          "label": "Battery",
          "value": "Up to 12 hours (illustrative)",
          "group": "Power",
          "position": 5
        },
        {
          "label": "Weight",
          "value": "1.92 kg",
          "group": "Design",
          "position": 6
        },
        {
          "label": "Ports",
          "value": "3× USB-C, SD card, HDMI",
          "group": "Design",
          "position": 7
        },
        {
          "label": "Warranty",
          "value": "3 years",
          "group": "Support",
          "position": 8
        }
      ],
      "status": "published",
      "createdAt": "2026-09-04",
      "updatedAt": "2026-09-04",
      "offerId": null
    },
    {
      "id": "laptop-kesibook-14-student",
      "type": "product",
      "name": "Kesi Book 14 — 8GB / 256GB",
      "slug": "kesi-book-14-8gb-256gb",
      "shortDescription": "Entry-level demo laptop positioned for students and light office work.",
      "description": "A 14-inch Full HD laptop for study and light office work: 8 GB of memory, a 256 GB SSD and up to ten hours of advertised battery life.",
      "brand": "Kesi",
      "category": "technology",
      "subcategory": "laptops",
      "tags": [
        "laptop",
        "student",
        "budget",
        "remote-work",
        "eldoret"
      ],
      "highlights": [
        "Light for the price",
        "Full HD screen",
        "Student pricing demo"
      ],
      "images": [
        {
          "id": "img-1",
          "position": 0,
          "src": null,
          "alt": "Entry level laptop",
          "icon": "📗",
          "gradient": "linear-gradient(135deg,#CCFBF1,#99F6E0)"
        }
      ],
      "price": {
        "amount": 46999,
        "min": null,
        "max": null,
        "priceType": "fixed"
      },
      "currency": "KES",
      "referencePrice": null,
      "location": {
        "country": "Kenya",
        "county": "Uasin Gishu County",
        "city": "Eldoret",
        "area": "",
        "serviceArea": [],
        "format": "local"
      },
      "availability": "available",
      "sellerId": "seller-highlands-computers",
      "specifications": [
        {
          "label": "Processor",
          "value": "Quad-core demo chip",
          "group": "Performance",
          "position": 0
        },
        {
          "label": "RAM",
          "value": "8 GB",
          "group": "Performance",
          "position": 1
        },
        {
          "label": "Storage",
          "value": "256 GB SSD",
          "group": "Performance",
          "position": 2
        },
        {
          "label": "Graphics",
          "value": "Integrated",
          "group": "Performance",
          "position": 3
        },
        {
          "label": "Display",
          "value": "14\" Full HD, 60 Hz",
          "group": "Display",
          "position": 4
        },
        {
          "label": "Battery",
          "value": "Up to 10 hours (illustrative)",
          "group": "Power",
          "position": 5
        },
        {
          "label": "Weight",
          "value": "1.48 kg",
          "group": "Design",
          "position": 6
        },
        {
          "label": "Ports",
          "value": "1× USB-C, 2× USB-A, HDMI",
          "group": "Design",
          "position": 7
        },
        {
          "label": "Warranty",
          "value": "1 year",
          "group": "Support",
          "position": 8
        }
      ],
      "status": "published",
      "createdAt": "2026-08-29",
      "updatedAt": "2026-08-29",
      "offerId": "offer-laptop-kesibook-14-student"
    },
    {
      "id": "monitor-clearview-27-qhd",
      "type": "product",
      "name": "PixelWell 27\" QHD Monitor",
      "slug": "pixelwell-27-qhd-monitor",
      "shortDescription": "27-inch QHD demo monitor with a height-adjustable stand.",
      "description": "A 27-inch QHD IPS monitor with a 75 Hz refresh rate and a height-adjustable stand. Two HDMI inputs and a DisplayPort keep a desktop and a portable machine connected.",
      "brand": "PixelWell",
      "category": "technology",
      "subcategory": "monitors",
      "tags": [
        "monitor",
        "remote-work",
        "student",
        "business",
        "nairobi"
      ],
      "highlights": [
        "QHD 27-inch panel",
        "Adjustable stand",
        "Three-year demo warranty"
      ],
      "images": [
        {
          "id": "img-1",
          "position": 0,
          "src": null,
          "alt": "Desktop monitor",
          "icon": "🖼️",
          "gradient": "linear-gradient(135deg,#DBEAFE,#BFDBFE)"
        }
      ],
      "price": {
        "amount": 38500,
        "min": null,
        "max": null,
        "priceType": "fixed"
      },
      "currency": "KES",
      "referencePrice": null,
      "location": {
        "country": "Kenya",
        "county": "Nairobi County",
        "city": "Nairobi",
        "area": "",
        "serviceArea": [],
        "format": "local"
      },
      "availability": "available",
      "sellerId": "seller-screenworks-nairobi",
      "specifications": [
        {
          "label": "Screen size",
          "value": "27 inches",
          "group": "Display",
          "position": 0
        },
        {
          "label": "Resolution",
          "value": "2560 × 1440 (QHD)",
          "group": "Display",
          "position": 1
        },
        {
          "label": "Panel",
          "value": "IPS demo panel",
          "group": "Display",
          "position": 2
        },
        {
          "label": "Refresh rate",
          "value": "75 Hz",
          "group": "Display",
          "position": 3
        },
        {
          "label": "Stand",
          "value": "Height and tilt adjustable",
          "group": "Design",
          "position": 4
        },
        {
          "label": "Ports",
          "value": "2× HDMI, 1× DisplayPort",
          "group": "Design",
          "position": 5
        },
        {
          "label": "Warranty",
          "value": "3 years",
          "group": "Support",
          "position": 6
        }
      ],
      "status": "published",
      "createdAt": "2026-08-18",
      "updatedAt": "2026-08-18",
      "offerId": null
    },
    {
      "id": "headphones-quietmax-700",
      "type": "product",
      "name": "QuietMax 700 — Wireless Over-Ear",
      "slug": "quietmax-700-wireless-over-ear",
      "shortDescription": "Adaptive noise cancelling over-ear headphones with 40-hour battery life.",
      "description": "Over-ear headphones with adaptive noise cancelling, 40 mm drivers and 40 hours of playback per charge. Bluetooth multipoint keeps two devices connected, and a ten-minute charge adds hours of listening.",
      "brand": "QuietMax",
      "category": "technology",
      "subcategory": "audio",
      "tags": [
        "audio",
        "wireless",
        "noise-cancelling",
        "travel",
        "remote-work"
      ],
      "highlights": [
        "Adaptive noise cancelling",
        "40-hour battery",
        "USB-C quick charge"
      ],
      "images": [
        {
          "id": "img-1",
          "position": 0,
          "src": null,
          "alt": "Wireless over-ear headphones",
          "icon": "🎧",
          "gradient": "linear-gradient(135deg,#E0E7FF,#C7D2FE)"
        }
      ],
      "price": {
        "amount": 22900,
        "min": null,
        "max": null,
        "priceType": "fixed"
      },
      "currency": "KES",
      "referencePrice": 27900,
      "location": {
        "country": "Kenya",
        "county": "",
        "city": "",
        "area": "",
        "serviceArea": [],
        "format": "online"
      },
      "availability": "available",
      "sellerId": "seller-audionest-online",
      "specifications": [
        {
          "label": "Noise cancellation",
          "value": "Adaptive ANC",
          "group": "Audio",
          "position": 0
        },
        {
          "label": "Drivers",
          "value": "40 mm dynamic",
          "group": "Audio",
          "position": 1
        },
        {
          "label": "Battery",
          "value": "40 hours",
          "group": "Power",
          "position": 2
        },
        {
          "label": "Charging",
          "value": "USB-C, 10 min quick charge",
          "group": "Power",
          "position": 3
        },
        {
          "label": "Weight",
          "value": "253 g",
          "group": "Design",
          "position": 4
        },
        {
          "label": "Connectivity",
          "value": "Bluetooth 5.3, multipoint",
          "group": "Connectivity",
          "position": 5
        },
        {
          "label": "Warranty",
          "value": "2 years",
          "group": "Support",
          "position": 6
        }
      ],
      "status": "published",
      "createdAt": "2026-09-15",
      "updatedAt": "2026-09-15",
      "offerId": "offer-headphones-quietmax-700"
    },
    {
      "id": "headphones-basswave-700",
      "type": "product",
      "name": "BassWave 700 — Bass Boost Over-Ear",
      "slug": "basswave-700-bass-boost-over-ear",
      "shortDescription": "Bass-forward over-ear headphones with a simpler feature set.",
      "description": "Bass-forward over-ear headphones with 45 mm drivers, a foldable frame and 30 hours of playback. Bluetooth 5.0 with a standard USB-C charge.",
      "brand": "BassWave",
      "category": "technology",
      "subcategory": "audio",
      "tags": [
        "audio",
        "bass",
        "budget",
        "student"
      ],
      "highlights": [
        "Strong bass tuning",
        "30-hour battery",
        "Foldable frame"
      ],
      "images": [
        {
          "id": "img-1",
          "position": 0,
          "src": null,
          "alt": "Bass boost over-ear headphones",
          "icon": "🎵",
          "gradient": "linear-gradient(135deg,#FEF3C7,#FDE68A)"
        }
      ],
      "price": {
        "amount": 12900,
        "min": null,
        "max": null,
        "priceType": "fixed"
      },
      "currency": "KES",
      "referencePrice": null,
      "location": {
        "country": "Kenya",
        "county": "",
        "city": "",
        "area": "",
        "serviceArea": [],
        "format": "online"
      },
      "availability": "available",
      "sellerId": "seller-soundcart-kenya",
      "specifications": [
        {
          "label": "Noise cancellation",
          "value": "No (passive isolation)",
          "group": "Audio",
          "position": 0
        },
        {
          "label": "Drivers",
          "value": "45 mm dynamic",
          "group": "Audio",
          "position": 1
        },
        {
          "label": "Battery",
          "value": "30 hours",
          "group": "Power",
          "position": 2
        },
        {
          "label": "Charging",
          "value": "USB-C, standard charge",
          "group": "Power",
          "position": 3
        },
        {
          "label": "Weight",
          "value": "286 g",
          "group": "Design",
          "position": 4
        },
        {
          "label": "Connectivity",
          "value": "Bluetooth 5.0",
          "group": "Connectivity",
          "position": 5
        },
        {
          "label": "Warranty",
          "value": "1 year",
          "group": "Support",
          "position": 6
        }
      ],
      "status": "published",
      "createdAt": "2026-08-22",
      "updatedAt": "2026-08-22",
      "offerId": null
    },
    {
      "id": "headphones-airflow-studio-pro",
      "type": "product",
      "name": "AirFlow Studio Pro — Spatial Audio",
      "slug": "airflow-studio-pro-spatial-audio",
      "shortDescription": "Premium over-ear headphones with spatial audio and a companion EQ app.",
      "description": "Premium over-ear headphones with hybrid noise cancelling, 42 mm planar drivers and 60 hours of playback. Spatial audio, multipoint Bluetooth 5.4 and a 3.5 mm input for wired listening.",
      "brand": "AirFlow",
      "category": "technology",
      "subcategory": "audio",
      "tags": [
        "audio",
        "premium",
        "spatial",
        "professional"
      ],
      "highlights": [
        "Spatial audio",
        "Companion EQ app",
        "Lightweight frame"
      ],
      "images": [
        {
          "id": "img-1",
          "position": 0,
          "src": null,
          "alt": "Premium spatial audio headphones",
          "icon": "✨",
          "gradient": "linear-gradient(135deg,#EEF2FF,#E0E7FF)"
        }
      ],
      "price": {
        "amount": 34500,
        "min": null,
        "max": null,
        "priceType": "fixed"
      },
      "currency": "KES",
      "referencePrice": null,
      "location": {
        "country": "Kenya",
        "county": "",
        "city": "",
        "area": "",
        "serviceArea": [],
        "format": "online"
      },
      "availability": "limited",
      "sellerId": "seller-airflow-direct",
      "specifications": [
        {
          "label": "Noise cancellation",
          "value": "Hybrid ANC",
          "group": "Audio",
          "position": 0
        },
        {
          "label": "Drivers",
          "value": "42 mm planar",
          "group": "Audio",
          "position": 1
        },
        {
          "label": "Battery",
          "value": "60 hours",
          "group": "Power",
          "position": 2
        },
        {
          "label": "Charging",
          "value": "USB-C, 5 min quick charge",
          "group": "Power",
          "position": 3
        },
        {
          "label": "Weight",
          "value": "268 g",
          "group": "Design",
          "position": 4
        },
        {
          "label": "Connectivity",
          "value": "Bluetooth 5.4, multipoint, 3.5 mm",
          "group": "Connectivity",
          "position": 5
        },
        {
          "label": "Warranty",
          "value": "2 years",
          "group": "Support",
          "position": 6
        }
      ],
      "status": "published",
      "createdAt": "2026-09-12",
      "updatedAt": "2026-09-12",
      "offerId": null
    },
    {
      "id": "router-fibermax-ax3000",
      "type": "product",
      "name": "FiberMax AX3000 Wi-Fi 6 Router",
      "slug": "fibermax-ax3000-wi-fi-6-router",
      "shortDescription": "Dual-band Wi-Fi 6 demo router for homes and small offices.",
      "description": "A dual-band Wi-Fi 6 router rated up to 3,000 Mbps with four Gigabit LAN ports and one WAN port. The demo coverage figure is up to 120 m² for a home or small office.",
      "brand": "FiberMax",
      "category": "technology",
      "subcategory": "networking",
      "tags": [
        "networking",
        "wifi",
        "wireless",
        "remote-work",
        "fast",
        "family",
        "router"
      ],
      "highlights": [
        "Wi-Fi 6 dual band",
        "Four Gigabit LAN ports",
        "Works with fibre plans"
      ],
      "images": [
        {
          "id": "img-1",
          "position": 0,
          "src": null,
          "alt": "Wi-Fi router",
          "icon": "📶",
          "gradient": "linear-gradient(135deg,#DBEAFE,#BFDBFE)"
        }
      ],
      "price": {
        "amount": 9800,
        "min": null,
        "max": null,
        "priceType": "fixed"
      },
      "currency": "KES",
      "referencePrice": null,
      "location": {
        "country": "Kenya",
        "county": "",
        "city": "",
        "area": "",
        "serviceArea": [],
        "format": "nationwide"
      },
      "availability": "available",
      "sellerId": "seller-fibermax-store",
      "specifications": [
        {
          "label": "Wi-Fi standard",
          "value": "Wi-Fi 6 (802.11ax)",
          "group": "Wireless",
          "position": 0
        },
        {
          "label": "Speed",
          "value": "Up to 3,000 Mbps combined",
          "group": "Wireless",
          "position": 1
        },
        {
          "label": "Bands",
          "value": "Dual band (2.4 + 5 GHz)",
          "group": "Wireless",
          "position": 2
        },
        {
          "label": "Coverage",
          "value": "Up to 120 m² (illustrative)",
          "group": "Wireless",
          "position": 3
        },
        {
          "label": "Ports",
          "value": "4× Gigabit LAN, 1× WAN",
          "group": "Wired",
          "position": 4
        },
        {
          "label": "SIM support",
          "value": "No (fibre or cable only)",
          "group": "Wired",
          "position": 5
        },
        {
          "label": "Warranty",
          "value": "2 years",
          "group": "Support",
          "position": 6
        }
      ],
      "status": "published",
      "createdAt": "2026-09-08",
      "updatedAt": "2026-09-08",
      "offerId": null
    },
    {
      "id": "router-netlink-lte-mifi",
      "type": "product",
      "name": "MeshPoint LTE MiFi — Portable",
      "slug": "meshpoint-lte-mifi-portable",
      "shortDescription": "Portable battery-powered LTE hotspot with SIM support.",
      "description": "A pocket-sized LTE hotspot that takes a nano SIM and shares the connection over dual-band Wi-Fi 5. A 3,000 mAh battery runs up to ten hours between charges.",
      "brand": "MeshPoint",
      "category": "technology",
      "subcategory": "networking",
      "tags": [
        "networking",
        "wireless",
        "portable",
        "travel",
        "budget",
        "sim",
        "mombasa"
      ],
      "highlights": [
        "Needs only a SIM",
        "10-hour battery",
        "Fits in a pocket"
      ],
      "images": [
        {
          "id": "img-1",
          "position": 0,
          "src": null,
          "alt": "Portable LTE hotspot",
          "icon": "📡",
          "gradient": "linear-gradient(135deg,#CCFBF1,#99F6E0)"
        }
      ],
      "price": {
        "amount": 5400,
        "min": null,
        "max": null,
        "priceType": "fixed"
      },
      "currency": "KES",
      "referencePrice": null,
      "location": {
        "country": "Kenya",
        "county": "Mombasa County",
        "city": "Mombasa",
        "area": "",
        "serviceArea": [],
        "format": "local"
      },
      "availability": "available",
      "sellerId": "seller-coast-mobile-hub",
      "specifications": [
        {
          "label": "Wi-Fi standard",
          "value": "Wi-Fi 5 (802.11ac)",
          "group": "Wireless",
          "position": 0
        },
        {
          "label": "Speed",
          "value": "Up to 300 Mbps (LTE Cat 6)",
          "group": "Wireless",
          "position": 1
        },
        {
          "label": "Bands",
          "value": "Dual band",
          "group": "Wireless",
          "position": 2
        },
        {
          "label": "Coverage",
          "value": "Up to 35 m² (illustrative)",
          "group": "Wireless",
          "position": 3
        },
        {
          "label": "Ports",
          "value": "1× micro-USB charging",
          "group": "Wired",
          "position": 4
        },
        {
          "label": "SIM support",
          "value": "Yes (nano SIM, SIM not included)",
          "group": "Wired",
          "position": 5
        },
        {
          "label": "Battery",
          "value": "3,000 mAh, up to 10 hours",
          "group": "Power",
          "position": 6
        },
        {
          "label": "Warranty",
          "value": "1 year",
          "group": "Support",
          "position": 7
        }
      ],
      "status": "published",
      "createdAt": "2026-08-27",
      "updatedAt": "2026-08-27",
      "offerId": null
    },
    {
      "id": "tablet-slatepad-11",
      "type": "product",
      "name": "SlatePad 11 — 128GB, Wi-Fi",
      "slug": "slatepad-11-128gb-wi-fi",
      "shortDescription": "11-inch demo tablet for notes, reading and light study work.",
      "description": "An 11-inch tablet with a 90 Hz screen, 6 GB of memory and 128 GB of storage. Stylus support and an 8,000 mAh battery suit notes, reading and light study work.",
      "brand": "Slate",
      "category": "technology",
      "subcategory": "tablets",
      "tags": [
        "tablet",
        "student",
        "remote-work",
        "beginner",
        "nairobi"
      ],
      "highlights": [
        "Stylus support",
        "90 Hz screen",
        "Folio case demo bundle"
      ],
      "images": [
        {
          "id": "img-1",
          "position": 0,
          "src": null,
          "alt": "Tablet with stylus",
          "icon": "📔",
          "gradient": "linear-gradient(135deg,#EDE9FE,#DDD6FE)"
        }
      ],
      "price": {
        "amount": 62000,
        "min": null,
        "max": null,
        "priceType": "fixed"
      },
      "currency": "KES",
      "referencePrice": null,
      "location": {
        "country": "Kenya",
        "county": "Nairobi County",
        "city": "Nairobi",
        "area": "",
        "serviceArea": [],
        "format": "local"
      },
      "availability": "available",
      "sellerId": "seller-slatepoint-store",
      "specifications": [
        {
          "label": "Display",
          "value": "11\" LCD, 90 Hz",
          "group": "Display",
          "position": 0
        },
        {
          "label": "Processor",
          "value": "6-core demo chip",
          "group": "Performance",
          "position": 1
        },
        {
          "label": "RAM",
          "value": "6 GB",
          "group": "Performance",
          "position": 2
        },
        {
          "label": "Storage",
          "value": "128 GB",
          "group": "Performance",
          "position": 3
        },
        {
          "label": "Battery",
          "value": "8,000 mAh",
          "group": "Power",
          "position": 4
        },
        {
          "label": "Connectivity",
          "value": "Wi-Fi 6, USB-C, stylus support",
          "group": "Connectivity",
          "position": 5
        },
        {
          "label": "Weight",
          "value": "486 g",
          "group": "Design",
          "position": 6
        },
        {
          "label": "Warranty",
          "value": "2 years",
          "group": "Support",
          "position": 7
        }
      ],
      "status": "published",
      "createdAt": "2026-09-09",
      "updatedAt": "2026-09-09",
      "offerId": "offer-tablet-slatepad-11"
    },
    {
      "id": "watch-pulsefit-6",
      "type": "product",
      "name": "Beatline Watch 6 — GPS, LTE",
      "slug": "beatline-watch-6-gps-lte",
      "shortDescription": "Demo smartwatch with GPS, heart-rate tracking and LTE option.",
      "description": "A fitness watch with a 1.4-inch always-on AMOLED display, GPS, heart-rate and SpO₂ sensors. Rated 5 ATM for water resistance with up to nine days of battery life.",
      "brand": "Beatline",
      "category": "technology",
      "subcategory": "wearables",
      "tags": [
        "wearables",
        "fitness",
        "health",
        "premium",
        "nairobi"
      ],
      "highlights": [
        "GPS and heart-rate tracking",
        "Always-on AMOLED",
        "Optional LTE"
      ],
      "images": [
        {
          "id": "img-1",
          "position": 0,
          "src": null,
          "alt": "Smartwatch",
          "icon": "⌚",
          "gradient": "linear-gradient(135deg,#FFE4E6,#FECDD3)"
        }
      ],
      "price": {
        "amount": 32900,
        "min": null,
        "max": null,
        "priceType": "fixed"
      },
      "currency": "KES",
      "referencePrice": 38900,
      "location": {
        "country": "Kenya",
        "county": "Nairobi County",
        "city": "Nairobi",
        "area": "",
        "serviceArea": [],
        "format": "local"
      },
      "availability": "limited",
      "sellerId": "seller-beatline-direct",
      "specifications": [
        {
          "label": "Display",
          "value": "1.4\" AMOLED, always-on",
          "group": "Display",
          "position": 0
        },
        {
          "label": "Battery",
          "value": "Up to 9 days (illustrative)",
          "group": "Power",
          "position": 1
        },
        {
          "label": "Sensors",
          "value": "Heart rate, SpO₂, GPS",
          "group": "Sensors",
          "position": 2
        },
        {
          "label": "Water resistance",
          "value": "5 ATM",
          "group": "Sensors",
          "position": 3
        },
        {
          "label": "Connectivity",
          "value": "Bluetooth 5.2, optional LTE",
          "group": "Sensors",
          "position": 4
        },
        {
          "label": "Compatibility",
          "value": "Android and iOS (demo app)",
          "group": "Design",
          "position": 5
        },
        {
          "label": "Weight",
          "value": "38 g",
          "group": "Design",
          "position": 6
        },
        {
          "label": "Warranty",
          "value": "2 years",
          "group": "Support",
          "position": 7
        }
      ],
      "status": "published",
      "createdAt": "2026-09-19",
      "updatedAt": "2026-09-19",
      "offerId": "offer-watch-pulsefit-6"
    },
    {
      "id": "accessory-glidepro-mouse",
      "type": "product",
      "name": "GlidePro Silent Wireless Mouse",
      "slug": "glidepro-silent-wireless-mouse",
      "shortDescription": "Quiet wireless mouse with a rechargeable battery and USB-C.",
      "description": "A rechargeable wireless mouse with quiet switches, five buttons and both Bluetooth and 2.4 GHz connectivity. USB-C charging gives up to 60 days between charges.",
      "brand": "GlidePro",
      "category": "technology",
      "subcategory": "accessories",
      "tags": [
        "accessories",
        "remote-work",
        "student",
        "budget",
        "wireless",
        "laptop"
      ],
      "highlights": [
        "Silent clicks",
        "Bluetooth or receiver",
        "USB-C charging"
      ],
      "images": [
        {
          "id": "img-1",
          "position": 0,
          "src": null,
          "alt": "Wireless mouse",
          "icon": "🖱️",
          "gradient": "linear-gradient(135deg,#F1F5F9,#E2E8F0)"
        }
      ],
      "price": {
        "amount": 2450,
        "min": null,
        "max": null,
        "priceType": "fixed"
      },
      "currency": "KES",
      "referencePrice": null,
      "location": {
        "country": "Kenya",
        "county": "",
        "city": "",
        "area": "",
        "serviceArea": [],
        "format": "online"
      },
      "availability": "available",
      "sellerId": "seller-deskkit-online",
      "specifications": [
        {
          "label": "Buttons",
          "value": "5 (quiet switches)",
          "group": "Design",
          "position": 0
        },
        {
          "label": "Wireless",
          "value": "2.4 GHz USB receiver + Bluetooth",
          "group": "Design",
          "position": 1
        },
        {
          "label": "Battery",
          "value": "Rechargeable, up to 60 days",
          "group": "Power",
          "position": 2
        },
        {
          "label": "Compatibility",
          "value": "Windows, macOS, ChromeOS, Android",
          "group": "Design",
          "position": 3
        },
        {
          "label": "Warranty",
          "value": "1 year",
          "group": "Support",
          "position": 4
        }
      ],
      "status": "published",
      "createdAt": "2026-08-15",
      "updatedAt": "2026-08-15",
      "offerId": null
    },
    {
      "id": "chair-ergoform-mesh",
      "type": "product",
      "name": "ErgoForm Mesh Office Chair",
      "slug": "ergoform-mesh-office-chair",
      "shortDescription": "Adjustable mesh task chair with lumbar support and a five-year warranty.",
      "description": "A mesh-back task chair with adjustable lumbar support, 4D armrests and a breathable foam seat. Rated to 120 kg and covered by a five-year demo warranty.",
      "brand": "ErgoForm",
      "category": "home",
      "subcategory": "furniture",
      "tags": [
        "furniture",
        "office",
        "remote-work",
        "ergonomics",
        "nairobi"
      ],
      "highlights": [
        "Adjustable lumbar support",
        "Breathable mesh back",
        "Five-year demo warranty"
      ],
      "images": [
        {
          "id": "img-1",
          "position": 0,
          "src": null,
          "alt": "Mesh office chair",
          "icon": "💺",
          "gradient": "linear-gradient(135deg,#FEF3C7,#FDE68A)"
        }
      ],
      "price": {
        "amount": 18900,
        "min": null,
        "max": null,
        "priceType": "fixed"
      },
      "currency": "KES",
      "referencePrice": 22300,
      "location": {
        "country": "Kenya",
        "county": "Nairobi County",
        "city": "Nairobi",
        "area": "",
        "serviceArea": [],
        "format": "local"
      },
      "availability": "limited",
      "sellerId": "seller-homenest-nairobi",
      "specifications": [
        {
          "label": "Lumbar support",
          "value": "Adjustable",
          "group": "Comfort",
          "position": 0
        },
        {
          "label": "Armrests",
          "value": "4D adjustable",
          "group": "Comfort",
          "position": 1
        },
        {
          "label": "Material",
          "value": "Mesh back, foam seat",
          "group": "Design",
          "position": 2
        },
        {
          "label": "Dimensions",
          "value": "68 × 66 × 118 cm",
          "group": "Design",
          "position": 3
        },
        {
          "label": "Weight capacity",
          "value": "120 kg",
          "group": "Design",
          "position": 4
        },
        {
          "label": "Assembly",
          "value": "Self-assembly, tools included",
          "group": "Support",
          "position": 5
        },
        {
          "label": "Warranty",
          "value": "5 years",
          "group": "Support",
          "position": 6
        }
      ],
      "status": "published",
      "createdAt": "2026-09-10",
      "updatedAt": "2026-09-10",
      "offerId": "offer-chair-ergoform-mesh"
    },
    {
      "id": "desk-ergoform-standing",
      "type": "product",
      "name": "ErgoForm Standing Desk — 120 cm",
      "slug": "ergoform-standing-desk-120-cm",
      "shortDescription": "Electric height-adjustable demo desk with four memory presets.",
      "description": "A 120 × 60 cm desk with electric height adjustment between 72 and 120 cm. Four memory presets store your sitting and standing positions.",
      "brand": "ErgoForm",
      "category": "home",
      "subcategory": "furniture",
      "tags": [
        "furniture",
        "office",
        "remote-work",
        "premium",
        "nairobi"
      ],
      "highlights": [
        "Electric height adjustment",
        "Four memory presets",
        "Five-year demo warranty"
      ],
      "images": [
        {
          "id": "img-1",
          "position": 0,
          "src": null,
          "alt": "Height adjustable desk",
          "icon": "🪑",
          "gradient": "linear-gradient(135deg,#FDE68A,#FCD34D)"
        }
      ],
      "price": {
        "amount": 42500,
        "min": null,
        "max": null,
        "priceType": "fixed"
      },
      "currency": "KES",
      "referencePrice": null,
      "location": {
        "country": "Kenya",
        "county": "Nairobi County",
        "city": "Nairobi",
        "area": "",
        "serviceArea": [],
        "format": "local"
      },
      "availability": "available",
      "sellerId": "seller-homenest-nairobi",
      "specifications": [
        {
          "label": "Material",
          "value": "Powder-coated steel, laminate top",
          "group": "Design",
          "position": 0
        },
        {
          "label": "Dimensions",
          "value": "120 × 60 cm, 72–120 cm high",
          "group": "Design",
          "position": 1
        },
        {
          "label": "Weight capacity",
          "value": "80 kg",
          "group": "Design",
          "position": 2
        },
        {
          "label": "Adjustment",
          "value": "Electric, 4 memory presets",
          "group": "Features",
          "position": 3
        },
        {
          "label": "Assembly",
          "value": "Self-assembly, tools included",
          "group": "Support",
          "position": 4
        },
        {
          "label": "Warranty",
          "value": "5 years",
          "group": "Support",
          "position": 5
        }
      ],
      "status": "published",
      "createdAt": "2026-08-21",
      "updatedAt": "2026-08-21",
      "offerId": null
    },
    {
      "id": "mattress-dreamrest-6x6",
      "type": "product",
      "name": "Nightform 6×6 Mattress — Medium",
      "slug": "nightform-6-6-mattress-medium",
      "shortDescription": "Medium-firm demo mattress with a removable, washable cover.",
      "description": "A 6 × 6 ft pocket-spring mattress with a medium-firm feel and a 25 cm profile. The cover unzips for washing and a 14-night trial is included in the demo terms.",
      "brand": "Nightform",
      "category": "home",
      "subcategory": "furniture",
      "tags": [
        "furniture",
        "family",
        "bedroom",
        "kisumu"
      ],
      "highlights": [
        "Medium-firm support",
        "Washable cover",
        "Seven-year demo warranty"
      ],
      "images": [
        {
          "id": "img-1",
          "position": 0,
          "src": null,
          "alt": "Mattress",
          "icon": "🛏️",
          "gradient": "linear-gradient(135deg,#E0E7FF,#C7D2FE)"
        }
      ],
      "price": {
        "amount": 34900,
        "min": null,
        "max": null,
        "priceType": "fixed"
      },
      "currency": "KES",
      "referencePrice": null,
      "location": {
        "country": "Kenya",
        "county": "Kisumu County",
        "city": "Kisumu",
        "area": "",
        "serviceArea": [],
        "format": "local"
      },
      "availability": "available",
      "sellerId": "seller-lakeview-furnishings",
      "specifications": [
        {
          "label": "Size",
          "value": "6 × 6 ft (183 × 183 cm)",
          "group": "Design",
          "position": 0
        },
        {
          "label": "Firmness",
          "value": "Medium-firm",
          "group": "Comfort",
          "position": 1
        },
        {
          "label": "Thickness",
          "value": "25 cm",
          "group": "Design",
          "position": 2
        },
        {
          "label": "Material",
          "value": "Pocket spring with foam layer",
          "group": "Design",
          "position": 3
        },
        {
          "label": "Trial period",
          "value": "14 nights (demo)",
          "group": "Support",
          "position": 4
        },
        {
          "label": "Warranty",
          "value": "7 years",
          "group": "Support",
          "position": 5
        }
      ],
      "status": "published",
      "createdAt": "2026-08-12",
      "updatedAt": "2026-08-12",
      "offerId": null
    },
    {
      "id": "fridge-chillbox-mini-45l",
      "type": "product",
      "name": "ChillBox Mini Fridge — 45L",
      "slug": "chillbox-mini-fridge-45l",
      "shortDescription": "Compact 45-litre demo fridge with a quiet compressor.",
      "description": "A 45-litre compact fridge with two adjustable shelves, a reversible door and a 32 dB compressor. Sits in a 50 × 45 × 51 cm footprint with a demo energy rating of A+.",
      "brand": "ChillBox",
      "category": "home",
      "subcategory": "appliances",
      "tags": [
        "appliance",
        "kitchen",
        "budget",
        "compact-living",
        "thika"
      ],
      "highlights": [
        "45-litre capacity",
        "Low-noise compressor",
        "Reversible door"
      ],
      "images": [
        {
          "id": "img-1",
          "position": 0,
          "src": null,
          "alt": "Compact fridge",
          "icon": "🧊",
          "gradient": "linear-gradient(135deg,#CCFBF1,#99F6E0)"
        }
      ],
      "price": {
        "amount": 21500,
        "min": null,
        "max": null,
        "priceType": "fixed"
      },
      "currency": "KES",
      "referencePrice": 24900,
      "location": {
        "country": "Kenya",
        "county": "Kiambu County",
        "city": "Thika",
        "area": "",
        "serviceArea": [],
        "format": "local"
      },
      "availability": "available",
      "sellerId": "seller-thika-home-appliances",
      "specifications": [
        {
          "label": "Volume",
          "value": "45 litres",
          "group": "Capacity",
          "position": 0
        },
        {
          "label": "Shelves",
          "value": "2 adjustable",
          "group": "Capacity",
          "position": 1
        },
        {
          "label": "Energy",
          "value": "Demo rating A+",
          "group": "Performance",
          "position": 2
        },
        {
          "label": "Noise",
          "value": "32 dB",
          "group": "Performance",
          "position": 3
        },
        {
          "label": "Dimensions",
          "value": "50 × 45 × 51 cm",
          "group": "Design",
          "position": 4
        },
        {
          "label": "Warranty",
          "value": "3 years",
          "group": "Support",
          "position": 5
        }
      ],
      "status": "published",
      "createdAt": "2026-09-03",
      "updatedAt": "2026-09-03",
      "offerId": "offer-fridge-chillbox-mini-45l"
    },
    {
      "id": "light-lumaglow-solar-kit",
      "type": "product",
      "name": "LumaGlow Solar Home Light Kit",
      "slug": "lumaglow-solar-home-light-kit",
      "shortDescription": "Solar charging kit with three LED lamps and a phone charging port.",
      "description": "A solar kit with a charging panel, three 3 W LED lamps and a phone charging port. A 4,000 mAh battery stores power for up to eight hours of lighting per charge.",
      "brand": "LumaGlow",
      "category": "home",
      "subcategory": "lighting",
      "tags": [
        "lighting",
        "solar",
        "budget",
        "family",
        "machakos"
      ],
      "highlights": [
        "Charges during the day",
        "Three lamp points",
        "Phone charging port"
      ],
      "images": [
        {
          "id": "img-1",
          "position": 0,
          "src": null,
          "alt": "Solar light kit",
          "icon": "💡",
          "gradient": "linear-gradient(135deg,#FEF9C3,#FDE68A)"
        }
      ],
      "price": {
        "amount": 6400,
        "min": null,
        "max": null,
        "priceType": "fixed"
      },
      "currency": "KES",
      "referencePrice": null,
      "location": {
        "country": "Kenya",
        "county": "Machakos County",
        "city": "Machakos",
        "area": "",
        "serviceArea": [],
        "format": "local"
      },
      "availability": "available",
      "sellerId": "seller-machakos-power-supplies",
      "specifications": [
        {
          "label": "Output",
          "value": "3 × 3 W LED lamps",
          "group": "Power",
          "position": 0
        },
        {
          "label": "Battery",
          "value": "4,000 mAh storage",
          "group": "Power",
          "position": 1
        },
        {
          "label": "Runtime",
          "value": "Up to 8 hours per charge (illustrative)",
          "group": "Power",
          "position": 2
        },
        {
          "label": "Included",
          "value": "Panel, 3 lamps, cables, phone port",
          "group": "Included",
          "position": 3
        },
        {
          "label": "Warranty",
          "value": "1 year",
          "group": "Support",
          "position": 4
        }
      ],
      "status": "published",
      "createdAt": "2026-08-08",
      "updatedAt": "2026-08-08",
      "offerId": null
    },
    {
      "id": "storage-stackwise-shelving",
      "type": "product",
      "name": "StackWise 4-Tier Shelving Unit",
      "slug": "stackwise-4-tier-shelving-unit",
      "shortDescription": "Four-tier demo shelving unit for storage rooms and small offices.",
      "description": "A four-tier powder-coated steel shelving unit measuring 90 × 40 × 180 cm. Each shelf holds up to 50 kg and the frame can be bolted to a wall.",
      "brand": "StackWise",
      "category": "home",
      "subcategory": "storage",
      "tags": [
        "storage",
        "home-office",
        "budget",
        "nairobi"
      ],
      "highlights": [
        "Four tiers",
        "50 kg per shelf",
        "Bolts to the wall (fixings included)"
      ],
      "images": [
        {
          "id": "img-1",
          "position": 0,
          "src": null,
          "alt": "Shelving unit",
          "icon": "🗄️",
          "gradient": "linear-gradient(135deg,#E2E8F0,#CBD5E1)"
        }
      ],
      "price": {
        "amount": 7900,
        "min": null,
        "max": null,
        "priceType": "fixed"
      },
      "currency": "KES",
      "referencePrice": null,
      "location": {
        "country": "Kenya",
        "county": "Nairobi County",
        "city": "Nairobi",
        "area": "",
        "serviceArea": [],
        "format": "local"
      },
      "availability": "available",
      "sellerId": "seller-homenest-nairobi",
      "specifications": [
        {
          "label": "Material",
          "value": "Powder-coated steel",
          "group": "Design",
          "position": 0
        },
        {
          "label": "Dimensions",
          "value": "90 × 40 × 180 cm",
          "group": "Design",
          "position": 1
        },
        {
          "label": "Load per shelf",
          "value": "50 kg",
          "group": "Design",
          "position": 2
        },
        {
          "label": "Assembly",
          "value": "Self-assembly, tools included",
          "group": "Support",
          "position": 3
        },
        {
          "label": "Warranty",
          "value": "2 years",
          "group": "Support",
          "position": 4
        }
      ],
      "status": "published",
      "createdAt": "2026-07-30",
      "updatedAt": "2026-07-30",
      "offerId": null
    },
    {
      "id": "tyre-roadgrip-195-65",
      "type": "product",
      "name": "RoadGrip Tyre 195/65 R15",
      "slug": "roadgrip-tyre-195-65-r15",
      "shortDescription": "All-season demo tyre sold per unit, fitting arranged locally.",
      "description": "An all-season 195/65 R15 tyre with load index 91 and an H speed rating. Priced per tyre, with fitting and balancing arranged at the demo centre.",
      "brand": "RoadGrip",
      "category": "automotive",
      "subcategory": "tyres",
      "tags": [
        "tyres",
        "car",
        "maintenance",
        "nairobi"
      ],
      "highlights": [
        "Per-tyre pricing",
        "All-season tread",
        "Fitting can be arranged"
      ],
      "images": [
        {
          "id": "img-1",
          "position": 0,
          "src": null,
          "alt": "Car tyre",
          "icon": "🛞",
          "gradient": "linear-gradient(135deg,#E2E8F0,#CBD5E1)"
        }
      ],
      "price": {
        "amount": 8900,
        "min": null,
        "max": null,
        "priceType": "fixed"
      },
      "currency": "KES",
      "referencePrice": 9800,
      "location": {
        "country": "Kenya",
        "county": "Nairobi County",
        "city": "Nairobi",
        "area": "",
        "serviceArea": [],
        "format": "local"
      },
      "availability": "available",
      "sellerId": "seller-roadgrip-tyre-centre",
      "specifications": [
        {
          "label": "Size",
          "value": "195/65 R15",
          "group": "Fitment",
          "position": 0
        },
        {
          "label": "Load index",
          "value": "91",
          "group": "Fitment",
          "position": 1
        },
        {
          "label": "Speed rating",
          "value": "H (210 km/h)",
          "group": "Fitment",
          "position": 2
        },
        {
          "label": "Season",
          "value": "All-season",
          "group": "Performance",
          "position": 3
        },
        {
          "label": "Tread warranty",
          "value": "40,000 km (demo)",
          "group": "Performance",
          "position": 4
        },
        {
          "label": "Fitting",
          "value": "Arranged at the demo centre",
          "group": "Support",
          "position": 5
        }
      ],
      "status": "published",
      "createdAt": "2026-09-07",
      "updatedAt": "2026-09-07",
      "offerId": "offer-tyre-roadgrip-195-65"
    },
    {
      "id": "battery-voltstart-70ah",
      "type": "product",
      "name": "VoltStart Car Battery 70Ah",
      "slug": "voltstart-car-battery-70ah",
      "shortDescription": "Maintenance-free 70Ah demo battery with a two-year warranty.",
      "description": "A sealed maintenance-free 70 Ah battery rated at 640 A cold cranking. Standard terminal layout with a two-year demo warranty and old-battery trade-in accepted.",
      "brand": "VoltStart",
      "category": "automotive",
      "subcategory": "batteries",
      "tags": [
        "car",
        "maintenance",
        "battery",
        "nakuru"
      ],
      "highlights": [
        "Maintenance-free",
        "Trade-in accepted (demo)",
        "Two-year demo warranty"
      ],
      "images": [
        {
          "id": "img-1",
          "position": 0,
          "src": null,
          "alt": "Car battery",
          "icon": "🔋",
          "gradient": "linear-gradient(135deg,#DCFCE7,#BBF7D0)"
        }
      ],
      "price": {
        "amount": 12400,
        "min": null,
        "max": null,
        "priceType": "fixed"
      },
      "currency": "KES",
      "referencePrice": null,
      "location": {
        "country": "Kenya",
        "county": "Nakuru County",
        "city": "Nakuru",
        "area": "",
        "serviceArea": [],
        "format": "local"
      },
      "availability": "available",
      "sellerId": "seller-rift-auto-parts",
      "specifications": [
        {
          "label": "Capacity",
          "value": "70 Ah",
          "group": "Power",
          "position": 0
        },
        {
          "label": "Cold cranking",
          "value": "640 A (demo figure)",
          "group": "Power",
          "position": 1
        },
        {
          "label": "Type",
          "value": "Maintenance-free, sealed",
          "group": "Design",
          "position": 2
        },
        {
          "label": "Terminal layout",
          "value": "Standard, left positive",
          "group": "Design",
          "position": 3
        },
        {
          "label": "Warranty",
          "value": "2 years",
          "group": "Support",
          "position": 4
        },
        {
          "label": "Old battery",
          "value": "Trade-in accepted (demo)",
          "group": "Support",
          "position": 5
        }
      ],
      "status": "published",
      "createdAt": "2026-08-16",
      "updatedAt": "2026-08-16",
      "offerId": null
    },
    {
      "id": "dashcam-roadview-2k",
      "type": "product",
      "name": "RoadView 2K Dash Camera",
      "slug": "roadview-2k-dash-camera",
      "shortDescription": "Front-facing 2K demo dash camera with loop recording.",
      "description": "A windscreen dash camera recording 2K video at 30 fps with a 140° field of view. Loop recording, night mode and support for microSD cards up to 128 GB.",
      "brand": "RoadView",
      "category": "automotive",
      "subcategory": "electronics",
      "tags": [
        "car",
        "accessories",
        "safety",
        "kisumu"
      ],
      "highlights": [
        "2K recording",
        "Loop recording",
        "Windscreen mount included"
      ],
      "images": [
        {
          "id": "img-1",
          "position": 0,
          "src": null,
          "alt": "Dash camera",
          "icon": "🎥",
          "gradient": "linear-gradient(135deg,#DBEAFE,#BFDBFE)"
        }
      ],
      "price": {
        "amount": 9750,
        "min": null,
        "max": null,
        "priceType": "fixed"
      },
      "currency": "KES",
      "referencePrice": null,
      "location": {
        "country": "Kenya",
        "county": "Kisumu County",
        "city": "Kisumu",
        "area": "",
        "serviceArea": [],
        "format": "local"
      },
      "availability": "available",
      "sellerId": "seller-lakeview-auto-accessories",
      "specifications": [
        {
          "label": "Resolution",
          "value": "2K (2560 × 1440) at 30 fps",
          "group": "Video",
          "position": 0
        },
        {
          "label": "Field of view",
          "value": "140°",
          "group": "Video",
          "position": 1
        },
        {
          "label": "Night recording",
          "value": "Yes (demo mode)",
          "group": "Video",
          "position": 2
        },
        {
          "label": "Storage support",
          "value": "microSD up to 128 GB (card not included)",
          "group": "Storage",
          "position": 3
        },
        {
          "label": "Mounting",
          "value": "Adhesive windscreen mount",
          "group": "Design",
          "position": 4
        },
        {
          "label": "Warranty",
          "value": "1 year",
          "group": "Support",
          "position": 5
        }
      ],
      "status": "published",
      "createdAt": "2026-08-05",
      "updatedAt": "2026-08-05",
      "offerId": null
    },
    {
      "id": "detailing-shinelab-full-detail",
      "type": "service",
      "name": "ShineLab Full Interior & Exterior Detail",
      "slug": "shinelab-full-interior-exterior-detail",
      "shortDescription": "Demo detailing package covering interior deep clean and exterior wash and wax.",
      "description": "A detailing package covering interior deep clean and exterior wash and wax, including seat shampoo, dashboard care and tyre dressing. Takes three to four hours and can be carried out at your location within the demo service area.",
      "brand": "",
      "category": "automotive",
      "subcategory": "detailing",
      "tags": [
        "detailing",
        "car-care",
        "nairobi",
        "professional",
        "car"
      ],
      "highlights": [
        "Interior and exterior in one visit",
        "Mobile service in the demo area",
        "Price varies by vehicle size"
      ],
      "images": [
        {
          "id": "img-1",
          "position": 0,
          "src": null,
          "alt": "Car detailing service",
          "icon": "🧼",
          "gradient": "linear-gradient(135deg,#CCFBF1,#99F6E0)"
        }
      ],
      "price": {
        "amount": null,
        "min": 3500,
        "max": 6500,
        "priceType": "range"
      },
      "currency": "KES",
      "referencePrice": 8000,
      "location": {
        "country": "Kenya",
        "county": "Nairobi County",
        "city": "Nairobi",
        "area": "",
        "serviceArea": [
          "Nairobi",
          "Kiambu"
        ],
        "format": "local"
      },
      "availability": "by-appointment",
      "sellerId": "seller-shinelab-detailing-demo",
      "specifications": [
        {
          "label": "Package",
          "value": "Interior deep clean + exterior wash and wax",
          "group": "Service",
          "position": 0
        },
        {
          "label": "Included",
          "value": "Vacuum, seat shampoo, dashboard care, tyre dressing",
          "group": "Service",
          "position": 1
        },
        {
          "label": "Duration",
          "value": "3–4 hours",
          "group": "Service",
          "position": 2
        },
        {
          "label": "Availability",
          "value": "Weekdays and Saturdays",
          "group": "Coverage",
          "position": 3
        },
        {
          "label": "Mobile service",
          "value": "Available within the demo area",
          "group": "Coverage",
          "position": 4
        },
        {
          "label": "Price basis",
          "value": "Final price depends on vehicle size (demo)",
          "group": "Support",
          "position": 5
        }
      ],
      "status": "published",
      "createdAt": "2026-09-11",
      "updatedAt": "2026-09-11",
      "offerId": "offer-detailing-shinelab-full-detail"
    },
    {
      "id": "detailing-gleamworks-ceramic",
      "type": "service",
      "name": "GleamWorks Ceramic Coating Package",
      "slug": "gleamworks-ceramic-coating-package",
      "shortDescription": "Demo ceramic coating service including paint preparation.",
      "description": "A workshop coating service: paint preparation with clay bar and polish, then a ceramic layer and an interior wipe-down. One full drop-off day, with a 12-month demo coating warranty.",
      "brand": "",
      "category": "automotive",
      "subcategory": "detailing",
      "tags": [
        "detailing",
        "car-care",
        "premium",
        "kiambu",
        "car"
      ],
      "highlights": [
        "Paint preparation included",
        "Full-day workshop service",
        "12-month demo coating warranty"
      ],
      "images": [
        {
          "id": "img-1",
          "position": 0,
          "src": null,
          "alt": "Ceramic coating service",
          "icon": "✨",
          "gradient": "linear-gradient(135deg,#EDE9FE,#DDD6FE)"
        }
      ],
      "price": {
        "amount": 28000,
        "min": null,
        "max": null,
        "priceType": "fixed"
      },
      "currency": "KES",
      "referencePrice": 35000,
      "location": {
        "country": "Kenya",
        "county": "Kiambu County",
        "city": "Kiambu",
        "area": "",
        "serviceArea": [
          "Nairobi",
          "Kiambu"
        ],
        "format": "local"
      },
      "availability": "by-appointment",
      "sellerId": "seller-gleamworks-auto-care-demo",
      "specifications": [
        {
          "label": "Package",
          "value": "Paint preparation + ceramic coating",
          "group": "Service",
          "position": 0
        },
        {
          "label": "Included",
          "value": "Wash, clay bar, polish, coating, interior wipe-down",
          "group": "Service",
          "position": 1
        },
        {
          "label": "Duration",
          "value": "1 full day (drop-off)",
          "group": "Service",
          "position": 2
        },
        {
          "label": "Availability",
          "value": "Booked slots only",
          "group": "Coverage",
          "position": 3
        },
        {
          "label": "Mobile service",
          "value": "No — workshop only",
          "group": "Coverage",
          "position": 4
        },
        {
          "label": "Price basis",
          "value": "Fixed per vehicle size (demo)",
          "group": "Support",
          "position": 5
        },
        {
          "label": "Demo coating warranty",
          "value": "12 months",
          "group": "Support",
          "position": 6
        }
      ],
      "status": "published",
      "createdAt": "2026-09-01",
      "updatedAt": "2026-09-01",
      "offerId": "offer-detailing-gleamworks-ceramic"
    },
    {
      "id": "luggage-alpine-cabin-22",
      "type": "product",
      "name": "Skyward 22\" Cabin Case — Carry-on",
      "slug": "skyward-22-cabin-case-carry-on",
      "shortDescription": "Carry-on demo case that meets most cabin limits at 2.1 kg empty.",
      "description": "A 38-litre carry-on case in a polycarbonate shell weighing 2.1 kg empty. Four spinner wheels, a combination lock and a five-year demo warranty.",
      "brand": "Skyward",
      "category": "travel",
      "subcategory": "luggage",
      "tags": [
        "luggage",
        "travel",
        "cabin",
        "weekend",
        "budget"
      ],
      "highlights": [
        "Cabin-legal size",
        "2.1 kg empty",
        "Four-wheel spinner"
      ],
      "images": [
        {
          "id": "img-1",
          "position": 0,
          "src": null,
          "alt": "Cabin suitcase",
          "icon": "🧳",
          "gradient": "linear-gradient(135deg,#DCFCE7,#BBF7D0)"
        }
      ],
      "price": {
        "amount": 9900,
        "min": null,
        "max": null,
        "priceType": "fixed"
      },
      "currency": "KES",
      "referencePrice": 13900,
      "location": {
        "country": "Kenya",
        "county": "",
        "city": "",
        "area": "",
        "serviceArea": [],
        "format": "online"
      },
      "availability": "available",
      "sellerId": "seller-roamkit-co-demo",
      "specifications": [
        {
          "label": "Volume",
          "value": "38 litres",
          "group": "Design",
          "position": 0
        },
        {
          "label": "Weight",
          "value": "2.1 kg",
          "group": "Design",
          "position": 1
        },
        {
          "label": "Material",
          "value": "Polycarbonate shell",
          "group": "Design",
          "position": 2
        },
        {
          "label": "Wheels",
          "value": "4-wheel spinner",
          "group": "Features",
          "position": 3
        },
        {
          "label": "Lock",
          "value": "Combination lock",
          "group": "Features",
          "position": 4
        },
        {
          "label": "Warranty",
          "value": "5 years",
          "group": "Support",
          "position": 5
        }
      ],
      "status": "published",
      "createdAt": "2026-09-16",
      "updatedAt": "2026-09-16",
      "offerId": "offer-luggage-alpine-cabin-22"
    },
    {
      "id": "luggage-wander-duffel-45",
      "type": "product",
      "name": "Roamkit 45L Duffel Bag",
      "slug": "roamkit-45l-duffel-bag",
      "shortDescription": "Soft 45-litre demo duffel with a separate shoe compartment.",
      "description": "A soft 45-litre duffel weighing under a kilogram, with a separate shoe compartment and a padlock loop. Carries on a shoulder strap and folds flat when empty.",
      "brand": "Roamkit",
      "category": "travel",
      "subcategory": "luggage",
      "tags": [
        "luggage",
        "travel",
        "budget",
        "weekend",
        "student"
      ],
      "highlights": [
        "Separate shoe pocket",
        "Under 1 kg empty",
        "Folds flat for storage"
      ],
      "images": [
        {
          "id": "img-1",
          "position": 0,
          "src": null,
          "alt": "Travel duffel bag",
          "icon": "🎒",
          "gradient": "linear-gradient(135deg,#CCFBF1,#99F6E0)"
        }
      ],
      "price": {
        "amount": 5600,
        "min": null,
        "max": null,
        "priceType": "fixed"
      },
      "currency": "KES",
      "referencePrice": null,
      "location": {
        "country": "Kenya",
        "county": "",
        "city": "",
        "area": "",
        "serviceArea": [],
        "format": "online"
      },
      "availability": "available",
      "sellerId": "seller-roamkit-co-demo",
      "specifications": [
        {
          "label": "Volume",
          "value": "45 litres",
          "group": "Design",
          "position": 0
        },
        {
          "label": "Weight",
          "value": "0.9 kg",
          "group": "Design",
          "position": 1
        },
        {
          "label": "Material",
          "value": "Recycled polyester (demo)",
          "group": "Design",
          "position": 2
        },
        {
          "label": "Wheels",
          "value": "None — shoulder strap",
          "group": "Features",
          "position": 3
        },
        {
          "label": "Lock",
          "value": "Padlock loop only",
          "group": "Features",
          "position": 4
        },
        {
          "label": "Warranty",
          "value": "2 years",
          "group": "Support",
          "position": 5
        }
      ],
      "status": "published",
      "createdAt": "2026-08-14",
      "updatedAt": "2026-08-14",
      "offerId": null
    },
    {
      "id": "stay-sunrise-apartment-diani",
      "type": "service",
      "name": "Sunrise 2-Bedroom Apartment — Diani",
      "slug": "sunrise-2-bedroom-apartment-diani",
      "shortDescription": "Two-bedroom demo stay near the beach with a balcony and full kitchen.",
      "description": "A two-bedroom apartment sleeping four guests, with a full kitchen, air conditioning, Wi-Fi and parking. Two-night minimum stay, with free cancellation up to seven days before arrival in the demo terms.",
      "brand": "",
      "category": "travel",
      "subcategory": "stays",
      "tags": [
        "stays",
        "family",
        "coastal",
        "weekend",
        "mombasa",
        "holiday"
      ],
      "highlights": [
        "Sleeps four",
        "Walk to the beach",
        "Self-catering kitchen"
      ],
      "images": [
        {
          "id": "img-1",
          "position": 0,
          "src": null,
          "alt": "Coastal apartment",
          "icon": "🏝️",
          "gradient": "linear-gradient(135deg,#CCFBF1,#99F6E0)"
        }
      ],
      "price": {
        "amount": 8500,
        "min": null,
        "max": null,
        "priceType": "per-night"
      },
      "currency": "KES",
      "referencePrice": null,
      "location": {
        "country": "Kenya",
        "county": "Mombasa County",
        "city": "Mombasa",
        "area": "",
        "serviceArea": [
          "Diani"
        ],
        "format": "local"
      },
      "availability": "available",
      "sellerId": "seller-sunrise-stays-demo-host",
      "specifications": [
        {
          "label": "Guests",
          "value": "4 (2 bedrooms)",
          "group": "Stay",
          "position": 0
        },
        {
          "label": "Minimum stay",
          "value": "2 nights",
          "group": "Stay",
          "position": 1
        },
        {
          "label": "Check-in",
          "value": "15:00",
          "group": "Stay",
          "position": 2
        },
        {
          "label": "Included",
          "value": "Wi-Fi, kitchen, air conditioning, parking",
          "group": "Included",
          "position": 3
        },
        {
          "label": "Availability",
          "value": "Weekends and holidays book first (demo)",
          "group": "Coverage",
          "position": 4
        },
        {
          "label": "Cancellation",
          "value": "Free up to 7 days before arrival (demo)",
          "group": "Conditions",
          "position": 5
        }
      ],
      "status": "published",
      "createdAt": "2026-09-14",
      "updatedAt": "2026-09-14",
      "offerId": null
    },
    {
      "id": "service-safariline-trip-planning",
      "type": "service",
      "name": "Safariline Trip Planning Service",
      "slug": "safariline-trip-planning-service",
      "shortDescription": "Demo planning package that builds an itinerary and budget outline.",
      "description": "A planning package that produces a written itinerary, an accommodation shortlist and a cost estimate for your dates. Delivered online within three working days with two revision rounds included.",
      "brand": "",
      "category": "travel",
      "subcategory": "trip-planning",
      "tags": [
        "trip-planning",
        "holiday",
        "professional",
        "online",
        "beginner"
      ],
      "highlights": [
        "Written itinerary and budget",
        "Three-day turnaround",
        "Two revisions included"
      ],
      "images": [
        {
          "id": "img-1",
          "position": 0,
          "src": null,
          "alt": "Travel planning service",
          "icon": "🗺️",
          "gradient": "linear-gradient(135deg,#DBEAFE,#BFDBFE)"
        }
      ],
      "price": {
        "amount": 6000,
        "min": null,
        "max": null,
        "priceType": "fixed"
      },
      "currency": "KES",
      "referencePrice": null,
      "location": {
        "country": "Kenya",
        "county": "",
        "city": "",
        "area": "",
        "serviceArea": [],
        "format": "online"
      },
      "availability": "available",
      "sellerId": "seller-safariline-travel-planning-demo",
      "specifications": [
        {
          "label": "Package",
          "value": "Itinerary + budget outline",
          "group": "Service",
          "position": 0
        },
        {
          "label": "Included",
          "value": "Route plan, accommodation shortlist, cost estimate",
          "group": "Service",
          "position": 1
        },
        {
          "label": "Turnaround",
          "value": "3 working days",
          "group": "Service",
          "position": 2
        },
        {
          "label": "Delivery method",
          "value": "Online (document pack)",
          "group": "Coverage",
          "position": 3
        },
        {
          "label": "Availability",
          "value": "Two revision rounds included (demo)",
          "group": "Coverage",
          "position": 4
        },
        {
          "label": "Contact",
          "value": "Demo interaction only — no real booking or messaging",
          "group": "Support",
          "position": 5
        }
      ],
      "status": "published",
      "createdAt": "2026-08-30",
      "updatedAt": "2026-08-30",
      "offerId": null
    },
    {
      "id": "service-ledgerlite-invoicing",
      "type": "service",
      "name": "LedgerLite Invoicing — Small Teams",
      "slug": "ledgerlite-invoicing-small-teams",
      "shortDescription": "Invoicing and expense plan for teams of up to ten people.",
      "description": "Invoicing and expense tracking for teams of up to ten people, with unlimited invoices and a mobile app. Monthly billing with no contract and a 14-day trial in the demo plan.",
      "brand": "LedgerLite",
      "category": "business",
      "subcategory": "software",
      "tags": [
        "software",
        "invoicing",
        "small-business",
        "business",
        "online"
      ],
      "highlights": [
        "Unlimited invoices",
        "Up to ten users",
        "Cancel anytime (demo)"
      ],
      "images": [
        {
          "id": "img-1",
          "position": 0,
          "src": null,
          "alt": "Invoicing software",
          "icon": "📊",
          "gradient": "linear-gradient(135deg,#F1F5F9,#E2E8F0)"
        }
      ],
      "price": {
        "amount": 2900,
        "min": null,
        "max": null,
        "priceType": "per-month"
      },
      "currency": "KES",
      "referencePrice": null,
      "location": {
        "country": "Kenya",
        "county": "",
        "city": "",
        "area": "",
        "serviceArea": [],
        "format": "online"
      },
      "availability": "available",
      "sellerId": "seller-ledgerlite-demo-provider",
      "specifications": [
        {
          "label": "Users",
          "value": "Up to 10",
          "group": "Plan",
          "position": 0
        },
        {
          "label": "Invoices",
          "value": "Unlimited",
          "group": "Plan",
          "position": 1
        },
        {
          "label": "Contract",
          "value": "Monthly, cancel anytime (demo)",
          "group": "Plan",
          "position": 2
        },
        {
          "label": "Delivery method",
          "value": "Online (browser and mobile app)",
          "group": "Coverage",
          "position": 3
        },
        {
          "label": "Support",
          "value": "Email and chat",
          "group": "Support",
          "position": 4
        },
        {
          "label": "Trial",
          "value": "14 days (demo)",
          "group": "Support",
          "position": 5
        }
      ],
      "status": "published",
      "createdAt": "2026-08-14",
      "updatedAt": "2026-08-14",
      "offerId": null
    },
    {
      "id": "service-nimbuscloud-backup",
      "type": "service",
      "name": "NimbusCloud Backup Pro — 2TB",
      "slug": "nimbuscloud-backup-pro-2tb",
      "shortDescription": "Cloud backup subscription with 30-day version history.",
      "description": "Cloud backup for up to five devices with 2 TB of storage and 30 days of version history. Billed monthly or annually, with email support in the demo plan.",
      "brand": "NimbusCloud",
      "category": "business",
      "subcategory": "software",
      "tags": [
        "cloud",
        "backup",
        "software",
        "business",
        "small-business",
        "online"
      ],
      "highlights": [
        "2 TB storage",
        "Five devices",
        "Annual billing option"
      ],
      "images": [
        {
          "id": "img-1",
          "position": 0,
          "src": null,
          "alt": "Cloud backup service",
          "icon": "☁️",
          "gradient": "linear-gradient(135deg,#E0E7FF,#C7D2FE)"
        }
      ],
      "price": {
        "amount": 1600,
        "min": null,
        "max": null,
        "priceType": "per-month"
      },
      "currency": "KES",
      "referencePrice": 2400,
      "location": {
        "country": "Kenya",
        "county": "",
        "city": "",
        "area": "",
        "serviceArea": [],
        "format": "online"
      },
      "availability": "available",
      "sellerId": "seller-nimbuscloud-demo-provider",
      "specifications": [
        {
          "label": "Storage",
          "value": "2 TB",
          "group": "Plan",
          "position": 0
        },
        {
          "label": "Devices",
          "value": "Up to 5",
          "group": "Plan",
          "position": 1
        },
        {
          "label": "Retention",
          "value": "30-day version history",
          "group": "Plan",
          "position": 2
        },
        {
          "label": "Contract",
          "value": "Monthly or annual (demo)",
          "group": "Plan",
          "position": 3
        },
        {
          "label": "Delivery method",
          "value": "Online (desktop and mobile apps)",
          "group": "Coverage",
          "position": 4
        },
        {
          "label": "Support",
          "value": "Email, 48-hour response (demo)",
          "group": "Support",
          "position": 5
        }
      ],
      "status": "published",
      "createdAt": "2026-09-17",
      "updatedAt": "2026-09-17",
      "offerId": "offer-service-nimbuscloud-backup"
    },
    {
      "id": "service-studionine-web-design",
      "type": "service",
      "name": "StudioNine Website Design Package",
      "slug": "studionine-website-design-package",
      "shortDescription": "Demo five-page website package with one revision round and handover.",
      "description": "A design package covering up to five pages: layout design, build, basic search setup and a handover session. Delivered in ten to fifteen working days with two revision rounds.",
      "brand": "",
      "category": "business",
      "subcategory": "web-design",
      "tags": [
        "web-design",
        "professional",
        "business",
        "startup",
        "nairobi"
      ],
      "highlights": [
        "Five-page package",
        "Two revision rounds",
        "Handover session included"
      ],
      "images": [
        {
          "id": "img-1",
          "position": 0,
          "src": null,
          "alt": "Website design service",
          "icon": "🎨",
          "gradient": "linear-gradient(135deg,#EDE9FE,#DDD6FE)"
        }
      ],
      "price": {
        "amount": null,
        "min": 65000,
        "max": 140000,
        "priceType": "range"
      },
      "currency": "KES",
      "referencePrice": null,
      "location": {
        "country": "Kenya",
        "county": "Nairobi County",
        "city": "Nairobi",
        "area": "",
        "serviceArea": [],
        "format": "local"
      },
      "availability": "on-request",
      "sellerId": "seller-studionine-design-demo",
      "specifications": [
        {
          "label": "Package",
          "value": "Up to 5 pages, content-ready",
          "group": "Service",
          "position": 0
        },
        {
          "label": "Included",
          "value": "Layout design, build, basic SEO setup, handover session",
          "group": "Service",
          "position": 1
        },
        {
          "label": "Timeline",
          "value": "10–15 working days",
          "group": "Service",
          "position": 2
        },
        {
          "label": "Delivery method",
          "value": "Online with two video calls",
          "group": "Coverage",
          "position": 3
        },
        {
          "label": "Availability",
          "value": "Two projects per month (demo)",
          "group": "Coverage",
          "position": 4
        },
        {
          "label": "Revisions",
          "value": "2 rounds included",
          "group": "Support",
          "position": 5
        },
        {
          "label": "Price basis",
          "value": "Final quote depends on page count (demo)",
          "group": "Support",
          "position": 6
        }
      ],
      "status": "published",
      "createdAt": "2026-08-26",
      "updatedAt": "2026-08-26",
      "offerId": null
    },
    {
      "id": "service-bizreg-assist",
      "type": "service",
      "name": "BizReg Business Registration Assist",
      "slug": "bizreg-business-registration-assist",
      "shortDescription": "Demo assistance package for business name registration paperwork.",
      "description": "Assistance with business-name registration paperwork: form filling, a submission checklist and document review. Typically five to ten working days, with official government fees payable separately.",
      "brand": "",
      "category": "business",
      "subcategory": "business-registration",
      "tags": [
        "business-registration",
        "professional",
        "startup",
        "compliance",
        "online"
      ],
      "highlights": [
        "Document checklist included",
        "Five to ten day timeline",
        "Official fees excluded"
      ],
      "images": [
        {
          "id": "img-1",
          "position": 0,
          "src": null,
          "alt": "Business registration service",
          "icon": "📄",
          "gradient": "linear-gradient(135deg,#F1F5F9,#E2E8F0)"
        }
      ],
      "price": {
        "amount": 12500,
        "min": null,
        "max": null,
        "priceType": "fixed"
      },
      "currency": "KES",
      "referencePrice": null,
      "location": {
        "country": "Kenya",
        "county": "",
        "city": "",
        "area": "",
        "serviceArea": [],
        "format": "nationwide"
      },
      "availability": "available",
      "sellerId": "seller-bizreg-assist-demo",
      "specifications": [
        {
          "label": "Package",
          "value": "Name search + registration paperwork",
          "group": "Service",
          "position": 0
        },
        {
          "label": "Included",
          "value": "Form filling, submission checklist, document review",
          "group": "Service",
          "position": 1
        },
        {
          "label": "Timeline",
          "value": "5–10 working days (demo)",
          "group": "Service",
          "position": 2
        },
        {
          "label": "Delivery method",
          "value": "Online and phone (demo)",
          "group": "Coverage",
          "position": 3
        },
        {
          "label": "Government fees",
          "value": "Not included — payable separately (demo)",
          "group": "Support",
          "position": 4
        }
      ],
      "status": "published",
      "createdAt": "2026-08-09",
      "updatedAt": "2026-08-09",
      "offerId": null
    },
    {
      "id": "course-spanish-for-travellers",
      "type": "service",
      "name": "Spanish for Travellers — 6-Week Course",
      "slug": "spanish-for-travellers-6-week-course",
      "shortDescription": "Live online beginner course focused on travel situations.",
      "description": "A six-week live online course for beginners, with two sessions a week and a maximum of eight learners. Focused on travel situations such as directions, bookings and ordering food.",
      "brand": "",
      "category": "education",
      "subcategory": "languages",
      "tags": [
        "language",
        "course",
        "travel",
        "beginner",
        "online",
        "student"
      ],
      "highlights": [
        "Travel-focused vocabulary",
        "Maximum eight learners",
        "Certificate on completion (demo)"
      ],
      "images": [
        {
          "id": "img-1",
          "position": 0,
          "src": null,
          "alt": "Language course",
          "icon": "🗣️",
          "gradient": "linear-gradient(135deg,#F3E8FF,#E9D5FF)"
        }
      ],
      "price": {
        "amount": 12400,
        "min": null,
        "max": null,
        "priceType": "fixed"
      },
      "currency": "KES",
      "referencePrice": 15500,
      "location": {
        "country": "Kenya",
        "county": "",
        "city": "",
        "area": "",
        "serviceArea": [],
        "format": "online"
      },
      "availability": "limited",
      "sellerId": "seller-lingua-academy-demo",
      "specifications": [
        {
          "label": "Format",
          "value": "Live online sessions",
          "group": "Course",
          "position": 0
        },
        {
          "label": "Duration",
          "value": "6 weeks, 2 sessions per week",
          "group": "Course",
          "position": 1
        },
        {
          "label": "Level",
          "value": "Beginner (A1–A2)",
          "group": "Course",
          "position": 2
        },
        {
          "label": "Class size",
          "value": "Maximum 8 learners",
          "group": "Course",
          "position": 3
        },
        {
          "label": "Certificate",
          "value": "On completion (demo)",
          "group": "Course",
          "position": 4
        },
        {
          "label": "Delivery method",
          "value": "Online (video call)",
          "group": "Coverage",
          "position": 5
        }
      ],
      "status": "published",
      "createdAt": "2026-09-11",
      "updatedAt": "2026-09-11",
      "offerId": "offer-course-spanish-for-travellers"
    },
    {
      "id": "course-data-foundations",
      "type": "service",
      "name": "Data Foundations Certificate",
      "slug": "data-foundations-certificate",
      "shortDescription": "Self-paced online certificate covering spreadsheets, SQL and reporting basics.",
      "description": "A self-paced certificate covering spreadsheets, SQL and reporting basics across six modules. Each module includes a live mentor session, and a certificate is issued on completion.",
      "brand": "",
      "category": "education",
      "subcategory": "certificates",
      "tags": [
        "certificate",
        "data",
        "professional",
        "online",
        "business",
        "student"
      ],
      "highlights": [
        "Six modules with mentors",
        "Self-paced",
        "Certificate on completion (demo)"
      ],
      "images": [
        {
          "id": "img-1",
          "position": 0,
          "src": null,
          "alt": "Data certificate course",
          "icon": "📈",
          "gradient": "linear-gradient(135deg,#DBEAFE,#BFDBFE)"
        }
      ],
      "price": {
        "amount": 18900,
        "min": null,
        "max": null,
        "priceType": "fixed"
      },
      "currency": "KES",
      "referencePrice": 22500,
      "location": {
        "country": "Kenya",
        "county": "",
        "city": "",
        "area": "",
        "serviceArea": [],
        "format": "online"
      },
      "availability": "available",
      "sellerId": "seller-northline-learning-demo",
      "specifications": [
        {
          "label": "Format",
          "value": "Self-paced online",
          "group": "Course",
          "position": 0
        },
        {
          "label": "Duration",
          "value": "Roughly 8 weeks part-time",
          "group": "Course",
          "position": 1
        },
        {
          "label": "Level",
          "value": "Beginner to intermediate",
          "group": "Course",
          "position": 2
        },
        {
          "label": "Modules",
          "value": "6 modules, 1 mentor session each",
          "group": "Course",
          "position": 3
        },
        {
          "label": "Certificate",
          "value": "On completion (demo)",
          "group": "Course",
          "position": 4
        },
        {
          "label": "Delivery method",
          "value": "Online (recorded + live mentor)",
          "group": "Coverage",
          "position": 5
        }
      ],
      "status": "published",
      "createdAt": "2026-09-06",
      "updatedAt": "2026-09-06",
      "offerId": "offer-course-data-foundations"
    },
    {
      "id": "service-mindpath-maths-tutoring",
      "type": "service",
      "name": "MindPath Maths Tutoring — Secondary",
      "slug": "mindpath-maths-tutoring-secondary",
      "shortDescription": "Demo tutoring sessions for secondary school maths, in person or online.",
      "description": "One-to-one secondary maths tutoring in 90-minute sessions, at home within the demo service area or online. Weekday evenings and Saturdays, with a ten-session package available.",
      "brand": "",
      "category": "education",
      "subcategory": "tutoring",
      "tags": [
        "tutoring",
        "student",
        "family",
        "nairobi",
        "education"
      ],
      "highlights": [
        "90-minute sessions",
        "Ten-session package available",
        "Evening and weekend slots"
      ],
      "images": [
        {
          "id": "img-1",
          "position": 0,
          "src": null,
          "alt": "Maths tutoring service",
          "icon": "📐",
          "gradient": "linear-gradient(135deg,#DCFCE7,#BBF7D0)"
        }
      ],
      "price": {
        "amount": 2200,
        "min": null,
        "max": null,
        "priceType": "per-session"
      },
      "currency": "KES",
      "referencePrice": null,
      "location": {
        "country": "Kenya",
        "county": "Nairobi County",
        "city": "Nairobi",
        "area": "",
        "serviceArea": [
          "Nairobi"
        ],
        "format": "local"
      },
      "availability": "by-appointment",
      "sellerId": "seller-mindpath-tutors-demo",
      "specifications": [
        {
          "label": "Format",
          "value": "One-to-one, in person or online",
          "group": "Service",
          "position": 0
        },
        {
          "label": "Session length",
          "value": "90 minutes",
          "group": "Service",
          "position": 1
        },
        {
          "label": "Subjects",
          "value": "Secondary maths (demo syllabus coverage)",
          "group": "Service",
          "position": 2
        },
        {
          "label": "Availability",
          "value": "Weekday evenings and Saturdays",
          "group": "Coverage",
          "position": 3
        },
        {
          "label": "Package",
          "value": "10-session package available (demo)",
          "group": "Support",
          "position": 4
        }
      ],
      "status": "published",
      "createdAt": "2026-08-19",
      "updatedAt": "2026-08-19",
      "offerId": null
    },
    {
      "id": "service-safedrive-driving-lessons",
      "type": "service",
      "name": "SafeDrive Driving Lessons",
      "slug": "safedrive-driving-lessons",
      "shortDescription": "Demo driving lessons with a package option and instructor-led practice.",
      "description": "In-car driving lessons of 45 minutes in a dual-control vehicle, covering town driving, parking and road rules. Available daily except Sunday, with a twelve-lesson package option.",
      "brand": "",
      "category": "education",
      "subcategory": "driving",
      "tags": [
        "driving",
        "lessons",
        "beginner",
        "kisumu",
        "education"
      ],
      "highlights": [
        "45-minute lessons",
        "Twelve-lesson package",
        "Dual-control vehicle"
      ],
      "images": [
        {
          "id": "img-1",
          "position": 0,
          "src": null,
          "alt": "Driving lessons",
          "icon": "🚦",
          "gradient": "linear-gradient(135deg,#FEF3C7,#FDE68A)"
        }
      ],
      "price": {
        "amount": null,
        "min": 1800,
        "max": 2000,
        "priceType": "per-lesson"
      },
      "currency": "KES",
      "referencePrice": null,
      "location": {
        "country": "Kenya",
        "county": "Kisumu County",
        "city": "Kisumu",
        "area": "",
        "serviceArea": [
          "Kisumu"
        ],
        "format": "local"
      },
      "availability": "by-appointment",
      "sellerId": "seller-safedrive-school-demo",
      "specifications": [
        {
          "label": "Format",
          "value": "In-car lessons with an instructor",
          "group": "Service",
          "position": 0
        },
        {
          "label": "Lesson length",
          "value": "45 minutes",
          "group": "Service",
          "position": 1
        },
        {
          "label": "Package",
          "value": "12-lesson package available (demo)",
          "group": "Service",
          "position": 2
        },
        {
          "label": "Availability",
          "value": "Daily except Sunday",
          "group": "Coverage",
          "position": 3
        },
        {
          "label": "Vehicle",
          "value": "Manual demo vehicle with dual controls",
          "group": "Support",
          "position": 4
        }
      ],
      "status": "published",
      "createdAt": "2026-08-02",
      "updatedAt": "2026-08-02",
      "offerId": null
    },
    {
      "id": "fashion-trailrun-sneaker",
      "type": "product",
      "name": "Stridewell Everyday Sneaker",
      "slug": "stridewell-everyday-sneaker",
      "shortDescription": "Lightweight everyday demo sneaker with a cushioned midsole.",
      "description": "An everyday sneaker with a knit upper and a cushioned EVA midsole, weighing 268 g in size 42. Available in sizes 38 to 47 with 30-day demo returns.",
      "brand": "Stridewell",
      "category": "fashion",
      "subcategory": "footwear",
      "tags": [
        "footwear",
        "everyday",
        "budget",
        "student",
        "lightweight"
      ],
      "highlights": [
        "Lightweight knit upper",
        "Sizes 38–47",
        "30-day demo returns"
      ],
      "images": [
        {
          "id": "img-1",
          "position": 0,
          "src": null,
          "alt": "Everyday sneaker",
          "icon": "👟",
          "gradient": "linear-gradient(135deg,#F1F5F9,#E2E8F0)"
        }
      ],
      "price": {
        "amount": null,
        "min": 5200,
        "max": 6400,
        "priceType": "range"
      },
      "currency": "KES",
      "referencePrice": null,
      "location": {
        "country": "Kenya",
        "county": "",
        "city": "",
        "area": "",
        "serviceArea": [],
        "format": "online"
      },
      "availability": "available",
      "sellerId": "seller-stride-house-demo",
      "specifications": [
        {
          "label": "Weight",
          "value": "268 g (size 42)",
          "group": "Product",
          "position": 0
        },
        {
          "label": "Upper",
          "value": "Recycled knit (demo)",
          "group": "Product",
          "position": 1
        },
        {
          "label": "Sole",
          "value": "Cushioned EVA midsole",
          "group": "Product",
          "position": 2
        },
        {
          "label": "Sizes",
          "value": "38 – 47",
          "group": "Product",
          "position": 3
        },
        {
          "label": "Returns",
          "value": "30 days (demo)",
          "group": "Support",
          "position": 4
        }
      ],
      "status": "published",
      "createdAt": "2026-08-01",
      "updatedAt": "2026-08-01",
      "offerId": null
    },
    {
      "id": "fashion-coastline-overshirt",
      "type": "product",
      "name": "Coastline Linen Overshirt",
      "slug": "coastline-linen-overshirt",
      "shortDescription": "Mid-weight linen overshirt with a relaxed cut and four pockets.",
      "description": "A relaxed linen-cotton overshirt with four pockets and a mid-weight feel. Machine washable and available in sizes XS to XXL.",
      "brand": "Coastline",
      "category": "fashion",
      "subcategory": "clothing",
      "tags": [
        "clothing",
        "everyday",
        "linen",
        "budget"
      ],
      "highlights": [
        "Breathable linen blend",
        "Four pockets",
        "Relaxed cut"
      ],
      "images": [
        {
          "id": "img-1",
          "position": 0,
          "src": null,
          "alt": "Linen overshirt",
          "icon": "👕",
          "gradient": "linear-gradient(135deg,#FFE4E6,#FECDD3)"
        }
      ],
      "price": {
        "amount": 4900,
        "min": null,
        "max": null,
        "priceType": "fixed"
      },
      "currency": "KES",
      "referencePrice": null,
      "location": {
        "country": "Kenya",
        "county": "",
        "city": "",
        "area": "",
        "serviceArea": [],
        "format": "online"
      },
      "availability": "available",
      "sellerId": "seller-coastline-demo-brand-store",
      "specifications": [
        {
          "label": "Material",
          "value": "62% linen, 38% cotton (demo)",
          "group": "Product",
          "position": 0
        },
        {
          "label": "Fit",
          "value": "Relaxed",
          "group": "Product",
          "position": 1
        },
        {
          "label": "Sizes",
          "value": "XS – XXL",
          "group": "Product",
          "position": 2
        },
        {
          "label": "Care",
          "value": "Machine wash cold",
          "group": "Product",
          "position": 3
        },
        {
          "label": "Returns",
          "value": "30 days (demo)",
          "group": "Support",
          "position": 4
        }
      ],
      "status": "published",
      "createdAt": "2026-07-28",
      "updatedAt": "2026-07-28",
      "offerId": null
    },
    {
      "id": "bag-urbansling-laptop-backpack",
      "type": "product",
      "name": "UrbanSling 15\" Laptop Backpack",
      "slug": "urbansling-15-laptop-backpack",
      "shortDescription": "Padded 15-inch laptop backpack with a water-resistant base.",
      "description": "A 22-litre backpack with a padded sleeve for notebooks up to 15.6 inches and a water-resistant base. Weighs 0.8 kg and carries study or work gear comfortably.",
      "brand": "UrbanSling",
      "category": "fashion",
      "subcategory": "bags",
      "tags": [
        "bags",
        "laptop",
        "student",
        "remote-work",
        "travel",
        "nairobi"
      ],
      "highlights": [
        "Padded 15.6\" laptop sleeve",
        "22-litre capacity",
        "Water-resistant base"
      ],
      "images": [
        {
          "id": "img-1",
          "position": 0,
          "src": null,
          "alt": "Laptop backpack",
          "icon": "🎒",
          "gradient": "linear-gradient(135deg,#DBEAFE,#BFDBFE)"
        }
      ],
      "price": {
        "amount": 4200,
        "min": null,
        "max": null,
        "priceType": "fixed"
      },
      "currency": "KES",
      "referencePrice": null,
      "location": {
        "country": "Kenya",
        "county": "Nairobi County",
        "city": "Nairobi",
        "area": "",
        "serviceArea": [],
        "format": "local"
      },
      "availability": "available",
      "sellerId": "seller-urbansling-demo-brand-store",
      "specifications": [
        {
          "label": "Laptop size",
          "value": "Fits up to 15.6 inches",
          "group": "Product",
          "position": 0
        },
        {
          "label": "Volume",
          "value": "22 litres",
          "group": "Product",
          "position": 1
        },
        {
          "label": "Weight",
          "value": "0.8 kg",
          "group": "Product",
          "position": 2
        },
        {
          "label": "Material",
          "value": "Water-resistant polyester (demo)",
          "group": "Product",
          "position": 3
        },
        {
          "label": "Warranty",
          "value": "2 years",
          "group": "Support",
          "position": 4
        }
      ],
      "status": "published",
      "createdAt": "2026-09-13",
      "updatedAt": "2026-09-13",
      "offerId": null
    },
    {
      "id": "jacket-highland-rain-shell",
      "type": "product",
      "name": "Mistwall Rain Shell Jacket",
      "slug": "mistwall-rain-shell-jacket",
      "shortDescription": "Packable demo rain jacket with taped seams.",
      "description": "A packable rain shell with taped seams and a 10,000 mm demo waterproof rating. Folds into its own pocket, weighs 410 g and comes in sizes S to XXL.",
      "brand": "Mistwall",
      "category": "fashion",
      "subcategory": "outerwear",
      "tags": [
        "clothing",
        "outerwear",
        "travel",
        "rain",
        "eldoret"
      ],
      "highlights": [
        "Taped seams",
        "Packs into its own pocket",
        "Light 410 g shell"
      ],
      "images": [
        {
          "id": "img-1",
          "position": 0,
          "src": null,
          "alt": "Rain shell jacket",
          "icon": "🧥",
          "gradient": "linear-gradient(135deg,#E0E7FF,#C7D2FE)"
        }
      ],
      "price": {
        "amount": 7500,
        "min": null,
        "max": null,
        "priceType": "fixed"
      },
      "currency": "KES",
      "referencePrice": null,
      "location": {
        "country": "Kenya",
        "county": "Uasin Gishu County",
        "city": "Eldoret",
        "area": "",
        "serviceArea": [],
        "format": "local"
      },
      "availability": "available",
      "sellerId": "seller-mistwall-outfitters-demo",
      "specifications": [
        {
          "label": "Waterproof rating",
          "value": "10,000 mm (demo)",
          "group": "Product",
          "position": 0
        },
        {
          "label": "Material",
          "value": "Coated polyester with taped seams",
          "group": "Product",
          "position": 1
        },
        {
          "label": "Packed size",
          "value": "Folds into its own pocket",
          "group": "Product",
          "position": 2
        },
        {
          "label": "Weight",
          "value": "410 g",
          "group": "Product",
          "position": 3
        },
        {
          "label": "Sizes",
          "value": "S – XXL",
          "group": "Product",
          "position": 4
        },
        {
          "label": "Warranty",
          "value": "2 years",
          "group": "Support",
          "position": 5
        }
      ],
      "status": "published",
      "createdAt": "2026-08-11",
      "updatedAt": "2026-08-11",
      "offerId": null
    },
    {
      "id": "service-fibermax-fibre-300",
      "type": "service",
      "name": "FiberMax Home 300 — Fibre Plan",
      "slug": "fibermax-home-300-fibre-plan",
      "shortDescription": "300 Mbps home fibre plan with a router included and a demo contract term.",
      "description": "A 300 Mbps download and 150 Mbps upload fibre plan with a router included and a 12-month demo contract. Support runs seven days a week and installation is booked within five days.",
      "brand": "FiberMax",
      "category": "services",
      "subcategory": "internet",
      "tags": [
        "internet",
        "broadband",
        "remote-work",
        "family",
        "fast",
        "online"
      ],
      "highlights": [
        "300 Mbps download",
        "Router included (demo)",
        "Five-day installation window"
      ],
      "images": [
        {
          "id": "img-1",
          "position": 0,
          "src": null,
          "alt": "Home fibre broadband",
          "icon": "🛜",
          "gradient": "linear-gradient(135deg,#E0E7FF,#C7D2FE)"
        }
      ],
      "price": {
        "amount": 3400,
        "min": null,
        "max": null,
        "priceType": "per-month"
      },
      "currency": "KES",
      "referencePrice": 4300,
      "location": {
        "country": "Kenya",
        "county": "",
        "city": "",
        "area": "",
        "serviceArea": [],
        "format": "nationwide"
      },
      "availability": "available",
      "sellerId": "seller-fibermax-demo-provider",
      "specifications": [
        {
          "label": "Download",
          "value": "300 Mbps",
          "group": "Plan",
          "position": 0
        },
        {
          "label": "Upload",
          "value": "150 Mbps",
          "group": "Plan",
          "position": 1
        },
        {
          "label": "Contract",
          "value": "12 months (demo)",
          "group": "Plan",
          "position": 2
        },
        {
          "label": "Setup fee",
          "value": "No setup fee in this demo",
          "group": "Plan",
          "position": 3
        },
        {
          "label": "Availability",
          "value": "Installation booked within 5 days (demo)",
          "group": "Coverage",
          "position": 4
        },
        {
          "label": "Support",
          "value": "Phone and WhatsApp, 7 days (demo)",
          "group": "Support",
          "position": 5
        }
      ],
      "status": "published",
      "createdAt": "2026-09-09",
      "updatedAt": "2026-09-09",
      "offerId": "offer-service-fibermax-fibre-300"
    },
    {
      "id": "service-netlink-install-visit",
      "type": "service",
      "name": "MeshPoint Installation & Setup Visit",
      "slug": "meshpoint-installation-setup-visit",
      "shortDescription": "Demo installation visit covering cabling, router setup and a speed check.",
      "description": "An installation visit covering cabling, router setup, Wi-Fi naming and a speed check, taking about 90 minutes. Same-day or next-day appointments from Monday to Saturday.",
      "brand": "MeshPoint",
      "category": "services",
      "subcategory": "internet-installation",
      "tags": [
        "internet",
        "installation",
        "nairobi",
        "fast",
        "remote-work"
      ],
      "highlights": [
        "Same or next day visit",
        "Router setup included",
        "Speed check after install"
      ],
      "images": [
        {
          "id": "img-1",
          "position": 0,
          "src": null,
          "alt": "Internet installation service",
          "icon": "🔧",
          "gradient": "linear-gradient(135deg,#CCFBF1,#99F6E0)"
        }
      ],
      "price": {
        "amount": 2500,
        "min": null,
        "max": null,
        "priceType": "fixed"
      },
      "currency": "KES",
      "referencePrice": null,
      "location": {
        "country": "Kenya",
        "county": "Nairobi County",
        "city": "Nairobi",
        "area": "",
        "serviceArea": [
          "Nairobi",
          "Thika",
          "Kiambu"
        ],
        "format": "local"
      },
      "availability": "by-appointment",
      "sellerId": "seller-meshpoint-installations-demo",
      "specifications": [
        {
          "label": "Included",
          "value": "Cable routing, router setup, Wi-Fi name and password, speed check",
          "group": "Service",
          "position": 0
        },
        {
          "label": "Turnaround",
          "value": "Same day or next day (demo)",
          "group": "Service",
          "position": 1
        },
        {
          "label": "Duration",
          "value": "90 minutes typical",
          "group": "Service",
          "position": 2
        },
        {
          "label": "Availability",
          "value": "Monday to Saturday",
          "group": "Coverage",
          "position": 3
        },
        {
          "label": "Materials",
          "value": "Basic cabling included (demo)",
          "group": "Support",
          "position": 4
        }
      ],
      "status": "published",
      "createdAt": "2026-08-25",
      "updatedAt": "2026-08-25",
      "offerId": null
    },
    {
      "id": "service-fixpoint-phone-repair",
      "type": "service",
      "name": "FixPoint Phone Screen Replacement",
      "slug": "fixpoint-phone-screen-replacement",
      "shortDescription": "Demo screen replacement service, priced by phone model with a 6-month warranty.",
      "description": "Screen replacement for common phone models, including testing and cleaning, usually finished within two to four hours. Replaced parts carry a six-month demo warranty.",
      "brand": "",
      "category": "services",
      "subcategory": "repairs",
      "tags": [
        "repair",
        "smartphone",
        "fast",
        "nairobi",
        "student"
      ],
      "highlights": [
        "Two to four hour turnaround",
        "Six-month demo warranty",
        "Quote depends on model"
      ],
      "images": [
        {
          "id": "img-1",
          "position": 0,
          "src": null,
          "alt": "Phone repair service",
          "icon": "📱",
          "gradient": "linear-gradient(135deg,#F1F5F9,#E2E8F0)"
        }
      ],
      "price": {
        "amount": null,
        "min": 3500,
        "max": 24000,
        "priceType": "range"
      },
      "currency": "KES",
      "referencePrice": 4500,
      "location": {
        "country": "Kenya",
        "county": "Nairobi County",
        "city": "Nairobi",
        "area": "",
        "serviceArea": [
          "Nairobi"
        ],
        "format": "local"
      },
      "availability": "available",
      "sellerId": "seller-fixpoint-repairs-demo",
      "specifications": [
        {
          "label": "Included",
          "value": "Screen replacement, testing, cleaning",
          "group": "Service",
          "position": 0
        },
        {
          "label": "Turnaround",
          "value": "2–4 hours for common demo models",
          "group": "Service",
          "position": 1
        },
        {
          "label": "Warranty",
          "value": "6 months on the replaced part (demo)",
          "group": "Service",
          "position": 2
        },
        {
          "label": "Availability",
          "value": "Monday to Saturday",
          "group": "Coverage",
          "position": 3
        },
        {
          "label": "Price basis",
          "value": "Final price depends on phone model (demo)",
          "group": "Support",
          "position": 4
        }
      ],
      "status": "published",
      "createdAt": "2026-08-20",
      "updatedAt": "2026-08-20",
      "offerId": "offer-service-fixpoint-phone-repair"
    },
    {
      "id": "service-techbench-laptop-repair",
      "type": "service",
      "name": "TechBench Laptop Diagnostics & Repair",
      "slug": "techbench-laptop-diagnostics-repair",
      "shortDescription": "Demo diagnostics and repair service for laptops, quoted after inspection.",
      "description": "Diagnostics first: the workshop inspects the machine, quotes the repair and only proceeds once you approve. Typical turnaround is 24 to 72 hours with a three-month warranty on repaired parts.",
      "brand": "",
      "category": "services",
      "subcategory": "repairs",
      "tags": [
        "repair",
        "laptop",
        "student",
        "business",
        "nairobi",
        "remote-work"
      ],
      "highlights": [
        "Diagnostics before repair",
        "Three-day typical turnaround",
        "Courier option in Nairobi"
      ],
      "images": [
        {
          "id": "img-1",
          "position": 0,
          "src": null,
          "alt": "Laptop repair service",
          "icon": "🛠️",
          "gradient": "linear-gradient(135deg,#E2E8F0,#CBD5E1)"
        }
      ],
      "price": {
        "amount": null,
        "min": 1500,
        "max": 18000,
        "priceType": "range"
      },
      "currency": "KES",
      "referencePrice": null,
      "location": {
        "country": "Kenya",
        "county": "Nairobi County",
        "city": "Nairobi",
        "area": "",
        "serviceArea": [
          "Nairobi"
        ],
        "format": "local"
      },
      "availability": "on-request",
      "sellerId": "seller-techbench-demo",
      "specifications": [
        {
          "label": "Included",
          "value": "Diagnostics, quote, repair if approved",
          "group": "Service",
          "position": 0
        },
        {
          "label": "Turnaround",
          "value": "24–72 hours depending on parts (demo)",
          "group": "Service",
          "position": 1
        },
        {
          "label": "Warranty",
          "value": "3 months on repaired parts (demo)",
          "group": "Service",
          "position": 2
        },
        {
          "label": "Availability",
          "value": "Monday to Saturday",
          "group": "Coverage",
          "position": 3
        },
        {
          "label": "Price basis",
          "value": "Quote after diagnostics (demo)",
          "group": "Support",
          "position": 4
        }
      ],
      "status": "published",
      "createdAt": "2026-08-17",
      "updatedAt": "2026-08-17",
      "offerId": null
    },
    {
      "id": "service-sparklehome-deep-clean",
      "type": "service",
      "name": "SparkleHome Deep Cleaning",
      "slug": "sparklehome-deep-cleaning",
      "shortDescription": "Demo home deep-cleaning package priced by house size.",
      "description": "A full home deep clean covering the kitchen, bathrooms, floors, windows and dusting, with a team of two to four cleaners. Cleaning supplies are included and bookings are made two days ahead.",
      "brand": "",
      "category": "services",
      "subcategory": "cleaning",
      "tags": [
        "cleaning",
        "home",
        "family",
        "nairobi",
        "professional"
      ],
      "highlights": [
        "Supplies included",
        "Team of two to four",
        "Booking two days ahead"
      ],
      "images": [
        {
          "id": "img-1",
          "position": 0,
          "src": null,
          "alt": "Home cleaning service",
          "icon": "🧽",
          "gradient": "linear-gradient(135deg,#CCFBF1,#99F6E0)"
        }
      ],
      "price": {
        "amount": null,
        "min": 4500,
        "max": 14000,
        "priceType": "range"
      },
      "currency": "KES",
      "referencePrice": 9200,
      "location": {
        "country": "Kenya",
        "county": "Nairobi County",
        "city": "Nairobi",
        "area": "",
        "serviceArea": [
          "Nairobi",
          "Kiambu",
          "Machakos"
        ],
        "format": "local"
      },
      "availability": "by-appointment",
      "sellerId": "seller-sparklehome-cleaning-demo",
      "specifications": [
        {
          "label": "Package",
          "value": "Full home deep clean",
          "group": "Service",
          "position": 0
        },
        {
          "label": "Included",
          "value": "Kitchen, bathrooms, floors, windows, dusting",
          "group": "Service",
          "position": 1
        },
        {
          "label": "Team size",
          "value": "2–4 cleaners (demo)",
          "group": "Service",
          "position": 2
        },
        {
          "label": "Duration",
          "value": "4–7 hours depending on size",
          "group": "Service",
          "position": 3
        },
        {
          "label": "Availability",
          "value": "Book 2 days ahead (demo)",
          "group": "Coverage",
          "position": 4
        },
        {
          "label": "Supplies",
          "value": "Cleaning supplies included (demo)",
          "group": "Support",
          "position": 5
        }
      ],
      "status": "published",
      "createdAt": "2026-09-08",
      "updatedAt": "2026-09-08",
      "offerId": "offer-service-sparklehome-deep-clean"
    },
    {
      "id": "service-movemate-house-moving",
      "type": "service",
      "name": "MoveMate House Moving Service",
      "slug": "movemate-house-moving-service",
      "shortDescription": "Demo moving service with packing, transport and unloading options.",
      "description": "A moving service with a truck, a crew of three and basic wrapping materials, with packing available as an add-on. Quoted on distance, volume and floor access.",
      "brand": "",
      "category": "services",
      "subcategory": "moving",
      "tags": [
        "moving",
        "home",
        "family",
        "nairobi",
        "professional"
      ],
      "highlights": [
        "Crew of three",
        "Packing add-on available",
        "Quote based on distance and volume"
      ],
      "images": [
        {
          "id": "img-1",
          "position": 0,
          "src": null,
          "alt": "House moving service",
          "icon": "🚚",
          "gradient": "linear-gradient(135deg,#DBEAFE,#BFDBFE)"
        }
      ],
      "price": {
        "amount": null,
        "min": 8000,
        "max": 55000,
        "priceType": "range"
      },
      "currency": "KES",
      "referencePrice": null,
      "location": {
        "country": "Kenya",
        "county": "Nairobi County",
        "city": "Nairobi",
        "area": "",
        "serviceArea": [
          "Nairobi"
        ],
        "format": "local"
      },
      "availability": "on-request",
      "sellerId": "seller-movemate-movers-demo",
      "specifications": [
        {
          "label": "Package",
          "value": "Transport and loading, packing optional",
          "group": "Service",
          "position": 0
        },
        {
          "label": "Included",
          "value": "Truck, crew of 3, basic wrapping materials",
          "group": "Service",
          "position": 1
        },
        {
          "label": "Duration",
          "value": "Half day for a 2-bedroom home (demo estimate)",
          "group": "Service",
          "position": 2
        },
        {
          "label": "Availability",
          "value": "Weekdays and Saturdays",
          "group": "Coverage",
          "position": 3
        },
        {
          "label": "Price basis",
          "value": "Distance, volume and floor access (demo)",
          "group": "Support",
          "position": 4
        }
      ],
      "status": "published",
      "createdAt": "2026-08-07",
      "updatedAt": "2026-08-07",
      "offerId": null
    },
    {
      "id": "service-lightframe-photography",
      "type": "service",
      "name": "Lightframe Event Photography",
      "slug": "lightframe-event-photography",
      "shortDescription": "Demo event photography package with edited digital delivery.",
      "description": "Event photography with four or eight hours of coverage, colour editing and an online gallery delivered within ten working days. Booking at least two weeks ahead is recommended.",
      "brand": "",
      "category": "services",
      "subcategory": "photography",
      "tags": [
        "photography",
        "event",
        "professional",
        "naivasha",
        "family"
      ],
      "highlights": [
        "Half-day or full-day coverage",
        "Edited online gallery",
        "Two-week booking notice"
      ],
      "images": [
        {
          "id": "img-1",
          "position": 0,
          "src": null,
          "alt": "Event photography service",
          "icon": "📷",
          "gradient": "linear-gradient(135deg,#EDE9FE,#DDD6FE)"
        }
      ],
      "price": {
        "amount": null,
        "min": 18000,
        "max": 65000,
        "priceType": "range"
      },
      "currency": "KES",
      "referencePrice": null,
      "location": {
        "country": "Kenya",
        "county": "Nakuru County",
        "city": "Naivasha",
        "area": "",
        "serviceArea": [
          "Nairobi",
          "Naivasha"
        ],
        "format": "local"
      },
      "availability": "available",
      "sellerId": "seller-lightframe-studio-demo",
      "specifications": [
        {
          "label": "Package",
          "value": "Half-day or full-day event coverage",
          "group": "Service",
          "position": 0
        },
        {
          "label": "Included",
          "value": "Coverage, colour editing, online gallery",
          "group": "Service",
          "position": 1
        },
        {
          "label": "Duration",
          "value": "4 or 8 hours of coverage",
          "group": "Service",
          "position": 2
        },
        {
          "label": "Availability",
          "value": "Book at least 2 weeks ahead (demo)",
          "group": "Coverage",
          "position": 3
        },
        {
          "label": "Delivery",
          "value": "Online gallery within 10 working days (demo)",
          "group": "Support",
          "position": 4
        },
        {
          "label": "Travel",
          "value": "Travel beyond the demo area quoted separately",
          "group": "Support",
          "position": 5
        }
      ],
      "status": "published",
      "createdAt": "2026-09-04",
      "updatedAt": "2026-09-04",
      "offerId": null
    },
    {
      "id": "service-fittrack-personal-training",
      "type": "service",
      "name": "FitTrack Personal Training — 10 Sessions",
      "slug": "fittrack-personal-training-10-sessions",
      "shortDescription": "Demo personal training package with a plan review and progress check-ins.",
      "description": "A ten-session personal training package in 60-minute sessions, including a plan review, two progress check-ins and a demo plan sheet. Early-morning and evening slots within the demo service area.",
      "brand": "",
      "category": "services",
      "subcategory": "fitness",
      "tags": [
        "fitness",
        "health",
        "professional",
        "nairobi",
        "package"
      ],
      "highlights": [
        "Ten-session package",
        "Two progress check-ins",
        "Plan sheet included (demo)"
      ],
      "images": [
        {
          "id": "img-1",
          "position": 0,
          "src": null,
          "alt": "Personal training service",
          "icon": "🏋️",
          "gradient": "linear-gradient(135deg,#FFE4E6,#FECDD3)"
        }
      ],
      "price": {
        "amount": 1500,
        "min": null,
        "max": null,
        "priceType": "per-session"
      },
      "currency": "KES",
      "referencePrice": 18000,
      "location": {
        "country": "Kenya",
        "county": "Nairobi County",
        "city": "Nairobi",
        "area": "",
        "serviceArea": [
          "Nairobi"
        ],
        "format": "local"
      },
      "availability": "available",
      "sellerId": "seller-fittrack-coaching-demo",
      "specifications": [
        {
          "label": "Package",
          "value": "10 sessions (demo)",
          "group": "Service",
          "position": 0
        },
        {
          "label": "Session length",
          "value": "60 minutes",
          "group": "Service",
          "position": 1
        },
        {
          "label": "Included",
          "value": "Plan review, two progress check-ins, demo plan sheet",
          "group": "Service",
          "position": 2
        },
        {
          "label": "Availability",
          "value": "Early mornings and evenings",
          "group": "Coverage",
          "position": 3
        },
        {
          "label": "Price basis",
          "value": "Package price shown per session (demo)",
          "group": "Support",
          "position": 4
        }
      ],
      "status": "published",
      "createdAt": "2026-09-15",
      "updatedAt": "2026-09-15",
      "offerId": "offer-service-fittrack-personal-training"
    }
  ];

  /* Offers: each one references the listing it changes the price of. */
  const offers = [
    {
      "id": "offer-phone-zenith-x6-pro",
      "listingId": "phone-zenith-x6-pro",
      "title": "Launch price on the 256GB model",
      "description": "",
      "kind": "percentage",
      "originalPrice": 89999,
      "offerPrice": 79999,
      "discountPercent": 11,
      "currency": "KES",
      "startsAt": "2026-09-15",
      "endsAt": "2026-10-31",
      "availability": "available",
      "sellerId": "seller-zenith-store-nairobi",
      "status": "active",
      "conditions": [
        "Demo condition: 256GB colour options included",
        "Demo condition: one unit per demo order"
      ]
    },
    {
      "id": "offer-laptop-slatebook-air-14",
      "listingId": "laptop-slatebook-air-14",
      "title": "Bundle: sleeve and wireless mouse included",
      "description": "",
      "kind": "bundle",
      "originalPrice": 129999,
      "offerPrice": 119999,
      "discountPercent": 8,
      "currency": "KES",
      "startsAt": "2026-09-10",
      "endsAt": "2026-11-30",
      "availability": "available",
      "sellerId": "seller-slatepoint-store",
      "status": "active",
      "conditions": [
        "Demo condition: bundle applies while demo stock lasts",
        "Demo condition: accessories are demo items"
      ]
    },
    {
      "id": "offer-laptop-kesibook-14-student",
      "listingId": "laptop-kesibook-14-student",
      "title": "Student price with any student ID",
      "description": "",
      "kind": "fixed-price",
      "originalPrice": 46999,
      "offerPrice": 42500,
      "discountPercent": 10,
      "currency": "KES",
      "startsAt": "2026-09-01",
      "endsAt": "2026-12-20",
      "availability": "available",
      "sellerId": "seller-highlands-computers",
      "status": "active",
      "conditions": [
        "Demo condition: student ID required",
        "Demo condition: one unit per student"
      ]
    },
    {
      "id": "offer-headphones-quietmax-700",
      "listingId": "headphones-quietmax-700",
      "title": "Price drop on the quiet-cancelling model",
      "description": "",
      "kind": "percentage",
      "originalPrice": 27900,
      "offerPrice": 22900,
      "discountPercent": 18,
      "currency": "KES",
      "startsAt": "2026-09-15",
      "endsAt": "2026-12-31",
      "availability": "available",
      "sellerId": "seller-audionest-online",
      "status": "active",
      "conditions": [
        "Demo condition: online sellers only",
        "Demo condition: cannot be combined with other demo offers"
      ]
    },
    {
      "id": "offer-tablet-slatepad-11",
      "listingId": "tablet-slatepad-11",
      "title": "Folio case included at this price",
      "description": "",
      "kind": "bundle",
      "originalPrice": 62000,
      "offerPrice": 58900,
      "discountPercent": 5,
      "currency": "KES",
      "startsAt": "2026-09-05",
      "endsAt": "2026-11-15",
      "availability": "available",
      "sellerId": "seller-slatepoint-store",
      "status": "active",
      "conditions": [
        "Demo condition: case is a demo accessory",
        "Demo condition: colour availability is demo data"
      ]
    },
    {
      "id": "offer-watch-pulsefit-6",
      "listingId": "watch-pulsefit-6",
      "title": "Short demo window on the LTE variant",
      "description": "",
      "kind": "limited",
      "originalPrice": 32900,
      "offerPrice": 27900,
      "discountPercent": 15,
      "currency": "KES",
      "startsAt": "2026-09-20",
      "endsAt": "2026-09-30",
      "availability": "limited",
      "sellerId": "seller-beatline-direct",
      "status": "active",
      "conditions": [
        "Demo condition: LTE variant only",
        "Demo condition: ends on the stated demo date"
      ]
    },
    {
      "id": "offer-chair-ergoform-mesh",
      "listingId": "chair-ergoform-mesh",
      "title": "Reduced while the demo promotion runs",
      "description": "",
      "kind": "percentage",
      "originalPrice": 22300,
      "offerPrice": 18900,
      "discountPercent": 15,
      "currency": "KES",
      "startsAt": "2026-09-01",
      "endsAt": "2026-11-15",
      "availability": "limited",
      "sellerId": "seller-homenest-nairobi",
      "status": "active",
      "conditions": [
        "Demo condition: Nairobi delivery area only",
        "Demo condition: assembly not included"
      ]
    },
    {
      "id": "offer-fridge-chillbox-mini-45l",
      "listingId": "fridge-chillbox-mini-45l",
      "title": "Fixed demo price on the 45L model",
      "description": "",
      "kind": "fixed-price",
      "originalPrice": 24900,
      "offerPrice": 21500,
      "discountPercent": 14,
      "currency": "KES",
      "startsAt": "2026-09-02",
      "endsAt": "2026-10-20",
      "availability": "available",
      "sellerId": "seller-thika-home-appliances",
      "status": "active",
      "conditions": [
        "Demo condition: delivery within Thika and Nairobi (demo)",
        "Demo condition: one unit per demo order"
      ]
    },
    {
      "id": "offer-tyre-roadgrip-195-65",
      "listingId": "tyre-roadgrip-195-65",
      "title": "Fitting and balancing included at this price",
      "description": "",
      "kind": "fixed-price",
      "originalPrice": 9800,
      "offerPrice": 8900,
      "discountPercent": 9,
      "currency": "KES",
      "startsAt": "2026-09-08",
      "endsAt": "2026-10-15",
      "availability": "available",
      "sellerId": "seller-roadgrip-tyre-centre",
      "status": "active",
      "conditions": [
        "Demo condition: price is per tyre",
        "Demo condition: fitting demo applies to four tyres or more"
      ]
    },
    {
      "id": "offer-detailing-shinelab-full-detail",
      "listingId": "detailing-shinelab-full-detail",
      "title": "Package price for medium cars (demo)",
      "description": "",
      "kind": "package",
      "originalPrice": 5600,
      "offerPrice": 4500,
      "discountPercent": 20,
      "currency": "KES",
      "startsAt": "2026-09-12",
      "endsAt": "2026-11-30",
      "availability": "by-appointment",
      "sellerId": "seller-shinelab-detailing-demo",
      "status": "active",
      "conditions": [
        "Demo condition: applies to medium-size vehicles",
        "Demo condition: large vehicles quoted separately"
      ]
    },
    {
      "id": "offer-detailing-gleamworks-ceramic",
      "listingId": "detailing-gleamworks-ceramic",
      "title": "Workshop price with paint preparation included",
      "description": "",
      "kind": "package",
      "originalPrice": 35000,
      "offerPrice": 28000,
      "discountPercent": 20,
      "currency": "KES",
      "startsAt": "2026-09-05",
      "endsAt": "2026-12-10",
      "availability": "by-appointment",
      "sellerId": "seller-gleamworks-auto-care-demo",
      "status": "active",
      "conditions": [
        "Demo condition: workshop bookings only",
        "Demo condition: demo coating warranty of 12 months"
      ]
    },
    {
      "id": "offer-luggage-alpine-cabin-22",
      "listingId": "luggage-alpine-cabin-22",
      "title": "Cabin case demo price, two colourways",
      "description": "",
      "kind": "percentage",
      "originalPrice": 13900,
      "offerPrice": 9900,
      "discountPercent": 29,
      "currency": "KES",
      "startsAt": "2026-09-18",
      "endsAt": "2026-10-12",
      "availability": "available",
      "sellerId": "seller-roamkit-co-demo",
      "status": "active",
      "conditions": [
        "Demo condition: two colourways included",
        "Demo condition: reference price is an illustrative list price"
      ]
    },
    {
      "id": "offer-service-nimbuscloud-backup",
      "listingId": "service-nimbuscloud-backup",
      "title": "Annual billing price (per month, demo)",
      "description": "",
      "kind": "billing",
      "originalPrice": 2400,
      "offerPrice": 1600,
      "discountPercent": 33,
      "currency": "KES",
      "startsAt": "2026-09-19",
      "endsAt": "2026-12-15",
      "availability": "available",
      "sellerId": "seller-nimbuscloud-demo-provider",
      "status": "active",
      "conditions": [
        "Demo condition: price shown per month on annual billing",
        "Demo condition: nothing is provisioned in this build"
      ]
    },
    {
      "id": "offer-course-spanish-for-travellers",
      "listingId": "course-spanish-for-travellers",
      "title": "Early-enrolment demo price",
      "description": "",
      "kind": "fixed-price",
      "originalPrice": 12400,
      "offerPrice": 9900,
      "discountPercent": 20,
      "currency": "KES",
      "startsAt": "2026-09-11",
      "endsAt": "2026-10-20",
      "availability": "limited",
      "sellerId": "seller-lingua-academy-demo",
      "status": "active",
      "conditions": [
        "Demo condition: early-enrolment price",
        "Demo condition: no real enrolment takes place"
      ]
    },
    {
      "id": "offer-course-data-foundations",
      "listingId": "course-data-foundations",
      "title": "Enrolment window discount (demo)",
      "description": "",
      "kind": "percentage",
      "originalPrice": 18900,
      "offerPrice": 15900,
      "discountPercent": 16,
      "currency": "KES",
      "startsAt": "2026-09-06",
      "endsAt": "2026-11-30",
      "availability": "available",
      "sellerId": "seller-northline-learning-demo",
      "status": "active",
      "conditions": [
        "Demo condition: includes one resit",
        "Demo condition: mentor sessions are demo content"
      ]
    },
    {
      "id": "offer-service-fibermax-fibre-300",
      "listingId": "service-fibermax-fibre-300",
      "title": "First three months at the demo introductory price",
      "description": "",
      "kind": "introductory",
      "originalPrice": 3400,
      "offerPrice": 2700,
      "discountPercent": 21,
      "currency": "KES",
      "startsAt": "2026-09-09",
      "endsAt": "2026-10-31",
      "availability": "available",
      "sellerId": "seller-fibermax-demo-provider",
      "status": "active",
      "conditions": [
        "Demo condition: introductory price for the first 3 months",
        "Demo condition: 12-month demo contract required"
      ]
    },
    {
      "id": "offer-service-fixpoint-phone-repair",
      "listingId": "service-fixpoint-phone-repair",
      "title": "Demo starting price on common models",
      "description": "",
      "kind": "fixed-price",
      "originalPrice": 4500,
      "offerPrice": 3500,
      "discountPercent": 22,
      "currency": "KES",
      "startsAt": "2026-09-01",
      "endsAt": "2026-10-31",
      "availability": "available",
      "sellerId": "seller-fixpoint-repairs-demo",
      "status": "active",
      "conditions": [
        "Demo condition: applies to common demo models only",
        "Demo condition: parts availability is not real"
      ]
    },
    {
      "id": "offer-service-sparklehome-deep-clean",
      "listingId": "service-sparklehome-deep-clean",
      "title": "Fixed demo price for a 3-bedroom home",
      "description": "",
      "kind": "package",
      "originalPrice": 9200,
      "offerPrice": 7500,
      "discountPercent": 18,
      "currency": "KES",
      "startsAt": "2026-09-14",
      "endsAt": "2026-11-14",
      "availability": "by-appointment",
      "sellerId": "seller-sparklehome-cleaning-demo",
      "status": "active",
      "conditions": [
        "Demo condition: applies to 3-bedroom homes",
        "Demo condition: larger homes quoted separately"
      ]
    },
    {
      "id": "offer-service-fittrack-personal-training",
      "listingId": "service-fittrack-personal-training",
      "title": "Package price per session when buying ten",
      "description": "",
      "kind": "package",
      "originalPrice": 1800,
      "offerPrice": 1500,
      "discountPercent": 17,
      "currency": "KES",
      "startsAt": "2026-09-16",
      "endsAt": "2026-11-16",
      "availability": "available",
      "sellerId": "seller-fittrack-coaching-demo",
      "status": "active",
      "conditions": [
        "Demo condition: package of ten sessions",
        "Demo condition: sessions are demo content only"
      ]
    }
  ];

  /* Guide outlines (decision support — not advertising). */
  const guides = [
    {
      "id": "guide-compare-smartphones",
      "title": "How to compare smartphones",
      "slug": "how-to-compare-smartphones",
      "category": "technology",
      "tags": [
        "technology",
        "smartphones"
      ],
      "question": "Which specifications actually change how a phone feels day to day?",
      "summary": "A short framework for reading display, battery, storage and camera specs without getting lost in numbers.",
      "sections": [
        {
          "id": "section-1",
          "title": "Battery vs screen size trade-offs",
          "body": null,
          "position": 0
        },
        {
          "id": "section-2",
          "title": "Storage and update support",
          "body": null,
          "position": 1
        },
        {
          "id": "section-3",
          "title": "When a mid-range phone is enough",
          "body": null,
          "position": 2
        }
      ],
      "relatedListingIds": [
        "phone-zenith-x6-pro",
        "phone-nova-edge-5g",
        "phone-kesi-prime-4"
      ],
      "icon": "📱",
      "level": "Beginner",
      "readTime": "6 min read",
      "cta": {
        "label": "Browse smartphones",
        "href": "discover.html?category=technology&sub=Smartphones"
      },
      "status": "published",
      "outline": true,
      "createdAt": null,
      "updatedAt": null
    },
    {
      "id": "guide-laptop-for-work",
      "title": "How to choose a laptop for work",
      "slug": "how-to-choose-a-laptop-for-work",
      "category": "technology",
      "tags": [
        "technology",
        "laptops",
        "remote-work"
      ],
      "question": "How do I balance weight, battery, memory and price for my work?",
      "summary": "What to decide before comparing laptops, and which specifications rarely matter for everyday work.",
      "sections": [
        {
          "id": "section-1",
          "title": "Memory and storage minimums",
          "body": null,
          "position": 0
        },
        {
          "id": "section-2",
          "title": "Ports, repairability and warranty",
          "body": null,
          "position": 1
        },
        {
          "id": "section-3",
          "title": "When a tablet or desktop fits better",
          "body": null,
          "position": 2
        }
      ],
      "relatedListingIds": [
        "laptop-slatebook-air-14",
        "laptop-kesibook-14-student"
      ],
      "icon": "💻",
      "level": "Beginner",
      "readTime": "7 min read",
      "cta": {
        "label": "Explore remote-work laptops",
        "href": "discover.html?category=technology&sub=Laptops&tag=remote-work"
      },
      "status": "published",
      "outline": true,
      "createdAt": null,
      "updatedAt": null
    },
    {
      "id": "guide-used-phone-checks",
      "title": "What to check before buying a used phone",
      "slug": "what-to-check-before-buying-a-used-phone",
      "category": "technology",
      "tags": [
        "technology",
        "smartphones"
      ],
      "question": "What should I verify before paying for a refurbished or second-hand phone?",
      "summary": "Condition grades, battery health claims and the questions to ask about a refurbished device.",
      "sections": [
        {
          "id": "section-1",
          "title": "Condition grades and what they mean",
          "body": null,
          "position": 0
        },
        {
          "id": "section-2",
          "title": "Battery health and repair history",
          "body": null,
          "position": 1
        },
        {
          "id": "section-3",
          "title": "Warranty differences from new stock",
          "body": null,
          "position": 2
        }
      ],
      "relatedListingIds": [
        "phone-zenith-x4-refurbished"
      ],
      "icon": "♻️",
      "level": "Beginner",
      "readTime": "5 min read",
      "cta": {
        "label": "Refurbished phones",
        "href": "discover.html?category=technology&sub=Smartphones&q=refurbished"
      },
      "status": "published",
      "outline": true,
      "createdAt": null,
      "updatedAt": null
    },
    {
      "id": "guide-home-internet",
      "title": "How to choose a home internet package",
      "slug": "how-to-choose-a-home-internet-package",
      "category": "services",
      "tags": [
        "services",
        "internet"
      ],
      "question": "How much speed does my household actually need, and what else is in the contract?",
      "summary": "Speeds are only one line in the contract. How to read contract length, fees and support terms.",
      "sections": [
        {
          "id": "section-1",
          "title": "Speed needed per household size",
          "body": null,
          "position": 0
        },
        {
          "id": "section-2",
          "title": "Contract length and exit costs",
          "body": null,
          "position": 1
        },
        {
          "id": "section-3",
          "title": "Installation and equipment fees",
          "body": null,
          "position": 2
        }
      ],
      "relatedListingIds": [
        "service-fibermax-fibre-300"
      ],
      "icon": "🛜",
      "level": "Beginner",
      "readTime": "5 min read",
      "cta": {
        "label": "Browse internet plans",
        "href": "discover.html?category=services&sub=Internet"
      },
      "status": "published",
      "outline": true,
      "createdAt": null,
      "updatedAt": null
    },
    {
      "id": "guide-wifi-router",
      "title": "What to look for in a Wi-Fi router",
      "slug": "what-to-look-for-in-a-wi-fi-router",
      "category": "technology",
      "tags": [
        "technology",
        "networking"
      ],
      "question": "Which router specifications matter in a normal home or small office?",
      "summary": "Wi-Fi standard, bands, coverage and SIM support explained without the marketing language.",
      "sections": [
        {
          "id": "section-1",
          "title": "Wi-Fi 5 vs Wi-Fi 6 in practice",
          "body": null,
          "position": 0
        },
        {
          "id": "section-2",
          "title": "Bands, channels and coverage limits",
          "body": null,
          "position": 1
        },
        {
          "id": "section-3",
          "title": "When a portable or SIM router is better",
          "body": null,
          "position": 2
        }
      ],
      "relatedListingIds": [
        "router-fibermax-ax3000",
        "router-netlink-lte-mifi"
      ],
      "icon": "📶",
      "level": "Beginner",
      "readTime": "5 min read",
      "cta": {
        "label": "Browse networking",
        "href": "discover.html?category=technology&sub=Networking"
      },
      "status": "published",
      "outline": true,
      "createdAt": null,
      "updatedAt": null
    },
    {
      "id": "guide-car-detailing",
      "title": "How to compare car detailing services",
      "slug": "how-to-compare-car-detailing-services",
      "category": "automotive",
      "tags": [
        "automotive",
        "detailing"
      ],
      "question": "How do I tell two detailing packages apart when both say \"full detail\"?",
      "summary": "Package scope, materials, duration and mobile service — the parts that decide what you actually get.",
      "sections": [
        {
          "id": "section-1",
          "title": "What a full detail should include",
          "body": null,
          "position": 0
        },
        {
          "id": "section-2",
          "title": "Ceramic coating vs wax",
          "body": null,
          "position": 1
        },
        {
          "id": "section-3",
          "title": "Mobile or workshop service trade-offs",
          "body": null,
          "position": 2
        }
      ],
      "relatedListingIds": [
        "detailing-shinelab-full-detail",
        "detailing-gleamworks-ceramic"
      ],
      "icon": "🧼",
      "level": "Beginner",
      "readTime": "5 min read",
      "cta": {
        "label": "Browse detailing",
        "href": "discover.html?category=automotive&sub=Detailing"
      },
      "status": "published",
      "outline": true,
      "createdAt": null,
      "updatedAt": null
    },
    {
      "id": "guide-office-chair",
      "title": "How to choose an office chair",
      "slug": "how-to-choose-an-office-chair",
      "category": "home",
      "tags": [
        "home",
        "furniture"
      ],
      "question": "Which adjustments matter if I sit for several hours a day?",
      "summary": "Lumbar support, seat depth, armrests and warranty — what to test before committing.",
      "sections": [
        {
          "id": "section-1",
          "title": "Adjustability that actually helps",
          "body": null,
          "position": 0
        },
        {
          "id": "section-2",
          "title": "Materials and expected lifespan",
          "body": null,
          "position": 1
        },
        {
          "id": "section-3",
          "title": "Warranty and spare parts",
          "body": null,
          "position": 2
        }
      ],
      "relatedListingIds": [
        "chair-ergoform-mesh",
        "desk-ergoform-standing",
        "mattress-dreamrest-6x6"
      ],
      "icon": "💺",
      "level": "Beginner",
      "readTime": "5 min read",
      "cta": {
        "label": "Browse home furniture",
        "href": "discover.html?category=home&sub=Furniture"
      },
      "status": "published",
      "outline": true,
      "createdAt": null,
      "updatedAt": null
    },
    {
      "id": "guide-service-providers",
      "title": "How to compare service providers",
      "slug": "how-to-compare-service-providers",
      "category": "services",
      "tags": [
        "services"
      ],
      "question": "What should I compare when the service is a person, not a product?",
      "summary": "Scope, turnaround, service area, warranty on work and price basis — a reusable checklist.",
      "sections": [
        {
          "id": "section-1",
          "title": "Included vs excluded work",
          "body": null,
          "position": 0
        },
        {
          "id": "section-2",
          "title": "Turnaround and availability",
          "body": null,
          "position": 1
        },
        {
          "id": "section-3",
          "title": "Warranty and follow-up terms",
          "body": null,
          "position": 2
        }
      ],
      "relatedListingIds": [
        "service-fibermax-fibre-300",
        "service-netlink-install-visit",
        "service-fixpoint-phone-repair"
      ],
      "icon": "🛠️",
      "level": "Beginner",
      "readTime": "6 min read",
      "cta": {
        "label": "Browse services",
        "href": "discover.html?category=services"
      },
      "status": "published",
      "outline": true,
      "createdAt": null,
      "updatedAt": null
    },
    {
      "id": "guide-evaluate-a-deal",
      "title": "How to evaluate a deal",
      "slug": "how-to-evaluate-a-deal",
      "category": "business",
      "tags": [
        "business"
      ],
      "question": "Is this discount claim actually a saving?",
      "summary": "Understand what a reference price is measured against, and when an offer is not really a saving.",
      "sections": [
        {
          "id": "section-1",
          "title": "Reference price definitions",
          "body": null,
          "position": 0
        },
        {
          "id": "section-2",
          "title": "Time-limited vs permanent offers",
          "body": null,
          "position": 1
        },
        {
          "id": "section-3",
          "title": "Conditions that change the value",
          "body": null,
          "position": 2
        }
      ],
      "relatedListingIds": [
        "phone-zenith-x6-pro",
        "phone-nova-edge-5g",
        "phone-kesi-prime-4"
      ],
      "icon": "🏷️",
      "level": "Beginner",
      "readTime": "4 min read",
      "cta": {
        "label": "Browse demo deals",
        "href": "deals.html"
      },
      "status": "published",
      "outline": true,
      "createdAt": null,
      "updatedAt": null
    },
    {
      "id": "guide-questions-before-hiring",
      "title": "Questions to ask before hiring a service provider",
      "slug": "questions-to-ask-before-hiring-a-service-provider",
      "category": "services",
      "tags": [
        "services",
        "professional"
      ],
      "question": "Which questions should I ask before agreeing to a service?",
      "summary": "A practical list of questions about scope, timing, extras and warranties you can ask any provider.",
      "sections": [
        {
          "id": "section-1",
          "title": "Scope and exclusions",
          "body": null,
          "position": 0
        },
        {
          "id": "section-2",
          "title": "Timing and delays",
          "body": null,
          "position": 1
        },
        {
          "id": "section-3",
          "title": "Payment, warranty and follow-up",
          "body": null,
          "position": 2
        }
      ],
      "relatedListingIds": [
        "detailing-shinelab-full-detail",
        "service-safariline-trip-planning",
        "service-studionine-web-design"
      ],
      "icon": "❓",
      "level": "Beginner",
      "readTime": "4 min read",
      "cta": {
        "label": "Browse service providers",
        "href": "discover.html?type=service&tag=professional"
      },
      "status": "published",
      "outline": true,
      "createdAt": null,
      "updatedAt": null
    }
  ];

  /* Price bands are structured; the UI derives their labels. */
  const priceBands = [
    {
      "code": "any",
      "min": null,
      "max": null
    },
    {
      "code": "under-5k",
      "min": null,
      "max": 5000
    },
    {
      "code": "5k-30k",
      "min": 5000,
      "max": 30000
    },
    {
      "code": "30k-100k",
      "min": 30000,
      "max": 100000
    },
    {
      "code": "over-100k",
      "min": 100000,
      "max": null
    }
  ];

  /* Sort vocabulary (UI-facing wording, not derived from records). */
  const sortOptions = [
    {
      "code": "relevance",
      "label": "Relevance"
    },
    {
      "code": "newest",
      "label": "Newest"
    },
    {
      "code": "price-asc",
      "label": "Price: Low to High"
    },
    {
      "code": "price-desc",
      "label": "Price: High to Low"
    }
  ];

  /* Compare focus areas and per-category row groupings. */
  const compareFocus = [
    {
      "code": "price",
      "label": "Price",
      "help": "Price, reference price and demo offers",
      "rows": [
        "price",
        "originalPrice",
        "offerPrice",
        "offer"
      ],
      "keywords": [
        "price",
        "cost",
        "fee"
      ]
    },
    {
      "code": "performance",
      "label": "Performance",
      "help": "Processor, memory, speed and capacity",
      "keywords": [
        "processor",
        "ram",
        "memory",
        "storage",
        "graphics",
        "chip",
        "speed",
        "capacity",
        "refresh"
      ]
    },
    {
      "code": "features",
      "label": "Features",
      "help": "Included items and package contents",
      "keywords": [
        "included",
        "package",
        "features",
        "modules",
        "contents"
      ]
    },
    {
      "code": "portability",
      "label": "Portability",
      "help": "Weight, size and travel fit",
      "keywords": [
        "weight",
        "size",
        "dimensions",
        "portable",
        "volume",
        "thickness",
        "cabin"
      ]
    },
    {
      "code": "availability",
      "label": "Availability",
      "help": "Status, notice and turnaround",
      "rows": [
        "availability",
        "createdAt"
      ],
      "keywords": [
        "availability",
        "turnaround",
        "duration",
        "time",
        "session",
        "delivery",
        "minimum stay"
      ]
    },
    {
      "code": "location",
      "label": "Location",
      "help": "Where the item or provider is",
      "rows": [
        "location"
      ],
      "keywords": [
        "location",
        "area",
        "coverage",
        "delivery method"
      ]
    },
    {
      "code": "specifications",
      "label": "Specifications",
      "help": "Every specification row",
      "allAttributes": true,
      "keywords": []
    },
    {
      "code": "coverage",
      "label": "Service coverage",
      "help": "Where a service is available",
      "keywords": [
        "service area",
        "coverage",
        "mobile service",
        "delivery method",
        "availability"
      ]
    },
    {
      "code": "included",
      "label": "Included services",
      "help": "What the price includes",
      "keywords": [
        "included",
        "package",
        "supplies",
        "materials",
        "revisions",
        "warranty",
        "trial"
      ]
    }
  ];
  const compareGroups = {
    "technology": {
      "groups": [
        {
          "title": "Overview",
          "rows": [
            "type",
            "brand",
            "category",
            "price",
            "originalPrice",
            "offerPrice",
            "offer"
          ]
        },
        {
          "title": "Performance",
          "keywords": [
            "processor",
            "ram",
            "memory",
            "graphics",
            "chip",
            "speed",
            "capacity"
          ]
        },
        {
          "title": "Display",
          "keywords": [
            "display",
            "screen",
            "resolution",
            "refresh",
            "panel"
          ]
        },
        {
          "title": "Camera & battery",
          "keywords": [
            "camera",
            "battery",
            "charging",
            "runtime",
            "energy"
          ]
        },
        {
          "title": "Connectivity & design",
          "keywords": [
            "connectivity",
            "wi-fi",
            "sim",
            "network",
            "ports",
            "weight",
            "water",
            "bands",
            "coverage",
            "lock",
            "wheels"
          ]
        },
        {
          "title": "Support & condition",
          "keywords": [
            "warranty",
            "condition",
            "included",
            "support",
            "returns"
          ]
        }
      ]
    },
    "home": {
      "groups": [
        {
          "title": "Overview",
          "rows": [
            "type",
            "brand",
            "category",
            "price",
            "originalPrice",
            "offerPrice",
            "offer"
          ]
        },
        {
          "title": "Size & material",
          "keywords": [
            "dimensions",
            "material",
            "size",
            "weight",
            "thickness"
          ]
        },
        {
          "title": "Capacity & power",
          "keywords": [
            "capacity",
            "volume",
            "load",
            "energy",
            "output",
            "battery",
            "runtime",
            "noise",
            "shelves"
          ]
        },
        {
          "title": "Comfort & features",
          "keywords": [
            "lumbar",
            "armrests",
            "firmness",
            "adjustment",
            "features",
            "included",
            "trial"
          ]
        },
        {
          "title": "Support",
          "keywords": [
            "warranty",
            "assembly"
          ]
        }
      ]
    },
    "automotive": {
      "groups": [
        {
          "title": "Overview",
          "rows": [
            "type",
            "brand",
            "category",
            "price",
            "originalPrice",
            "offerPrice",
            "offer"
          ]
        },
        {
          "title": "Fitment & performance",
          "keywords": [
            "size",
            "load",
            "speed",
            "season",
            "capacity",
            "cranking",
            "terminal",
            "tread"
          ]
        },
        {
          "title": "Electronics",
          "keywords": [
            "resolution",
            "view",
            "recording",
            "storage",
            "mounting",
            "night"
          ]
        },
        {
          "title": "Support",
          "keywords": [
            "warranty",
            "fitting",
            "trade-in",
            "old battery"
          ]
        }
      ],
      "serviceGroups": [
        {
          "title": "Overview",
          "rows": [
            "type",
            "brand",
            "category",
            "price",
            "originalPrice",
            "offerPrice",
            "offer"
          ]
        },
        {
          "title": "Service scope",
          "keywords": [
            "package",
            "included",
            "duration",
            "price basis",
            "warranty",
            "coating"
          ]
        },
        {
          "title": "Coverage & availability",
          "keywords": [
            "service area",
            "availability",
            "mobile",
            "coverage"
          ]
        }
      ]
    },
    "travel": {
      "groups": [
        {
          "title": "Overview",
          "rows": [
            "type",
            "brand",
            "category",
            "price",
            "originalPrice",
            "offerPrice",
            "offer"
          ]
        },
        {
          "title": "Size & weight",
          "keywords": [
            "volume",
            "weight",
            "material",
            "dimensions"
          ]
        },
        {
          "title": "Features",
          "keywords": [
            "wheels",
            "lock",
            "compartments",
            "features"
          ]
        },
        {
          "title": "Support",
          "keywords": [
            "warranty",
            "returns"
          ]
        }
      ],
      "serviceGroups": [
        {
          "title": "Overview",
          "rows": [
            "type",
            "brand",
            "category",
            "price",
            "originalPrice",
            "offerPrice",
            "offer"
          ]
        },
        {
          "title": "Stay & logistics",
          "keywords": [
            "guests",
            "minimum stay",
            "check-in",
            "included",
            "service area",
            "availability",
            "cancellation",
            "turnaround",
            "delivery method",
            "revisions"
          ]
        },
        {
          "title": "Pricing",
          "keywords": [
            "price basis",
            "contact",
            "package"
          ]
        }
      ]
    },
    "business": {
      "groups": [
        {
          "title": "Overview",
          "rows": [
            "type",
            "brand",
            "category",
            "price",
            "originalPrice",
            "offerPrice",
            "offer"
          ]
        },
        {
          "title": "Plan & scope",
          "keywords": [
            "plan",
            "users",
            "storage",
            "invoices",
            "package",
            "included",
            "modules",
            "revisions"
          ]
        },
        {
          "title": "Delivery & terms",
          "keywords": [
            "timeline",
            "contract",
            "trial",
            "delivery method",
            "availability",
            "fees",
            "retention",
            "devices"
          ]
        },
        {
          "title": "Support",
          "keywords": [
            "support",
            "warranty"
          ]
        }
      ]
    },
    "education": {
      "groups": [
        {
          "title": "Overview",
          "rows": [
            "type",
            "brand",
            "category",
            "price",
            "originalPrice",
            "offerPrice",
            "offer"
          ]
        },
        {
          "title": "Format & level",
          "keywords": [
            "format",
            "level",
            "class size",
            "session length",
            "subjects",
            "modules"
          ]
        },
        {
          "title": "Schedule & delivery",
          "keywords": [
            "duration",
            "availability",
            "delivery method",
            "service area",
            "certificate",
            "package",
            "vehicle"
          ]
        },
        {
          "title": "Support",
          "keywords": [
            "support",
            "included"
          ]
        }
      ]
    },
    "fashion": {
      "groups": [
        {
          "title": "Overview",
          "rows": [
            "type",
            "brand",
            "category",
            "price",
            "originalPrice",
            "offerPrice",
            "offer"
          ]
        },
        {
          "title": "Product details",
          "keywords": [
            "material",
            "weight",
            "sole",
            "upper",
            "waterproof",
            "volume",
            "laptop size",
            "packed size"
          ]
        },
        {
          "title": "Sizing & fit",
          "keywords": [
            "sizes",
            "fit",
            "care"
          ]
        },
        {
          "title": "Support",
          "keywords": [
            "warranty",
            "returns"
          ]
        }
      ]
    },
    "services": {
      "groups": [
        {
          "title": "Overview",
          "rows": [
            "type",
            "brand",
            "category",
            "price",
            "originalPrice",
            "offerPrice",
            "offer"
          ]
        },
        {
          "title": "Provider",
          "rows": [
            "seller",
            "sellerType",
            "location",
            "serviceArea"
          ]
        },
        {
          "title": "Coverage & availability",
          "keywords": [
            "service area",
            "availability",
            "delivery method",
            "coverage",
            "booking",
            "contact",
            "mobile"
          ]
        },
        {
          "title": "Service",
          "keywords": [
            "package",
            "included",
            "session",
            "lesson",
            "team",
            "duration",
            "supplies",
            "materials",
            "crews",
            "revisions",
            "modules",
            "subjects",
            "format",
            "level"
          ]
        },
        {
          "title": "Pricing",
          "keywords": [
            "price basis",
            "contract",
            "setup",
            "fees",
            "trial",
            "travel"
          ]
        },
        {
          "title": "Support",
          "keywords": [
            "support",
            "warranty",
            "certificate",
            "retention"
          ]
        }
      ]
    }
  };

  /* Decision-support copy: category/subcategory prompts and general notes. */
  const considerations = {
    "technology": [
      {
        "title": "Core specifications",
        "items": [
          {
            "label": "Display",
            "hint": "Screen size, resolution and refresh rate change how it feels to use."
          },
          {
            "label": "Battery",
            "hint": "Compare advertised runtime and how the device is charged."
          },
          {
            "label": "Performance",
            "hint": "Processor and memory decide how it copes with your workload."
          },
          {
            "label": "Storage",
            "hint": "How much you can keep on the device, and whether it can be extended."
          }
        ]
      },
      {
        "title": "Around the device",
        "items": [
          {
            "label": "Connectivity",
            "hint": "Wi-Fi, mobile network, ports and SIM support."
          },
          {
            "label": "Software",
            "hint": "Operating system, updates and app support."
          },
          {
            "label": "Portability",
            "hint": "Weight and size if it travels with you."
          },
          {
            "label": "Warranty and condition",
            "hint": "New, refurbished or graded stock, and what the warranty covers."
          }
        ]
      }
    ],
    "technology:Smartphones": [
      {
        "title": "What matters on a phone",
        "items": [
          {
            "label": "Display",
            "hint": "Size, panel type and refresh rate."
          },
          {
            "label": "Battery",
            "hint": "Capacity and typical runtime."
          },
          {
            "label": "Camera",
            "hint": "Sensor resolution and how many lenses you actually use."
          },
          {
            "label": "Storage",
            "hint": "Onboard space versus expandable storage."
          },
          {
            "label": "Performance",
            "hint": "Processor and RAM for apps and multitasking."
          },
          {
            "label": "Software",
            "hint": "Update support matters for how long it stays useful."
          }
        ]
      }
    ],
    "technology:Laptops": [
      {
        "title": "What matters on a laptop",
        "items": [
          {
            "label": "Processor",
            "hint": "Sets the ceiling for heavy work."
          },
          {
            "label": "RAM",
            "hint": "Multi-tasking headroom — check what you can upgrade later."
          },
          {
            "label": "Storage",
            "hint": "How much you can carry locally."
          },
          {
            "label": "Display",
            "hint": "Size, resolution and how it looks outdoors."
          },
          {
            "label": "Graphics",
            "hint": "Only a deciding factor for gaming, video and 3D work."
          },
          {
            "label": "Weight",
            "hint": "Matters most if you carry it daily."
          }
        ]
      }
    ],
    "technology:Networking": [
      {
        "title": "What matters on a router",
        "items": [
          {
            "label": "Wi-Fi standard",
            "hint": "The generation of wireless technology it supports."
          },
          {
            "label": "Speed",
            "hint": "Advertised combined speed, not real-world throughput."
          },
          {
            "label": "Coverage",
            "hint": "Illustrative area, and how many rooms that really means."
          },
          {
            "label": "Bands",
            "hint": "Dual band separates slow and fast devices."
          },
          {
            "label": "Ports",
            "hint": "Wired devices and how many you can connect."
          },
          {
            "label": "SIM support",
            "hint": "Whether the connection comes from a fixed line or a SIM."
          }
        ]
      }
    ],
    "technology:Audio": [
      {
        "title": "What matters on headphones",
        "items": [
          {
            "label": "Noise cancellation",
            "hint": "Active cancelling versus passive isolation."
          },
          {
            "label": "Battery",
            "hint": "Runtime per charge and how quickly it tops up."
          },
          {
            "label": "Comfort",
            "hint": "Weight and earcup style matter for long sessions."
          },
          {
            "label": "Connectivity",
            "hint": "Bluetooth version, multipoint and wired options."
          }
        ]
      }
    ],
    "home": [
      {
        "title": "Fit and comfort",
        "items": [
          {
            "label": "Adjustability",
            "hint": "What can be set to suit you or the room."
          },
          {
            "label": "Material",
            "hint": "How it feels and how it wears over time."
          },
          {
            "label": "Dimensions",
            "hint": "Measure the space before comparing anything else."
          },
          {
            "label": "Weight capacity",
            "hint": "How much it is rated to hold."
          }
        ]
      },
      {
        "title": "Ownership",
        "items": [
          {
            "label": "Assembly",
            "hint": "Whether it arrives ready to use or needs building."
          },
          {
            "label": "Warranty",
            "hint": "What is covered, and for how long."
          },
          {
            "label": "Running cost",
            "hint": "Energy or consumables over time, not just the price."
          }
        ]
      }
    ],
    "automotive": [
      {
        "title": "Fit and use",
        "items": [
          {
            "label": "Fitment",
            "hint": "Size, rating and compatibility come before price."
          },
          {
            "label": "Season or use",
            "hint": "What conditions it is designed for."
          },
          {
            "label": "Included work",
            "hint": "Installation, fitting or balancing may or may not be included."
          }
        ]
      },
      {
        "title": "Ownership",
        "items": [
          {
            "label": "Warranty",
            "hint": "What is covered if it fails early."
          },
          {
            "label": "Service area",
            "hint": "Where the work can actually be carried out."
          },
          {
            "label": "Price basis",
            "hint": "Per unit, per package or quoted after inspection."
          }
        ]
      }
    ],
    "travel": [
      {
        "title": "Practical fit",
        "items": [
          {
            "label": "Size limits",
            "hint": "Cabin and baggage rules decide what actually works."
          },
          {
            "label": "Weight",
            "hint": "Weight when empty counts towards your limit."
          },
          {
            "label": "Duration",
            "hint": "Nights or days included, and any minimum stay."
          }
        ]
      },
      {
        "title": "Terms",
        "items": [
          {
            "label": "Included",
            "hint": "What comes with the price and what is billed separately."
          },
          {
            "label": "Cancellation",
            "hint": "How late you can change your plans."
          },
          {
            "label": "Delivery method",
            "hint": "Self-service, in person or online."
          }
        ]
      }
    ],
    "business": [
      {
        "title": "Scope",
        "items": [
          {
            "label": "Scope",
            "hint": "What exactly is delivered, and what is explicitly excluded."
          },
          {
            "label": "Timeline",
            "hint": "How long it takes from start to handover."
          },
          {
            "label": "Price structure",
            "hint": "Fixed, per month, or quoted after a scoping call."
          }
        ]
      },
      {
        "title": "Ongoing",
        "items": [
          {
            "label": "Support",
            "hint": "What happens after delivery if something needs changing."
          },
          {
            "label": "Revisions",
            "hint": "How many rounds are included before extra work is billed."
          },
          {
            "label": "Contract",
            "hint": "Whether you can leave, and what notice is required."
          }
        ]
      }
    ],
    "education": [
      {
        "title": "Format",
        "items": [
          {
            "label": "Format",
            "hint": "Live sessions, self-paced, in person or online."
          },
          {
            "label": "Duration",
            "hint": "Total commitment, not just the headline length."
          },
          {
            "label": "Level",
            "hint": "Where it starts, so you are not repeating or jumping ahead."
          }
        ]
      },
      {
        "title": "Outcome",
        "items": [
          {
            "label": "Certificate",
            "hint": "Whether completion is documented."
          },
          {
            "label": "Support",
            "hint": "Tutor contact, class size or mentor sessions."
          },
          {
            "label": "Availability",
            "hint": "Times that fit your week."
          }
        ]
      }
    ],
    "fashion": [
      {
        "title": "Product details",
        "items": [
          {
            "label": "Material",
            "hint": "What it is made of and how it wears."
          },
          {
            "label": "Fit and sizes",
            "hint": "The range available and whether fit is stated."
          },
          {
            "label": "Weight",
            "hint": "Noticeable on daily-carry items."
          }
        ]
      },
      {
        "title": "Buying",
        "items": [
          {
            "label": "Care",
            "hint": "Washing and maintenance requirements."
          },
          {
            "label": "Returns",
            "hint": "How long you have to change your mind."
          }
        ]
      }
    ],
    "services": [
      {
        "title": "Before you compare prices",
        "items": [
          {
            "label": "Service area",
            "hint": "Where the provider actually works — a cheaper price elsewhere may not apply to you."
          },
          {
            "label": "What is included",
            "hint": "A lower starting price may cover a smaller package."
          },
          {
            "label": "Turnaround",
            "hint": "How long the work takes, and whether it is booked in advance."
          }
        ]
      },
      {
        "title": "Terms",
        "items": [
          {
            "label": "Availability",
            "hint": "Days, times and how far ahead you must book."
          },
          {
            "label": "Delivery method",
            "hint": "On site, mobile, workshop or fully online."
          },
          {
            "label": "Price basis",
            "hint": "Fixed, per session, per package or quoted after inspection."
          }
        ]
      }
    ]
  };
  const goodToKnow = {
    "technology": [
      "Specifications describe the hardware, not how it will feel to you. Two devices with the same numbers can behave differently once you are actually using them.",
      "Advertised battery life is usually measured under favourable conditions. Expect real use to be shorter, especially with heavy apps or screen brightness."
    ],
    "technology:Laptops": [
      "RAM and storage affect different things: more RAM helps with doing several things at once, while storage decides how much you can keep on the machine.",
      "A faster processor usually matters most for long, heavy tasks. For browsing, documents and email, memory and storage often decide whether the machine feels responsive."
    ],
    "technology:Networking": [
      "Advertised wireless speed and real-world coverage are different things. Walls, distance and the number of connected devices affect what you actually get.",
      "Wi-Fi generations are backwards compatible, but you only benefit from the newer standard if your devices support it too."
    ],
    "technology:Smartphones": [
      "Camera figures describe the sensors, not photo quality. Software processing and lens quality often matter more than megapixels.",
      "Storage cannot always be extended, so check whether a memory card slot exists before choosing a smaller capacity."
    ],
    "technology:Audio": [
      "Noise cancelling is most effective on steady sounds such as engines and fans, and least effective on sudden ones such as voices.",
      "Comfort is personal: a heavier headphone with better padding can be easier to wear for hours than a lighter one that presses on your ears."
    ],
    "home": [
      "Dimensions decide whether something fits, and comfort decides whether you keep using it. Check both before comparing prices.",
      "Warranty length is a rough signal of expected lifespan, but it only matters if spare parts and service are still available."
    ],
    "automotive": [
      "Fitment comes before brand or price: a part that does not match the vehicle is not a saving at any price.",
      "Fitting, balancing and disposal are often charged separately, so compare the total cost rather than the headline figure."
    ],
    "travel": [
      "Size and weight limits are set by the operator, not the maker. A bag that meets one airline limit may not meet another.",
      "Cancellation terms matter more on fixed dates. Flexible terms usually cost more upfront and save more if plans change."
    ],
    "business": [
      "Scope is the main thing to pin down: two quotes at the same price can cover very different amounts of work.",
      "Support and revision terms decide what happens after delivery, when changes are usually most expensive."
    ],
    "education": [
      "Level and format matter more than the subject name: a self-paced course and a live class demand very different amounts of time.",
      "A certificate documents completion. Check what it actually says and whether the issuer is recognised for your purpose."
    ],
    "fashion": [
      "Material and construction decide how long something lasts; the look usually decides whether you get the wear out of it.",
      "Sizing varies between makers, so compare measurements where they are stated rather than labels alone."
    ],
    "services": [
      "A lower starting price may cover a smaller package. Check what is included and where the work is done before comparing prices directly.",
      "Quoted ranges often depend on details you have not supplied yet, such as access, size or condition. Ask what changes the final figure."
    ]
  };

  /* Discovery shortcuts and curated homepage selections. */
  const needs = [
    {
      "group": "Technology",
      "icon": "🎓",
      "label": "Student",
      "tag": "student"
    },
    {
      "group": "Technology",
      "icon": "🏠",
      "label": "Remote work",
      "tag": "remote-work"
    },
    {
      "group": "Technology",
      "icon": "💼",
      "label": "Business",
      "tag": "business"
    },
    {
      "group": "Technology",
      "icon": "🎮",
      "label": "Gaming",
      "tag": "gaming"
    },
    {
      "group": "Technology",
      "icon": "🎒",
      "label": "Portable",
      "tag": "portable"
    },
    {
      "group": "Technology",
      "icon": "💰",
      "label": "Budget",
      "tag": "budget"
    },
    {
      "group": "Home",
      "icon": "📐",
      "label": "Small space",
      "q": "compact"
    },
    {
      "group": "Home",
      "icon": "🖥️",
      "label": "Home office",
      "q": "desk chair office"
    },
    {
      "group": "Home",
      "icon": "👨‍👩‍👧",
      "label": "Family",
      "tag": "family"
    },
    {
      "group": "Home",
      "icon": "🛋️",
      "label": "Comfort",
      "q": "comfort"
    },
    {
      "group": "Automotive",
      "icon": "🔧",
      "label": "Maintenance",
      "q": "battery tyres maintenance"
    },
    {
      "group": "Automotive",
      "icon": "🛡️",
      "label": "Safety",
      "q": "dash camera safety"
    },
    {
      "group": "Automotive",
      "icon": "🧼",
      "label": "Car care",
      "tag": "detailing"
    },
    {
      "group": "Automotive",
      "icon": "🧳",
      "label": "Travel gear",
      "q": "luggage travel"
    },
    {
      "group": "Services",
      "icon": "💼",
      "label": "For a business",
      "q": "business website invoicing"
    },
    {
      "group": "Services",
      "icon": "🏡",
      "label": "For the home",
      "q": "cleaning"
    },
    {
      "group": "Services",
      "icon": "🧑",
      "label": "Personal",
      "tag": "fitness"
    },
    {
      "group": "Services",
      "icon": "🛠️",
      "label": "Professional",
      "tag": "professional"
    },
    {
      "group": "Services",
      "icon": "🌱",
      "label": "Beginner",
      "tag": "beginner"
    },
    {
      "group": "Services",
      "icon": "⚡",
      "label": "Fast turnaround",
      "tag": "fast"
    }
  ];
  const popularTags = [
    "budget",
    "premium",
    "student",
    "business",
    "remote-work",
    "portable",
    "wireless",
    "family",
    "nairobi",
    "professional",
    "fast",
    "beginner"
  ];
  const defaultCompareIds = [
    "headphones-quietmax-700",
    "headphones-basswave-700",
    "headphones-airflow-studio-pro"
  ];
  const homeFeaturedIds = [
    "laptop-slatebook-air-14",
    "chair-ergoform-mesh",
    "detailing-shinelab-full-detail",
    "luggage-alpine-cabin-22",
    "service-studionine-web-design",
    "service-safedrive-driving-lessons",
    "bag-urbansling-laptop-backpack",
    "service-fibermax-fibre-300"
  ];
  const homeDealIds = [
    "headphones-quietmax-700",
    "service-sparklehome-deep-clean",
    "tyre-roadgrip-195-65"
  ];
  const homeGuideIds = [
    "guide-compare-smartphones",
    "guide-service-providers",
    "guide-evaluate-a-deal"
  ];

  return {
    version: version,
    demoNotice: demoNotice,
    taxonomy: taxonomy,
    locations: locations,
    sellers: sellers,
    listings: listings,
    offers: offers,
    guides: guides,
    priceBands: priceBands,
    sortOptions: sortOptions,
    compareFocus: compareFocus,
    compareGroups: compareGroups,
    considerations: considerations,
    goodToKnow: goodToKnow,
    needs: needs,
    popularTags: popularTags,
    defaultCompareIds: defaultCompareIds,
    homeFeaturedIds: homeFeaturedIds,
    homeDealIds: homeDealIds,
    homeGuideIds: homeGuideIds
  };
})();
