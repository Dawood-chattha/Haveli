/* =========================================================================
   navigation.js — mock category tree for the menu drawer
   -------------------------------------------------------------------------
   UI-only data. Structure mirrors the reference storefront's drawer: three
   top-level departments, each a flat list of categories where some categories
   open a nested panel of sub-categories.

   Shape:
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
  { label: 'Stores', href: '/stores', icon: 'pin' },
  { label: 'Tracking', href: '/tracking', icon: 'truck' },
  { label: 'Careers', href: '/careers', icon: 'briefcase' }
];
