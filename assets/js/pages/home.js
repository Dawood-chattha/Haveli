/* =========================================================================
   pages/home.js — the homepage
   -------------------------------------------------------------------------
   Renders the shells for the hero carousel and the ranked collection rail,
   then hands each to its own controller. Both controllers fill their own
   markup, so this page only owns the arrangement.

   A SECTION WITH NOTHING IN IT IS NOT DRAWN
   The hero, the collection rail and the editorial band are the owner's now —
   they come from the banners table through /api/banners, not from a file of
   invented copy. A shop that has not chosen a hero picture yet therefore has
   no hero, and the page closes up around the gap rather than showing an empty
   carousel with arrows that scroll nothing.

   This is the same rule the rest of the shop follows. An unset field renders
   as nothing, never as a plausible guess, because a customer cannot tell a
   guess from a fact.
   ========================================================================= */

window.ZB = window.ZB || {};
window.ZB.pages = window.ZB.pages || {};

(function (ZB) {
  'use strict';

  ZB.pages.home = {

    title: null,   /* the default document title is right for the homepage */

    render: function () {
      var slides = ZB.heroSlides || [];
      var tiles = ZB.collections || [];

      return '' +
        /* HERO — scroll-snap carousel */
        (!slides.length ? '' :
        '<section class="hero" id="hero" aria-roledescription="carousel" aria-label="Featured collections">' +
          '<div class="hero__track"></div>' +
          '<div class="hero__progress" aria-hidden="true">' +
            '<span class="hero__progress-fill"></span>' +
          '</div>' +
        '</section>') +

        /* RANKED COLLECTIONS */
        (!tiles.length ? '' :
        '<section class="collections" id="collections" aria-labelledby="collections-title">' +
          '<div class="collections__head">' +
            '<h2 class="collections__title" id="collections-title">The Top 10 Right Now</h2>' +
          '</div>' +
          '<div class="collections__viewport">' +
            '<button class="collections__nav collections__nav--prev" type="button" aria-label="Previous collections">' +
              '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>' +
            '</button>' +
            '<div class="collections__track"></div>' +
            '<button class="collections__nav collections__nav--next" type="button" aria-label="Next collections">' +
              '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>' +
            '</button>' +
          '</div>' +
        '</section>') +

        /* DEPARTMENT RAILS — Women, Men, Scents; filled by ZB.railSections */
        '<div id="rails"></div>' +

        this.feature() +
        this.proof();
    },

    /** Full-bleed image-and-text band below the rails, or nothing. */
    feature: function () {
      var ui = ZB.ui;
      var f = ZB.editorial && ZB.editorial.feature;

      /* No band chosen in the panel, so no band. */
      if (!f || !f.image) return '';

      return '' +
        '<section class="feature" aria-labelledby="feature-title">' +
          '<div class="feature__media">' +
            '<img src="' + f.image + '" alt="" width="900" height="1100" loading="lazy">' +
          '</div>' +
          '<div class="feature__body">' +
            '<p class="feature__eyebrow reveal">' + ui.esc(f.eyebrow) + '</p>' +
            '<h2 class="feature__title reveal" id="feature-title" style="--d:.06s">' +
              ui.esc(f.title) +
            '</h2>' +
            '<p class="feature__text reveal" style="--d:.12s">' + ui.esc(f.body) + '</p>' +
            '<a class="btn btn--primary feature__cta reveal" style="--d:.18s" href="' +
              ui.href(f.ctaPath) + '">' + ui.esc(f.ctaLabel) + '</a>' +
          '</div>' +
        '</section>';
    },

    /**
     * The row of figures under the feature band.
     *
     * THESE ARE CLAIMS ABOUT A REAL BUSINESS AND MUST NOT BE INVENTED
     * It used to read from data/editorial.js, which said "120+ Stores across
     * Pakistan" and "4.6 Average customer rating". Both were written to fill
     * the layout, and a customer reading them has no way to know that. A shop
     * that advertises a rating it has never been given is making it up, in
     * public, on its own front page.
     *
     * So there is no source for these yet and the section does not render.
     * It comes back when the owner has somewhere to type their own figures —
     * the same course the footer's contact details took.
     */
    proof: function () {
      var ui = ZB.ui;
      var p = ZB.editorial && ZB.editorial.proof;

      if (!p || !p.stats || !p.stats.length) return '';

      var items = p.stats.map(function (stat, i) {
        return '<div class="proof__item reveal" style="--d:' + (i * .06) + 's">' +
                 '<span class="proof__value">' + ui.esc(stat.value) + '</span>' +
                 '<span class="proof__label">' + ui.esc(stat.label) + '</span>' +
               '</div>';
      }).join('');

      return '' +
        '<section class="proof" aria-labelledby="proof-title">' +
          '<div class="container">' +
            '<h2 class="proof__title" id="proof-title">' + ui.esc(p.title) + '</h2>' +
            '<div class="proof__grid">' + items + '</div>' +
          '</div>' +
        '</section>';
    },

    mount: function () {
      if (ZB.hero) ZB.hero.init();
      if (ZB.collectionsRail) ZB.collectionsRail.init();
      if (ZB.railSections) ZB.railSections.init(document.getElementById('rails'));
    }
  };

}(window.ZB));
