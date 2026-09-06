/* =========================================================================
   catalogue.js — seed data for the mock product catalogue
   -------------------------------------------------------------------------
   UI-only data. This file holds only the raw ingredients; assets/js/catalogue.js
   expands them against ZB.navigation so every category in the drawer has
   products behind it without a 500-entry hand-written list.

   Everything here is invented. Titles follow the shape the reference uses
   ("Essential Polo - 5001") but none of its actual product copy, imagery or
   prices are reproduced.
   ========================================================================= */

window.ZB = window.ZB || {};

window.ZB.catalogueSeed = {

  /* How many products each leaf category gets. */
  perCategory: 8,

  /* Roughly one product in seven carries a badge, one in five is reduced —
     the reference shows badges sparingly, so this stays restrained. */
  badgeEvery: 7,
  saleEvery: 5,

  /* One in nine is out of stock, so the Availability facet has something to
     filter and the card has a sold-out state worth showing. */
  outOfStockEvery: 9,

  /* -----------------------------------------------------------------------
     IMAGERY BY CATEGORY

     Each department below carries a default set of garment photographs, but
     a department is not one kind of product: Women contains Fragrance and
     Footwear as well as dresses. Picking imagery per department put bottles
     of perfume and pairs of shoes behind photographs of kaftans.

     So a category names its own pool where the department default would be
     wrong, and anything not listed here falls back to its department.
     Children inherit from their parent — listing "fragrance" covers Body
     Mist, Eau De Parfum and Gift Sets underneath it.
     ----------------------------------------------------------------------- */

  imagePools: {
    scent:    ['scent-01', 'scent-02'],
    footwear: ['footwear-01', 'footwear-02'],
    bag:      ['bag-01', 'bag-02'],
    bottoms:  ['bottoms-01', 'bottoms-02'],
    outer:    ['outer-01', 'outer-02'],
    fabric:   ['fabric-01', 'fabric-02']
  },

  /* Category slug (or its parent's slug) -> pool name above. */
  categoryPools: {
    'fragrance': 'scent',

    'footwear': 'footwear',

    'accessories': 'bag',
    'bags': 'bag', 'stoles': 'bag', 'scarves': 'bag',
    'caps': 'bag', 'wallets': 'bag', 'card-holders': 'bag',
    'belts': 'bag', 'socks': 'bag',

    'bottoms': 'bottoms', 'shorts': 'bottoms', 'trousers': 'bottoms',

    'outerwear': 'outer',

    'unstitched': 'fabric'
  },

  /* Colour names are shown as a swatch on the product page, so each needs a
     value to paint. Keyed by the names used in the departments below. */
  colourHex: {
    'Mustard': '#c8992e', 'Charcoal': '#3a3a3a', 'Off White': '#efece4',
    'Sage': '#93a184', 'Navy': '#26364a', 'Rust': '#a4552f',
    'Ink Blue': '#2b3350', 'Sand': '#cbb894',

    'Rose': '#9c3f52', 'Ivory': '#f2ece2', 'Teal': '#3d6b6b',
    'Plum': '#5b4a76', 'Olive': '#6d6f43', 'Blush': '#dfb4b4',
    'Midnight': '#1f2436', 'Terracotta': '#b56046',

    'Sunshine': '#e8bb42', 'Mint': '#9ccdb6', 'Coral': '#e58163',
    'Sky': '#8fbcd8', 'Lilac': '#b9a5cd', 'Apple': '#7fae5a',
    'Peach': '#f0b391', 'Denim': '#4a6b8a'
  },

  badges: [
    'Best Seller',
    'Limited',
    'Hot',
    'Low Stock',
    'Most Wanted',
    'Last Batch'
  ],

  departments: {

    men: {
      code: 'M',
      images: ['men-01', 'men-02', 'men-03'],
      /* Price band in PKR; the generator picks a step within it. */
      price: [990, 6990],
      adjectives: [
        'Essential', 'Classic', 'Signature', 'Textured',
        'Everyday', 'Tailored', 'Premium', 'Heritage'
      ],
      colours: [
        'Mustard', 'Charcoal', 'Off White', 'Sage',
        'Navy', 'Rust', 'Ink Blue', 'Sand'
      ],
      sizes: ['S', 'M', 'L', 'XL', 'XXL'],
      fabrics: ['Cotton', 'Linen', 'Jersey', 'Denim', 'Wash & Wear']
    },

    women: {
      code: 'W',
      images: ['women-01', 'women-02', 'women-03', 'women-04'],
      price: [1490, 12990],
      adjectives: [
        'Essential', 'Luxury', 'Signature', 'Summer',
        'Festive', 'Heritage', 'Everyday', 'Handworked'
      ],
      colours: [
        'Rose', 'Ivory', 'Teal', 'Plum',
        'Olive', 'Blush', 'Midnight', 'Terracotta'
      ],
      sizes: ['XS', 'S', 'M', 'L', 'XL'],
      fabrics: ['Lawn', 'Cambric', 'Khaddar', 'Chiffon', 'Silk', 'Cotton Net']
    },

    kids: {
      code: 'K',
      images: ['kids-01', 'kids-02'],
      price: [790, 3990],
      adjectives: [
        'Playtime', 'Everyday', 'Festive', 'Comfort',
        'Weekend', 'Little', 'Sunday', 'Summer'
      ],
      colours: [
        'Sunshine', 'Mint', 'Coral', 'Sky',
        'Lilac', 'Apple', 'Peach', 'Denim'
      ],
      sizes: ['2-3Y', '4-5Y', '6-7Y', '8-9Y', '10-11Y'],
      fabrics: ['Cotton', 'Jersey', 'Poplin']
    }
  }
};
