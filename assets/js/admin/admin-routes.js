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
      .add('/admin/orders', pages.orders)
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

}(window.ZB));
