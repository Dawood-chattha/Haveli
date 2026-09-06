/* =========================================================================
   rails.js — the three department rails on the homepage
   -------------------------------------------------------------------------
   UI-only data. Each rail is a department with a row of tabs; each tab holds
   three collection tiles and an "explore" tile that leads to the whole
   category. These are collection tiles, not product cards: a picture, an
   optional badge and a name, with no price.

   Every `category` below is a real label from ZB.navigation, so each tile
   and each explore tile resolves to a category route that actually exists.

   Shape:
     { id, title, subtitle, background, dept, tabs: [
         { label, category, explore: { count }, tiles: [ { label, badge?, image } ] }
     ] }

   Titles are department names; the subtitles are written for this build and
   are not the reference storefront's marketing copy.
   ========================================================================= */

window.ZB = window.ZB || {};

(function (ZB) {
  'use strict';

  var IMG = 'assets/img/rails/';

  ZB.rails = [

  {
    id: 'women',
    title: 'Women',
    subtitle: 'Everyday pieces and occasion wear, cut to fit the season.',
    background: IMG + 'bg-women.jpg',
    dept: 'women',
    exploreImage: IMG + 'explore-women.jpg',

    tabs: [
      {
        label: 'Ready To Wear',
        category: 'Ready To Wear',
        explore: { count: 960 },
        tiles: [
          { label: 'Essential Pret', badge: 'Best Seller', image: IMG + 'tile-01.jpg' },
          { label: 'Summer Pret', image: IMG + 'tile-02.jpg' },
          { label: 'Chikankari', badge: 'Limited', image: IMG + 'tile-03.jpg' }
        ]
      },
      {
        label: 'Unstitched',
        category: 'Unstitched',
        explore: { count: 480 },
        tiles: [
          { label: 'Lawn', badge: 'Hot', image: IMG + 'tile-02.jpg' },
          { label: 'Cambric', image: IMG + 'tile-03.jpg' },
          { label: 'Khaddar', image: IMG + 'tile-04.jpg' }
        ]
      },
      {
        label: 'West',
        category: 'West',
        explore: { count: 210 },
        tiles: [
          { label: 'Co-Ords', image: IMG + 'tile-03.jpg' },
          { label: 'Tunics', badge: 'Most Wanted', image: IMG + 'tile-04.jpg' },
          { label: 'Trousers', image: IMG + 'tile-01.jpg' }
        ]
      },
      {
        label: 'Dresses',
        category: 'Dresses',
        explore: { count: 145 },
        tiles: [
          { label: 'Kaftans', badge: 'Best Seller', image: IMG + 'tile-04.jpg' },
          { label: 'Maxi Dresses', image: IMG + 'tile-01.jpg' },
          { label: 'Kurta Dupatta', image: IMG + 'tile-02.jpg' }
        ]
      }
    ]
  },

  {
    id: 'men',
    title: 'Men',
    subtitle: 'Shirting, knits and eastern wear that hold their colour.',
    background: IMG + 'bg-men.jpg',
    dept: 'men',
    exploreImage: IMG + 'explore-men.jpg',

    tabs: [
      {
        label: 'Eastern Wear',
        category: 'Eastern Wear',
        explore: { count: 220 },
        tiles: [
          { label: 'Shalwar Kameez', badge: 'Best Seller', image: IMG + 'tile-05.jpg' },
          { label: 'Kurta', image: IMG + 'tile-06.jpg' },
          { label: 'Waist Coat', image: IMG + 'tile-07.jpg' }
        ]
      },
      {
        label: 'Polo',
        category: 'Polo',
        explore: { count: 96 },
        tiles: [
          { label: 'Classic Polo', image: IMG + 'tile-06.jpg' },
          { label: 'Signature Polo', badge: 'Limited', image: IMG + 'tile-07.jpg' },
          { label: 'Textured Polo', image: IMG + 'tile-05.jpg' }
        ]
      },
      {
        label: 'T-Shirts',
        category: 'T-Shirts',
        explore: { count: 128 },
        tiles: [
          { label: 'Basic T-Shirt', image: IMG + 'tile-07.jpg' },
          { label: 'Graphic T-Shirts', badge: 'Hot', image: IMG + 'tile-05.jpg' },
          { label: 'Oversized T-Shirt', image: IMG + 'tile-06.jpg' }
        ]
      }
    ]
  },

  {
    id: 'scents',
    title: 'Scents',
    subtitle: 'Light enough for the morning, close enough to remember.',
    background: IMG + 'bg-scents.jpg',
    /* Fragrance sits inside both departments, so each tab names its own. */
    exploreImage: IMG + 'explore-scents.jpg',

    tabs: [
      {
        label: 'For Her',
        dept: 'women',
        category: 'Fragrance',
        explore: { count: 34 },
        tiles: [
          { label: 'Body Mist', badge: 'Best Seller', image: IMG + 'tile-08.jpg' },
          { label: 'Eau De Parfum', image: IMG + 'tile-10.jpg' },
          { label: 'Gift Sets', image: IMG + 'tile-09.jpg' }
        ]
      },
      {
        label: 'For Him',
        dept: 'men',
        category: 'Fragrance',
        explore: { count: 28 },
        tiles: [
          { label: 'Body Mist', image: IMG + 'tile-09.jpg' },
          { label: 'Eau De Parfum', badge: 'Low Stock', image: IMG + 'tile-08.jpg' },
          { label: 'Gift Sets', image: IMG + 'tile-10.jpg' }
        ]
      }
    ]
  }

  ];

}(window.ZB));
