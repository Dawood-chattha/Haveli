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
      .add('/checkout', pages.checkout)
      /* By reference rather than by id: a reference is what the
         confirmation shows, what an email would quote and what somebody
         reads out over the phone. */
      .add('/order/:ref', pages.order)
      .add('/wishlist', pages.wishlist)
      .add('/account', pages.account)
      /* The destination of the link in a password-reset email, and also the
         page somebody reaches from "Forgot password?" before any email has
         been sent. One route, because it is one errand — see the module. */
      .add('/reset-password', pages.resetPassword)
      .add('/stores', pages.stores)
      /* Footer destinations. */
      .add('/faqs', pages.faqs)
      .add('/how-to-buy', pages.howToBuy)
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
