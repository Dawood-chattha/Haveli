/* =========================================================================
   pages/static.js — the shop's written pages, and the 404
   -------------------------------------------------------------------------
   Nine routes: the footer's Help and Company columns, plus Stores in the
   menu drawer. Every one of them used to render the same sentence saying
   it was a placeholder.

   THE WORDS COME FROM THE DATABASE NOW
   ZB.content, filled by assets/js/bootstrap.js from GET /api/pages, and
   written by the shop's owner in the admin panel. What stays in this file
   is the shape of a page — a breadcrumb, a heading, a column of text — and
   the routes themselves, which are the site's structure rather than its
   contents.

   NOTHING HERE IS RENDERED AS MARKUP
   The body is text typed into a form, and assets/js/rich-text.js turns it
   into HTML by escaping every character first and only then applying three
   rules. That file carries the reasoning; this one calls it. The panel's
   preview calls the same function, so what the owner is shown while writing
   is what a visitor gets.
   ========================================================================= */

window.ZB = window.ZB || {};
window.ZB.pages = window.ZB.pages || {};

(function (ZB) {
  'use strict';

  /* -----------------------------------------------------------------------
     The page
     ----------------------------------------------------------------------- */

  /**
   * A written page, by slug.
   *
   * `fallbackTitle` is used only until the pages have loaded, or if this
   * one has no row — the heading has to say something, and the route
   * already knows which page it is. Everything else comes from the
   * database or is left out.
   */
  function writtenPage(slug, fallbackTitle) {
    return {
      title: function () {
        var row = ZB.content && ZB.content[slug];
        return (row && row.title) || fallbackTitle;
      },

      render: function () {
        var ui = ZB.ui;
        var row = (ZB.content && ZB.content[slug]) || null;
        var title = (row && row.title) || fallbackTitle;

        var copy = row && row.written
          ? '<div class="page-copy">' + ZB.richText(row.body) + '</div>'

          /* Not written yet, or still a draft. Said plainly rather than
             filled with something plausible: an invented returns policy is
             one a customer would read and act on. */
          : '<div class="page-copy">' +
              '<p class="page-copy__para page-copy__para--quiet">' +
                'This page has not been written yet. ' +
                'Please get in touch if you need this information.' +
              '</p>' +
            '</div>';

        return '' +
          '<div class="route-page container">' +
            ui.breadcrumbs([{ label: 'Home', path: '/' }, { label: title }]) +
            ui.pageHead({
              eyebrow: (row && row.eyebrow) || '',
              title: title,
              sub: (row && row.lead) || ''
            }) +
            copy +
            contactBlock(slug) +
          '</div>';
      }
    };
  }

  /**
   * The shop's own contact details, on the page that is about reaching it.
   *
   * Only there, and only what has been filled in. The same rule the footer
   * follows: a detail the owner has not given is not shown, because the
   * alternative is publishing an address nobody chose.
   */
  function contactBlock(slug) {
    if (slug !== 'contact') return '';

    var ui = ZB.ui;
    var shop = ZB.shop || {};

    var lines = [];

    if (shop.email) {
      lines.push('<li><span class="page-contact__label">Email</span>' +
                 '<a href="mailto:' + ui.esc(shop.email) + '">' +
                   ui.esc(shop.email) +
                 '</a></li>');
    }

    if (shop.phone) {
      lines.push('<li><span class="page-contact__label">Phone</span>' +
                 '<span>' + ui.esc(shop.phone) + '</span></li>');
    }

    var where = [shop.address, shop.city].filter(function (p) { return p; }).join(', ');

    if (where) {
      lines.push('<li><span class="page-contact__label">Address</span>' +
                 '<span>' + ui.esc(where) + '</span></li>');
    }

    if (!lines.length) return '';

    return '' +
      '<ul class="page-contact">' + lines.join('') + '</ul>';
  }

  /* -----------------------------------------------------------------------
     The nine

     Slug first, because that is what the row is keyed by and what the route
     is. The title beside it is the fallback for the moment before the pages
     have arrived — it is not the page's name, which the owner can change.

     THREE WERE REMOVED, AND REMOVED EVERYWHERE
     Payment, Order tracking and Work With Us are gone at the owner's
     request. A page taken off the footer but left routed is a page nobody
     can reach and somebody still has to write, so the route, the link, the
     drawer tile and the row went together.

     Payment has nothing to explain while the shop takes cash on delivery
     and nothing else; tracking is what the Orders list on the account page
     already does; and a shop this size does not need a careers page.
     ----------------------------------------------------------------------- */

  ZB.pages.stores = writtenPage('stores', 'Stores');

  ZB.pages.faqs = writtenPage('faqs', 'FAQs');
  ZB.pages.howToBuy = writtenPage('how-to-buy', 'How To Buy');
  ZB.pages.shipping = writtenPage('shipping', 'Shipping & Deliveries');
  ZB.pages.returns = writtenPage('returns', 'Exchange & Returns');

  ZB.pages.about = writtenPage('about', 'About Us');
  ZB.pages.contact = writtenPage('contact', 'Contact Us');

  ZB.pages.terms = writtenPage('terms', 'Terms and Conditions');
  ZB.pages.privacy = writtenPage('privacy', 'Privacy Policy');

  /* -----------------------------------------------------------------------
     Not found
     ----------------------------------------------------------------------- */

  ZB.pages.notFound = {
    title: 'Page not found',

    render: function () {
      var ui = ZB.ui;
      return '' +
        '<div class="route-page container">' +
          ui.breadcrumbs([{ label: 'Home', path: '/' }, { label: 'Not found' }]) +
          ui.emptyState({
            title: 'That page could not be found',
            body: 'The address may be mistyped, or the page may have moved.',
            ctaLabel: 'Back to the shop',
            ctaHref: '/'
          }) +
        '</div>';
    }
  };

}(window.ZB));
