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

  ZB.adminPages.categories = stub({
    title: 'Categories',
    sub: 'How the catalogue is organised.',
    phase: '6',
    icon: 'layers',
    blurb: 'The category tree behind the storefront menu, with the count of ' +
           'products sitting in each one.',
    bullets: [
      'List with product counts and status',
      'Add, edit and delete',
      'Search'
    ]
  });

  ZB.adminPages.orders = stub({
    title: 'Orders',
    sub: 'What customers have bought.',
    phase: '7',
    icon: 'receipt',
    blurb: 'Every order, its payment state and where it has reached, plus a ' +
           'full detail view.',
    bullets: [
      'Order ID, customer, date, items and total',
      'Payment status and order status',
      'Pending, Processing, Shipped, Delivered, Cancelled',
      'Order detail view'
    ]
  });

  ZB.adminPages.customers = stub({
    title: 'Customers',
    sub: 'Who is buying.',
    phase: '8',
    icon: 'users',
    blurb: 'The customer list with the history that makes each entry worth ' +
           'reading.',
    bullets: [
      'Search and filters',
      'Order count and total spending',
      'Account status and customer detail'
    ]
  });

  ZB.adminPages.inventory = stub({
    title: 'Inventory',
    sub: 'What is left on the shelf.',
    phase: '9',
    icon: 'archive',
    blurb: 'Stock levels across the catalogue, with the items that need ' +
           'attention brought to the top.',
    bullets: [
      'SKU, available quantity and stock status',
      'Low stock and out of stock indicators',
      'Search and filter'
    ]
  });

  ZB.adminPages.banners = stub({
    title: 'Banners',
    sub: 'The promotional slides on the homepage.',
    phase: '10',
    icon: 'image',
    blurb: 'Control of the hero carousel the storefront opens with.',
    bullets: [
      'Preview, title, subtitle and image',
      'Link target and active state',
      'Add, edit and delete'
    ]
  });

  ZB.adminPages.coupons = stub({
    title: 'Coupons',
    sub: 'Discount codes.',
    phase: '10',
    icon: 'ticket',
    blurb: 'Codes, what they take off, and how long they last.',
    bullets: [
      'Code, discount type and value',
      'Expiry, usage limit and status',
      'Add, edit and delete'
    ]
  });

  ZB.adminPages.reports = stub({
    title: 'Reports',
    sub: 'How the store is performing.',
    phase: '11',
    icon: 'chart',
    blurb: 'Sales, orders and product performance over a period you choose.',
    bullets: [
      'Sales and orders reports',
      'Product performance and customer statistics',
      'Revenue overview with date filters'
    ]
  });

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
