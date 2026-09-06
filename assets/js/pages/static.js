/* =========================================================================
   pages/static.js — simple content routes and the 404
   -------------------------------------------------------------------------
   Stores, Tracking and Careers are linked from the drawer's utility tiles,
   so they need real destinations rather than dead links.
   ========================================================================= */

window.ZB = window.ZB || {};
window.ZB.pages = window.ZB.pages || {};

(function (ZB) {
  'use strict';

  /** Build a plain content page from a title and a lead paragraph. */
  function simplePage(title, eyebrow, lead) {
    return {
      title: title,
      render: function () {
        var ui = ZB.ui;
        return '' +
          '<div class="route-page container">' +
            ui.breadcrumbs([{ label: 'Home', path: '/' }, { label: title }]) +
            ui.pageHead({ eyebrow: eyebrow, title: title, sub: lead }) +
            ui.pending('This page is a route placeholder in the current build.') +
          '</div>';
      }
    };
  }

  ZB.pages.stores = simplePage(
    'Stores', 'Visit us',
    'Find an outlet near you and check its opening hours.'
  );

  ZB.pages.tracking = simplePage(
    'Order tracking', 'Your order',
    'Enter an order number to see where your parcel has reached.'
  );

  ZB.pages.careers = simplePage(
    'Careers', 'Work with us',
    'Open roles across retail, design and operations.'
  );

  /* Everything the footer links to needs somewhere real to land, or the
     footer would be a row of dead links. */
  ZB.pages.faqs = simplePage(
    'FAQs', 'Help',
    'Answers to the questions we are asked most often.'
  );

  ZB.pages.howToBuy = simplePage(
    'How To Buy', 'Help',
    'Choosing a size, adding to the cart, and placing an order.'
  );

  ZB.pages.payment = simplePage(
    'Payment', 'Help',
    'The ways you can pay, and when each is charged.'
  );

  ZB.pages.shipping = simplePage(
    'Shipping & Deliveries', 'Help',
    'Delivery times and charges across the country.'
  );

  ZB.pages.returns = simplePage(
    'Exchange & Returns', 'Help',
    'How long you have, and what condition items need to be in.'
  );

  ZB.pages.about = simplePage(
    'About Us', 'Our story',
    'Who we are and how we keep prices where they are.'
  );

  ZB.pages.contact = simplePage(
    'Contact Us', 'Get in touch',
    'Reach the customer care team by email or phone.'
  );

  ZB.pages.terms = simplePage(
    'Terms and Conditions', 'Legal',
    'The terms that apply when you shop with us.'
  );

  ZB.pages.privacy = simplePage(
    'Privacy Policy', 'Legal',
    'What we collect, why, and what we do with it.'
  );

  ZB.pages.notFound = {
    title: 'Page not found',

    render: function () {
      var ui = ZB.ui;
      return '' +
        '<div class="route-page container">' +
          ui.breadcrumbs([{ label: 'Home', path: '/' }, { label: 'Not found' }]) +
          ui.emptyState({
            title: 'We could not find that page',
            body: 'The address may be mistyped, or the page may have moved.',
            ctaLabel: 'Back to home',
            ctaHref: '/'
          }) +
        '</div>';
    }
  };

}(window.ZB));
