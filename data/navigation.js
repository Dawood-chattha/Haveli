/* =========================================================================
   navigation.js — the menu, as a fallback
   -------------------------------------------------------------------------
   THIS IS NO LONGER WHERE THE MENU COMES FROM.

   The categories table is, and assets/js/bootstrap.js fetches it from
   /api/categories and replaces ZB.navigation with it before the first page
   renders. A category the owner adds in the panel appears in the drawer;
   one they hide leaves it.

   What is below is the structure the database was seeded with, and it is
   kept for the one case where the fetch does not arrive: a menu that is
   slightly out of date leaves the site navigable, where no menu at all
   leaves it looking broken. The catalogue deliberately has no equivalent —
   a stale menu is a small wrong; invented products are a customer ordering
   something that does not exist.

   Shape, which api/_lib/shape.js reproduces exactly:
     { id, label, items: [ { label, children?: [ { label } ] } ] }
   ========================================================================= */

window.ZB = window.ZB || {};

window.ZB.navigation = [
  {
    id: 'men',
    label: 'Men',
    items: [
      {
        label: 'Eastern Wear',
        children: [
          { label: 'Shalwar Kameez' },
          { label: 'Kurta' },
          { label: 'Waist Coat' },
          { label: 'Kurta Pajama' },
          { label: 'Blazers' },
          { label: 'Shawls' }
        ]
      },
      {
        label: 'T-Shirts',
        children: [
          { label: 'Basic T-Shirt' },
          { label: 'Graphic T-Shirts' },
          { label: 'Oversized T-Shirt' }
        ]
      },
      {
        label: 'Polo',
        children: [
          { label: 'Basic Polo' },
          { label: 'Classic Polo' },
          { label: 'Signature Polo' },
          { label: 'Textured Polo' }
        ]
      },
      {
        label: 'Shirts',
        children: [
          { label: 'Linen Shirts' },
          { label: 'Casual Shirts' },
          { label: 'Formal Shirts' }
        ]
      },
      {
        label: 'Bottoms',
        children: [
          { label: 'Cargo Pants' },
          { label: 'Knitted Pants' },
          { label: 'All Day Pants' },
          { label: 'All Day Satin Pants' },
          { label: 'Chinos' },
          { label: 'Jeans' }
        ]
      },
      {
        label: 'Outerwear',
        children: [
          { label: 'Hoodies' },
          { label: 'Denim Jackets' },
          { label: 'Sweat Shirts' }
        ]
      },
      {
        label: 'Unstitched',
        children: [
          { label: 'Cotton' },
          { label: 'Wash & Wear' }
        ]
      },
      {
        label: 'Accessories',
        children: [
          { label: 'Caps' },
          { label: 'Wallets' },
          { label: 'Card Holders' },
          { label: 'Belts' },
          { label: 'Socks' }
        ]
      },
      { label: 'Shorts' },
      { label: 'Footwear' },
      {
        label: 'Fragrance',
        children: [
          { label: 'Body Mist' },
          { label: 'Eau De Parfum' },
          { label: 'Gift Sets' }
        ]
      }
    ]
  },

  {
    id: 'women',
    label: 'Women',
    items: [
      {
        label: 'Ready To Wear',
        children: [
          { label: 'Essential Pret' },
          { label: 'Summer Pret' },
          { label: 'Signature Pret' },
          { label: 'Luxury Pret' },
          { label: 'Chikankari' }
        ]
      },
      {
        label: 'Unstitched',
        children: [
          { label: 'Summer Unstitched' },
          { label: 'Lawn' },
          { label: 'Cambric' },
          { label: 'Khaddar' }
        ]
      },
      {
        label: 'West',
        children: [
          { label: 'Co-Ords' },
          { label: 'Tunics' },
          { label: 'Tops' },
          { label: 'Trousers' }
        ]
      },
      {
        label: 'Dresses',
        children: [
          { label: 'Kaftans' },
          { label: 'Maxi Dresses' },
          { label: 'Kurta Dupatta' }
        ]
      },
      {
        label: 'Accessories',
        children: [
          { label: 'Bags' },
          { label: 'Stoles' },
          { label: 'Scarves' }
        ]
      },
      { label: 'Footwear' },
      {
        label: 'Fragrance',
        children: [
          { label: 'Body Mist' },
          { label: 'Eau De Parfum' },
          { label: 'Gift Sets' }
        ]
      }
    ]
  },

  {
    id: 'kids',
    label: 'Kids',
    items: [
      {
        label: 'Girls',
        children: [
          { label: 'Eastern Wear' },
          { label: 'Western Wear' },
          { label: 'Frocks' },
          { label: 'Co-Ords' }
        ]
      },
      {
        label: 'Boys',
        children: [
          { label: 'Kurta Shalwar' },
          { label: 'T-Shirts' },
          { label: 'Shirts' },
          { label: 'Bottoms' }
        ]
      },
      { label: 'New In' },
      { label: 'Accessories' }
    ]
  }
];

/* Utility tiles pinned to the bottom of the drawer. */
window.ZB.navUtilities = [
  { label: 'Stores', href: '/stores', icon: 'pin' }
];
