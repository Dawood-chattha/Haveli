/* =========================================================================
   footer.js — footer link groups and contact details
   -------------------------------------------------------------------------
   UI-only data. Every path here is a route the router actually serves, so
   the footer contains no dead links. The contact details are invented.
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

    contact: {
      email: 'customer.care@haveli.example',
      phone: '+92-21-38402072'
    },

    groups: [
      {
        title: 'Help',
        links: [
          { label: 'FAQs', path: '/faqs' },
          { label: 'How To Buy', path: '/how-to-buy' },
          { label: 'Payment', path: '/payment' },
          { label: 'Shipping & Deliveries', path: '/shipping' },
          { label: 'Exchange & Returns', path: '/returns' },
          { label: 'Order Tracking', path: '/tracking' }
        ]
      },
      {
        title: 'Company',
        links: [
          { label: 'About Us', path: '/about' },
          { label: 'Contact Us', path: '/contact' },
          { label: 'Work With Us', path: '/careers' },
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
