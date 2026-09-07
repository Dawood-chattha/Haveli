/* =========================================================================
   pages/not-found.js — the admin panel's last resort
   -------------------------------------------------------------------------
   This file was placeholders.js until Settings landed. While the panel was
   being built a section at a time, it held a real page for every route that
   had not been written yet — because a menu item that renders nothing looks
   exactly like one that is broken, and there would have been no way to tell
   whether navigation actually worked.

   Every section now has its own module, so the last thing left is the page
   for an address that matches none of them. That is not a placeholder: a
   route table always needs somewhere for the addresses it does not know,
   and this is it.

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
