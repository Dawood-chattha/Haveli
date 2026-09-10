/* =========================================================================
   admin-nav.js — the admin sidebar's menu
   -------------------------------------------------------------------------
   Data only. `icon` names a shape in ZB.adminUI's icon set rather than
   carrying markup, so the menu stays a plain list and the drawing lives
   with the rest of the UI code.

   `badge` names a counter that ZB.repo.metrics.navBadges() can fill in.
   An item without one simply never shows a badge.

   Every `path` here is registered in assets/js/admin/admin-routes.js. If a
   path is added to one and not the other the link lands on the admin 404,
   which is deliberate — a menu item should never be a dead button.
   ========================================================================= */

window.ZB = window.ZB || {};

(function (ZB) {
  'use strict';

  ZB.adminNav = [
    { label: 'Dashboard',  path: '/admin',            icon: 'grid',
      /* Every other item lights up for its own sub-pages too, which the
         router works out from the path. Dashboard cannot: '/admin' is a
         prefix of all of them, so it would stay lit everywhere. It opts out
         of the router's marking and the shell sets it exactly. */
      exact: true },

    { label: 'Products',   path: '/admin/products',   icon: 'box' },
    { label: 'Categories', path: '/admin/categories', icon: 'layers' },
    { label: 'Orders',     path: '/admin/orders',     icon: 'receipt', badge: 'orders' },
    { label: 'Customers',  path: '/admin/customers',  icon: 'users' },
    { label: 'Inventory',  path: '/admin/inventory',  icon: 'archive', badge: 'inventory' },
    { label: 'Banners',    path: '/admin/banners',    icon: 'image' },
    { label: 'Coupons',    path: '/admin/coupons',    icon: 'ticket' },
    { label: 'Pages',      path: '/admin/pages',      icon: 'page' },
    { label: 'Reports',    path: '/admin/reports',    icon: 'chart' },
    { label: 'Settings',   path: '/admin/settings',   icon: 'sliders' }
  ];

  /* Shown in the sidebar's profile block. Invented placeholder identity —
     there is no account behind it and nothing here is a credential. When an
     authentication service is connected in admin-auth.js, this comes from
     the signed-in user's profile instead. No service has been chosen yet,
     and this file does not need to know which one it turns out to be. */
  ZB.adminUser = {
    name: 'Store Owner',
    email: 'owner@haveli.example',
    role: 'Owner',
    initials: 'SO'
  };

}(window.ZB));
