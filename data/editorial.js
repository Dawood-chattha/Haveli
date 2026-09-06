/* =========================================================================
   editorial.js — the homepage feature band and the proof strip
   -------------------------------------------------------------------------
   UI-only data. Copy is written for this build; none of the reference
   storefront's marketing text is reproduced.

   The feature band's layout is measured from the reference: a full-bleed
   50/50 split, image on the left, text on the right, 944px tall on desktop.

   The proof strip below it is NOT a reproduction. The reference has a band
   in roughly that position, but it is a third-party widget whose internals
   could not be inspected, so this is a plain stats row of my own instead of
   a guess dressed up as a copy.
   ========================================================================= */

window.ZB = window.ZB || {};

(function (ZB) {
  'use strict';

  ZB.editorial = {

    feature: {
      eyebrow: 'Instant classics',
      title: 'The chikankari edit, while it lasts',
      body: 'Hand-worked panels on soft lawn, in the shades that sell out first. ' +
            'Cut generously, finished plainly, and priced to be worn on an ordinary ' +
            'Tuesday rather than saved for later.',
      ctaLabel: 'Shop chikankari',
      ctaPath: '/category/women/chikankari',
      image: 'assets/img/rails/editorial-chikankari.jpg'
    },

    proof: {
      title: 'Why people keep coming back',
      stats: [
        { value: '120+', label: 'Stores across Pakistan' },
        { value: '4.6', label: 'Average customer rating' },
        { value: '14 days', label: 'Exchange and return window' },
        { value: '48 hrs', label: 'Dispatch on in-stock orders' }
      ]
    }
  };

}(window.ZB));
