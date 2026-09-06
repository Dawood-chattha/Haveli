/* =========================================================================
   pages/wishlist.js — saved items
   -------------------------------------------------------------------------
   Wishlist membership is a list of product ids in ZB.store, resolved against
   the catalogue and rendered with the same card as every other listing.
   Unsaving an item here removes its card straight away, so the page stays
   truthful while you use it.
   ========================================================================= */

window.ZB = window.ZB || {};
window.ZB.pages = window.ZB.pages || {};

(function (ZB) {
  'use strict';

  /* Held so the subscription can be dropped when the route changes. */
  var unsubscribe = null;

  function release() {
    if (unsubscribe) unsubscribe();
    unsubscribe = null;
  }

  ZB.pages.wishlist = {

    title: 'Wishlist',

    render: function () {
      var ui = ZB.ui;

      return '' +
        '<div class="route-page container">' +
          ui.breadcrumbs([{ label: 'Home', path: '/' }, { label: 'Wishlist' }]) +
          ui.pageHead({ eyebrow: 'Saved', title: 'Your wishlist' }) +
          '<div id="wishlist-grid"></div>' +
        '</div>';
    },

    mount: function () {
      var root = document.getElementById('wishlist-grid');
      if (!root) return;

      var paint = function () {
        ZB.productCard.mount(root, ZB.catalogue.byIds(ZB.store.state.wishlist), {
          empty: ZB.ui.emptyState({
            title: 'Nothing saved yet',
            body: 'Tap the heart on any product to keep it here.',
            ctaLabel: 'Start browsing',
            ctaHref: '/'
          })
        });
      };

      paint();

      /* Redraw when a heart is toggled. The subscription retires itself as
         soon as its grid has left the document, which is what happens the
         moment the router swaps in another page. Listening for zb:navigated
         would not work here: the router fires it at the end of the very
         render that called this mount, so the listener would cancel the
         subscription it had just made. */
      release();
      var first = true;

      unsubscribe = ZB.store.subscribe(function () {
        if (first) { first = false; return; }   /* subscribe fires immediately */
        if (!document.body.contains(root)) { release(); return; }
        paint();
      });
    }
  };

}(window.ZB));
