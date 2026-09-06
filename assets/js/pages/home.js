/* =========================================================================
   pages/home.js — the homepage
   -------------------------------------------------------------------------
   Renders the shells for the hero carousel and the ranked collection rail,
   then hands each to its own controller. Both controllers fill their own
   markup from the data files, so this page only owns the arrangement.
   ========================================================================= */

window.ZB = window.ZB || {};
window.ZB.pages = window.ZB.pages || {};

(function (ZB) {
  'use strict';

  ZB.pages.home = {

    title: null,   /* the default document title is right for the homepage */

    render: function () {
      return '' +
        /* HERO — scroll-snap carousel */
        '<section class="hero" id="hero" aria-roledescription="carousel" aria-label="Featured collections">' +
          '<div class="hero__track"></div>' +
          '<div class="hero__progress" aria-hidden="true">' +
            '<span class="hero__progress-fill"></span>' +
          '</div>' +
        '</section>' +

        /* RANKED COLLECTIONS */
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
        '</section>' +

        /* DEPARTMENT RAILS — Women, Men, Scents; filled by ZB.railSections */
        '<div id="rails"></div>' +

        this.feature() +
        this.proof();
    },

    /** Full-bleed image-and-text band below the rails. */
    feature: function () {
      var ui = ZB.ui;
      var f = ZB.editorial.feature;

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

    proof: function () {
      var ui = ZB.ui;
      var p = ZB.editorial.proof;

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
