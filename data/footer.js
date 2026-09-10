/* =========================================================================
   footer.js — footer link groups and contact details
   -------------------------------------------------------------------------
   UI-only data. Every path here is a route the router actually serves, so
   the footer contains no dead links.

   THE CONTACT DETAILS ARE NOT HERE ANY MORE
   There used to be an email address and a phone number in this file, both
   invented — a mailbox at haveli.example that routes nowhere. A customer
   reading a footer cannot tell an invented address from a real one, and the
   ones who could not tell would write to it.

   They live in the settings record now, filled in by the owner from the
   panel and served to the storefront by GET /api/shop. What is left in this
   file is structure — which links the footer has and where they go — which
   is the shop's genuine shape rather than placeholder text.
   ========================================================================= */

window.ZB = window.ZB || {};

(function (ZB) {
  'use strict';

  ZB.footer = {

    blurb: {
      title: 'Real fashion, real prices.',
      body: 'Everyday clothing for women, men and kids — made to be worn often ' +
            'and priced to be bought without thinking twice.'
    },

    groups: [
      {
        title: 'Help',
        links: [
          { label: 'FAQs', path: '/faqs' },
          { label: 'How To Buy', path: '/how-to-buy' },
          { label: 'Shipping & Deliveries', path: '/shipping' },
          { label: 'Exchange & Returns', path: '/returns' }
        ]
      },
      {
        title: 'Company',
        links: [
          { label: 'About Us', path: '/about' },
          { label: 'Contact Us', path: '/contact' },
          { label: 'Retail Stores', path: '/stores' }
        ]
      },
      {
        title: 'Shop',
        links: [
          { label: 'Women', path: '/category/women' },
          { label: 'Men', path: '/category/men' },
          { label: 'Kids', path: '/category/kids' },
          { label: 'Wishlist', path: '/wishlist' },
          { label: 'Cart', path: '/cart' }
        ]
      }
    ],

    legal: [
      { label: 'Terms and Conditions', path: '/terms' },
      { label: 'Privacy Policy', path: '/privacy' },
      { label: 'FAQs', path: '/faqs' }
    ],

    social: ['Instagram', 'Facebook', 'YouTube', 'TikTok']
  };

}(window.ZB));
