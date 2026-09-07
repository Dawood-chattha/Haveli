/* =========================================================================
   pages/placeholders.js — a real destination for every admin route
   -------------------------------------------------------------------------
   Each section of the panel is built in its own phase. Until a section
   arrives, its route still resolves to a page that says what it is and what
   it will hold, rather than to nothing at all.

   That distinction matters while the panel is half-built: a menu item that
   renders an empty screen looks exactly like one that is broken, and there
   would be no way to tell whether navigation actually works. These pages
   make the routing testable from the first phase.

   As each phase lands, its module replaces the matching entry here and the
   stub is deleted. Nothing else changes — admin-routes.js keeps pointing at
   the same name on ZB.adminPages.

   PAGE SHAPE
   The same contract the storefront's page modules use, plus `crumbs`, which
   the shell reads to build the topbar trail:

     { title, crumbs, render(params), mount(params) }
   ========================================================================= */

window.ZB = window.ZB || {};
window.ZB.adminPages = window.ZB.adminPages || {};

(function (ZB) {
  'use strict';

  var ui = ZB.adminUI;

  /**
   * Build a placeholder page.
   *
   * o: { title, sub, phase, icon, blurb, bullets[], crumbs }
   */
  function stub(o) {
    return {
      title: o.title,
      crumbs: o.crumbs || [{ label: o.title }],

      render: function () {
        return '' +
          ui.pageHead({ title: o.title, sub: o.sub }) +
          ui.placeholder({
            title: o.title,
            phase: o.phase,
            icon: o.icon,
            blurb: o.blurb,
            bullets: o.bullets
          });
      }
    };
  }

  /* -----------------------------------------------------------------------
     Sections
     ----------------------------------------------------------------------- */

  /* The dashboard is a built section now, and lives in pages/dashboard.js. */

  /* Products, and the add/edit form, are built sections now. They live in
     pages/products.js and pages/product-form.js. */

  /* Categories is a built section now, and lives in pages/categories.js. */

  /* Orders, and the single-order view, are built sections now. They live
     in pages/orders.js and pages/order-detail.js. */

  /* Customers, and the single-customer view, are built sections now. They
     live in pages/customers.js and pages/customer-detail.js. */

  /* Inventory is a built section now, and lives in pages/inventory.js. */

  /* Banners is a built section now, and lives in pages/banners.js. */

  /* Coupons is a built section now, and lives in pages/coupons.js. */

  /* Reports is a built section now, and lives in pages/reports.js. */

  ZB.adminPages.settings = stub({
    title: 'Settings',
    sub: 'Store and account preferences.',
    phase: '12',
    icon: 'sliders',
    blurb: 'Store details, the admin profile, and how the panel behaves.',
    bullets: [
      'Store information and general settings',
      'Admin profile',
      'Notification preferences and appearance'
    ]
  });

  /* Sign in is a built section now, and lives in pages/login.js. */

  /* -----------------------------------------------------------------------
     Not found
     ----------------------------------------------------------------------- */

  ZB.adminPages.notFound = {
    title: 'Page not found',
    crumbs: [{ label: 'Not found' }],

    render: function () {
      return '' +
        ui.pageHead({
          title: 'Page not found',
          sub: 'That address does not match anything in the admin panel.'
        }) +
        '<div class="a-placeholder">' +
          '<p class="a-placeholder__blurb">' +
            'Check the address, or pick a section from the menu.' +
          '</p>' +
          '<a class="btn btn--primary" href="' + ui.href('/admin') + '">' +
            'Go to the dashboard' +
          '</a>' +
        '</div>';
    }
  };

}(window.ZB));
