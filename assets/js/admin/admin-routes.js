/* =========================================================================
   admin-routes.js — the admin route table and boot
   -------------------------------------------------------------------------
   The admin counterpart of assets/js/routes.js, and it drives the very same
   router: assets/js/router.js is loaded here unchanged.

   That works because the router keeps its route table in module scope. The
   admin panel is served from its own HTML document, so loading the router
   there gives it a fresh, empty table — the storefront's routes are not
   present and cannot be reached from inside the panel, and the reverse is
   equally true. Two route tables, one implementation, no fork to maintain.

   The consequence is that a link from one shell to the other is a real page
   load rather than a route. Those links carry `data-full-load`, which the
   router's click handler respects.

   Loaded last, so every page module is registered before the router runs.
   ========================================================================= */

window.ZB = window.ZB || {};

(function (ZB) {
  'use strict';

  function boot() {
    var pages = ZB.adminPages;

    ZB.router
      /* Sign in sits outside the panel chrome; the shell hides itself here. */
      .add('/admin/login', pages.login)

      .add('/admin', pages.dashboard)

      /* More specific product paths before the plain list, matching the
         convention in the storefront's route table. */
      .add('/admin/products/new', pages.productNew)
      .add('/admin/products/:id/edit', pages.productEdit)
      .add('/admin/products', pages.products)

      .add('/admin/categories', pages.categories)

      /* The detail view before the list, same convention as products. */
      .add('/admin/orders/:id', pages.orderDetail)
      .add('/admin/orders', pages.orders)

      .add('/admin/customers/:id', pages.customerDetail)
      .add('/admin/customers', pages.customers)
      .add('/admin/inventory', pages.inventory)
      .add('/admin/banners', pages.banners)
      .add('/admin/coupons', pages.coupons)
      .add('/admin/reports', pages.reports)
      .add('/admin/settings', pages.settings)

      .setNotFound(pages.notFound);

    /* The shell is built before the first render so that it catches the
       first `zb:navigated` too — otherwise the panel would open with an
       empty breadcrumb and nothing marked active until the second
       navigation. */
    ZB.adminShell.init();

    ZB.router.start(document.getElementById('admin-app'));
  }

  /* -----------------------------------------------------------------------
     THE ROUTE GUARD — WHICH IS NOT THE SECURITY

     This decides what the panel draws. It does not decide what anyone may
     read, and it is important to be exact about the difference.

     Everything in this file was downloaded by the visitor and runs on their
     machine. They can pause it, edit it, or set ZB.auth.user to whatever
     they like from the console, and this guard will let them through. What
     they arrive at is a panel with nothing in it: every request it makes is
     answered by an endpoint that re-reads the role from the database, and
     underneath that, Row Level Security refuses the rows to anyone whose
     account is not an admin. Two locks, neither of them here.

     So this exists for the ordinary case — someone signed out, or a customer
     who followed a link — who should meet a sign-in screen rather than a
     dashboard full of failed requests. It is a signpost, not a lock.
     ----------------------------------------------------------------------- */

  var LOGIN = '/admin/login';

  function guard(path) {
    var onLogin = path === LOGIN;

    if (!ZB.auth.isAdmin()) {
      /* `replace` rather than a push: a redirect the visitor did not ask for
         should not become a step in their history that Back returns to. */
      if (!onLogin) ZB.router.navigate(LOGIN, { replace: true });
      return;
    }

    /* Already signed in and looking at the sign-in screen — there is nothing
       to do there. */
    if (onLogin) ZB.router.navigate('/admin', { replace: true });
  }

  function start() {
    /* Two things are awaited before the router runs.
     *
     * Who is calling, so the panel does not paint a dashboard and then
     * snatch it away — a visitor who is signed in sees the dashboard, one
     * who is not sees the sign-in screen, nobody sees both.
     *
     * And the shop's own data, because the sections that have not been
     * connected to the API yet still read ZB.catalogue and ZB.navigation,
     * and those now arrive over the network. See assets/js/bootstrap.js;
     * it resolves whether the load worked or not, so a failure still opens
     * the panel rather than leaving a blank page. */
    Promise.all([
      ZB.auth.load(),
      (ZB.data && ZB.data.ready) || Promise.resolve()
    ]).then(function () {
      boot();
      guard(window.location.pathname);

      /* The event's `detail.path` is the matched route pattern, so an order
         detail arrives as '/admin/orders/:id'. The guard needs the address
         the visitor is actually at, which is the location. */
      document.addEventListener('zb:navigated', function () {
        guard(window.location.pathname);
      });

      /* Signing out has to move the panel, and signing in has to let it
         open. Subscribing means neither the sign-in form nor the sign-out
         button has to know about routing. */
      ZB.auth.subscribe(function () {
        guard(window.location.pathname);
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

}(window.ZB));
