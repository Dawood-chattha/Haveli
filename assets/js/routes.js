/* =========================================================================
   routes.js — route table and boot
   -------------------------------------------------------------------------
   Loaded last: every page module must be registered before the router runs.
   More specific paths are declared before looser ones, since the first
   match wins.
   ========================================================================= */

window.ZB = window.ZB || {};

(function (ZB) {
  'use strict';

  function boot() {
    var pages = ZB.pages;

    ZB.router
      .add('/', pages.home)
      .add('/category/:dept/:sub', pages.category)
      .add('/category/:dept', pages.category)
      .add('/product/:id', pages.product)
      .add('/search', pages.search)
      .add('/cart', pages.cart)
      .add('/wishlist', pages.wishlist)
      .add('/account', pages.account)
      .add('/stores', pages.stores)
      .add('/tracking', pages.tracking)
      .add('/careers', pages.careers)
      /* Footer destinations. */
      .add('/faqs', pages.faqs)
      .add('/how-to-buy', pages.howToBuy)
      .add('/payment', pages.payment)
      .add('/shipping', pages.shipping)
      .add('/returns', pages.returns)
      .add('/about', pages.about)
      .add('/contact', pages.contact)
      .add('/terms', pages.terms)
      .add('/privacy', pages.privacy)
      .setNotFound(pages.notFound);

    /* Built once, before the first route renders, so its links are already
       in the document when the router marks the active one. */
    if (ZB.siteFooter) ZB.siteFooter.init();

    ZB.router.start(document.getElementById('app'));

    /* Navigating away should always close whatever panel is open — the
       drawer is the main way through the catalogue, so this fires often. */
    document.addEventListener('zb:navigated', function () {
      if (ZB.panels && ZB.panels.current) ZB.panels.close();
    });
  }

  /* The router is started only once the catalogue and the menu are in.
     Starting it first would render the home page against an empty shop and
     then have to redraw it, and a category route would decide there was
     nothing in the category before anything had arrived. See
     assets/js/bootstrap.js — it resolves whether the load succeeded or not,
     so a failure still boots the site, with the pages' own empty states. */
  function start() {
    if (ZB.data && ZB.data.whenReady) ZB.data.whenReady(boot);
    else boot();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

}(window.ZB));
