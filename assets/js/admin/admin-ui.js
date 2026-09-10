/* =========================================================================
   admin-ui.js — icon set and shared markup helpers for the admin panel
   -------------------------------------------------------------------------
   The admin equivalent of assets/js/ui.js, and it leans on that file rather
   than repeating it: escaping, route-aware hrefs and currency formatting are
   the same job on both sides of the site, so they are delegated, not copied.
   Only the pieces that are genuinely admin-shaped live here.

   Every helper returns an HTML string, matching how the storefront's page
   modules are written.

   ESCAPING IS NOT OPTIONAL
   This codebase renders through innerHTML, so any value that did not come
   from a literal in the source must go through esc() before it reaches
   markup. That includes search terms, form values, ids taken from the URL,
   and anything a future database returns. There are no exceptions to this
   in the admin panel.
   ========================================================================= */

window.ZB = window.ZB || {};

(function (ZB) {
  'use strict';

  /* -----------------------------------------------------------------------
     ICONS

     Stroked outlines on a 24x24 box, matching the storefront header's icon
     style (stroke: currentColor, fill: none, 1.5 weight) so both halves of
     the site look drawn by the same hand. Weight, size and colour are set
     in CSS; these are shapes only.
     ----------------------------------------------------------------------- */

  var ICONS = {
    grid:    '<rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/>' +
             '<rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/>' +
             '<rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/>' +
             '<rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/>',

    box:     '<path d="M20.5 7.5v9l-8.5 4.5-8.5-4.5v-9L12 3l8.5 4.5Z"/>' +
             '<path d="M3.5 7.5 12 12l8.5-4.5"/><path d="M12 12v9"/>',

    layers:  '<path d="m12 3 8.5 4.5L12 12 3.5 7.5 12 3Z"/>' +
             '<path d="m3.5 12 8.5 4.5 8.5-4.5"/>' +
             '<path d="m3.5 16.5 8.5 4.5 8.5-4.5"/>',

    receipt: '<path d="M6 3h12v18l-2.5-1.6L13 21l-2.5-1.6L8 21l-2-1.6V3Z"/>' +
             '<path d="M9 8h6"/><path d="M9 12h6"/>',

    users:   '<path d="M15.5 20.5v-1.2a3.8 3.8 0 0 0-3.8-3.8H7.3a3.8 3.8 0 0 0-3.8 3.8v1.2"/>' +
             '<circle cx="9.5" cy="7.5" r="3.5"/>' +
             '<path d="M20.5 20.5v-1.2a3.8 3.8 0 0 0-2.9-3.7"/>' +
             '<path d="M15.5 4a3.5 3.5 0 0 1 0 7"/>',

    archive: '<rect x="3" y="4" width="18" height="4.5" rx="1"/>' +
             '<path d="M5 8.5v10a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5v-10"/>' +
             '<path d="M10 12.5h4"/>',

    image:   '<rect x="3" y="5" width="18" height="14" rx="1.5"/>' +
             '<circle cx="8.5" cy="10" r="1.6"/>' +
             '<path d="m21 15.5-4.5-4.5L9 18.5"/>',

    ticket:  '<path d="M3 9.2V6.5A1.5 1.5 0 0 1 4.5 5h15A1.5 1.5 0 0 1 21 6.5v2.7a2.8 2.8 0 0 0 0 5.6v2.7a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5v-2.7a2.8 2.8 0 0 0 0-5.6Z"/>' +
             '<path d="M14 5v14" stroke-dasharray="2 3"/>',

    chart:   '<path d="M3.5 20.5h17"/><path d="M7 20.5v-6"/>' +
             '<path d="M12 20.5V6"/><path d="M17 20.5v-9"/>',

    /* A sheet with writing on it, for the Pages screen. Drawn in the same
       1.5-weight outline as the rest so it belongs beside them. */
    page:    '<path d="M6 3h8l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/>' +
             '<path d="M14 3v4h4"/>' +
             '<path d="M8.5 12.5h7"/><path d="M8.5 16h7"/><path d="M8.5 9h3"/>',

    sliders: '<path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/>' +
             '<circle cx="9" cy="7" r="2.2"/><circle cx="15" cy="12" r="2.2"/>' +
             '<circle cx="8" cy="17" r="2.2"/>',

    store:   '<path d="M15 3.5h5.5V9"/><path d="M20.5 3.5 12 12"/>' +
             '<path d="M18 13.5v5A2.5 2.5 0 0 1 15.5 21h-9A2.5 2.5 0 0 1 4 18.5v-9A2.5 2.5 0 0 1 6.5 7h5"/>',

    logout:  '<path d="M9.5 20.5h-3A2.5 2.5 0 0 1 4 18v-12a2.5 2.5 0 0 1 2.5-2.5h3"/>' +
             '<path d="m16 16.5 4.5-4.5L16 7.5"/><path d="M20.5 12H9.5"/>',

    bell:    '<path d="M18.5 9a6.5 6.5 0 1 0-13 0c0 6.5-2.5 8.5-2.5 8.5h18S18.5 15.5 18.5 9"/>' +
             '<path d="M13.9 21a2.2 2.2 0 0 1-3.8 0"/>',

    search:  '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/>',

    menu:    '<path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/>',

    close:   '<path d="M6 6l12 12"/><path d="M18 6L6 18"/>',

    chevron: '<path d="m9 6 6 6-6 6"/>',

    collapse: '<path d="M20.5 4.5v15"/><path d="M3.5 12h12"/><path d="m9 6.5-5.5 5.5L9 17.5"/>',

    clock:   '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 1.8"/>',

    truck:   '<path d="M3 6.5h10v10H3z"/><path d="M13 9.5h4l3 3v4h-7z"/>' +
             '<circle cx="7" cy="18" r="1.8"/><circle cx="17" cy="18" r="1.8"/>',

    pin:     '<path d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11Z"/>' +
             '<circle cx="12" cy="10" r="2.6"/>',

    card:    '<rect x="3" y="5.5" width="18" height="13" rx="2"/>' +
             '<path d="M3 10h18"/><path d="M7 14.5h3"/>',

    check:   '<path d="m5 12.5 4.5 4.5L19 7"/>',

    back:    '<path d="M20 12H4"/><path d="m10 6-6 6 6 6"/>',

    up:      '<path d="M12 20V5"/><path d="m5.5 11.5 6.5-6.5 6.5 6.5"/>',

    down:    '<path d="M12 4v15"/><path d="m5.5 12.5 6.5 6.5 6.5-6.5"/>',

    link:    '<path d="M10.5 13.5a4 4 0 0 0 5.7 0l3-3a4 4 0 1 0-5.7-5.7l-1.2 1.2"/>' +
             '<path d="M13.5 10.5a4 4 0 0 0-5.7 0l-3 3a4 4 0 1 0 5.7 5.7l1.2-1.2"/>',

    warn:    '<path d="M12 3.5 21 19.5H3L12 3.5Z"/>' +
             '<path d="M12 10v4"/><path d="M12 16.6v.1"/>',

    plus:    '<path d="M12 5v14"/><path d="M5 12h14"/>'
  };

  var AdminUI = {

    /* Delegated — the storefront helpers already do exactly this job. */
    esc: function (value) { return ZB.ui.esc(value); },
    href: function (path) { return ZB.ui.href(path); },
    money: function (n) { return ZB.ui.money(n); },

    /* -------------------------------------------------------------------
       DATES

       Written out rather than numeric. "07/09/26" is a different day
       either side of the Atlantic and this shop ships to neither; "7 Sep
       2026" cannot be read two ways. The `ago` line beside it is what
       actually gets read on a busy screen — "2 days ago" answers "is this
       urgent" without the reader doing arithmetic — so both are shown,
       the exact date as the value and the relative one as its meta line.
       ------------------------------------------------------------------- */

    date: function (value) {
      var d = value instanceof Date ? value : new Date(value);
      if (isNaN(d.getTime())) return '';

      var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();
    },

    /** "Today", "Yesterday", "5 days ago", "3 weeks ago". */
    ago: function (days) {
      var n = Math.max(0, Math.round(days));
      if (n === 0) return 'Today';
      if (n === 1) return 'Yesterday';
      if (n < 14) return n + ' days ago';
      if (n < 60) return Math.round(n / 7) + ' weeks ago';
      return Math.round(n / 30) + ' months ago';
    },

    /**
     * An inline icon. An unknown name returns nothing rather than throwing,
     * so a typo in the menu data costs a missing glyph, not a dead sidebar.
     */
    icon: function (name) {
      var shape = ICONS[name];
      if (!shape) return '';
      return '<svg class="a-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
               shape +
             '</svg>';
    },

    /**
     * The heading block at the top of a page.
     * o: { title, sub, actions } — `actions` is pre-built HTML.
     */
    pageHead: function (o) {
      return '' +
        '<header class="a-page-head">' +
          '<div class="a-page-head__text">' +
            '<h1 class="a-page-head__title">' + AdminUI.esc(o.title) + '</h1>' +
            (o.sub ? '<p class="a-page-head__sub">' + AdminUI.esc(o.sub) + '</p>' : '') +
          '</div>' +
          (o.actions ? '<div class="a-page-head__actions">' + o.actions + '</div>' : '') +
        '</header>';
    },

    /** A white surface with an optional title bar. `body` is HTML. */
    card: function (o) {
      return '' +
        '<section class="a-card' + (o.modifier ? ' ' + o.modifier : '') + '">' +
          (o.title
            ? '<header class="a-card__head">' +
                '<h2 class="a-card__title">' + AdminUI.esc(o.title) + '</h2>' +
                (o.aside ? '<div class="a-card__aside">' + o.aside + '</div>' : '') +
              '</header>'
            : '') +
          '<div class="a-card__body">' + (o.body || '') + '</div>' +
        '</section>';
    },

    /**
     * A coloured status chip. `kind` is checked against a known set, so an
     * unexpected value from data cannot smuggle a class name into markup.
     */
    statusPill: function (kind, label) {
      var known = ['active', 'draft', 'hidden', 'out-of-stock', 'low', 'pending',
                   'processing', 'shipped', 'delivered', 'cancelled', 'neutral',
                   /* Coupon states. Derived from dates and usage, never set
                      by hand — see the note in admin-repo.js. */
                   'running', 'scheduled', 'used-up', 'expired', 'off'];
      var safe = known.indexOf(kind) > -1 ? kind : 'neutral';
      return '<span class="a-pill a-pill--' + safe + '">' + AdminUI.esc(label) + '</span>';
    }

    /* There was a `placeholder` helper here, for the pages that stood in
       for sections still to be built. Every section has its own module now,
       so it drew nothing and has been removed rather than left as a
       function the next person has to check the callers of. The shape it
       produced survives in pages/not-found.js, which is the one page that
       still needs it. */
  };

  ZB.adminUI = AdminUI;

}(window.ZB));
