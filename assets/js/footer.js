/* =========================================================================
   footer.js — renders the site footer
   -------------------------------------------------------------------------
   The footer sits outside #app, so it survives route changes and is built
   once at boot. The newsletter form validates and then says plainly that
   nothing was sent, because there is no service behind it.
   ========================================================================= */

window.ZB = window.ZB || {};

(function (ZB) {
  'use strict';

  var Footer = {

    render: function () {
      var ui = ZB.ui;
      var data = ZB.footer;

      var groups = data.groups.map(function (group) {
        var links = group.links.map(function (link) {
          return '<li><a href="' + ui.href(link.path) + '">' + ui.esc(link.label) + '</a></li>';
        }).join('');

        return '' +
          '<nav class="footer__group" aria-label="' + ui.esc(group.title) + '">' +
            '<h2 class="footer__group-title">' + ui.esc(group.title) + '</h2>' +
            '<ul class="footer__links">' + links + '</ul>' +
          '</nav>';
      }).join('');

      var legal = data.legal.map(function (link) {
        return '<a href="' + ui.href(link.path) + '">' + ui.esc(link.label) + '</a>';
      }).join('');

      var social = data.social.map(function (name) {
        return '<span class="footer__social-item">' + ui.esc(name) + '</span>';
      }).join('');

      /* WHAT THE SHOP CALLS ITSELF, AND HOW TO REACH IT
         From the settings record, which the owner fills in from the panel.
         These two lines used to be an invented mailbox and an invented phone
         number sitting in data/footer.js, and a customer reading a footer
         cannot tell one of those from a real one.

         So a detail that has not been set is not shown. An empty contact
         list is a footer that is merely quiet; a made-up one is a footer
         that is wrong. The name falls back to the shop's own, which is not
         invented. */
      var shop = ZB.shop || {};
      var wordmark = shop.name || 'HAVELI';

      var contact = [shop.email, shop.phone]
        .filter(function (line) { return line; })
        .map(function (line) { return '<li>' + ui.esc(line) + '</li>'; })
        .join('');

      return '' +
        '<div class="footer__inner">' +

          '<div class="footer__top">' +
            '<div class="footer__brand">' +
              '<a class="footer__wordmark" href="' + ui.href('/') + '">' +
                ui.esc(wordmark) +
              '</a>' +
              '<h2 class="footer__blurb-title">' + ui.esc(data.blurb.title) + '</h2>' +
              '<p class="footer__blurb">' +
                ui.esc(shop.tagline || data.blurb.body) +
              '</p>' +
              (contact ? '<ul class="footer__contact">' + contact + '</ul>' : '') +
            '</div>' +

            '<div class="footer__groups">' + groups + '</div>' +
          '</div>' +

          '<div class="footer__news">' +
            '<div class="footer__news-copy">' +
              '<h2 class="footer__news-title">Get the latest first</h2>' +
              '<p class="footer__news-sub">New arrivals and price drops, before they sell through.</p>' +
            '</div>' +
            '<form class="footer__news-form" id="newsletter-form" novalidate>' +
              '<label class="visually-hidden" for="newsletter-email">Email address</label>' +
              '<input class="field footer__news-input" id="newsletter-email" type="email"' +
                    ' placeholder="Email address" autocomplete="email" required>' +
              '<button class="btn btn--primary" type="submit">Sign up</button>' +
            '</form>' +
            '<p class="footer__news-note" id="newsletter-note" role="status"></p>' +
          '</div>' +

          '<div class="footer__bottom">' +
            /* The year is this year's, not one written into the source. A
               hard-coded year is correct until midnight on 31 December and
               then quietly wrong for twelve months. */
            '<p class="footer__copyright">© ' + new Date().getFullYear() + ' ' +
              ui.esc(wordmark) + '</p>' +
            '<div class="footer__legal">' + legal + '</div>' +
            '<div class="footer__social" aria-label="Social channels">' + social + '</div>' +

            /* THERE IS NO LINK TO THE ADMIN PANEL HERE, AND THAT IS DELIBERATE
               There was an "Owner Login" link in this row. It was removed
               because the shop's own pages should not advertise where the
               management panel is: the address is reached by typing it, and
               only the people who run the shop need to know it.

               WHAT THAT IS AND IS NOT
               It is one fewer place the address is published. It is NOT
               protection, and nothing here should ever be mistaken for it —
               an unlisted address is still an address, and anyone who finds
               it reaches the same panel. What actually protects the panel is
               a server that checks who is asking on every read and write.
               See the note at the top of assets/js/admin/admin-auth.js.

               Nothing else on the customer side references /admin. If a link
               to it is ever wanted again, it belongs behind a signed-in
               account, not in the footer of every page. */
          '</div>' +

        '</div>';
    },

    /** Validate, then be honest that the address goes nowhere. */
    bindNewsletter: function (root) {
      var form = root.querySelector('#newsletter-form');
      var note = root.querySelector('#newsletter-note');
      if (!form || !note) return;

      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var input = form.querySelector('input');

        if (!input.checkValidity()) {
          note.textContent = 'Please enter a valid email address.';
          note.className = 'footer__news-note is-error';
          input.focus();
          return;
        }

        note.textContent = 'This form is interface only — nothing was sent and no ' +
                           'address was stored.';
        note.className = 'footer__news-note is-done';
        form.reset();
      });
    },

    init: function (root) {
      root = root || document.getElementById('site-footer');
      if (!root || !ZB.footer) return;

      root.innerHTML = this.render();
      this.bindNewsletter(root);
    }
  };

  ZB.siteFooter = Footer;

}(window.ZB));
