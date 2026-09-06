/* =========================================================================
   collections.js — ranked collection rail
   -------------------------------------------------------------------------
   Renders ZB.collections into the rail and drives the two arrow buttons.
   Unlike the hero, this rail does have arrows on desktop, so they page the
   track by roughly one viewport at a time and disable themselves at the ends.
   ========================================================================= */

window.ZB = window.ZB || {};

(function (ZB) {
  'use strict';

  var Collections = {
    root: null,
    track: null,
    prev: null,
    next: null,
    bound: false,     /* window listeners are attached only once */

    init: function () {
      this.root = document.getElementById('collections');
      if (!this.root || !ZB.collections) return;

      this.track = this.root.querySelector('.collections__track');
      this.prev = this.root.querySelector('.collections__nav--prev');
      this.next = this.root.querySelector('.collections__nav--next');
      if (!this.track) return;

      this.render();

      var self = this;

      if (this.prev) this.prev.addEventListener('click', function () { self.page(-1); });
      if (this.next) this.next.addEventListener('click', function () { self.page(1); });

      this.track.addEventListener('scroll', ZB.util.rafThrottle(function () {
        self.updateArrows();
      }), { passive: true });

      if (!this.bound) {
        this.bound = true;
        window.addEventListener('resize', ZB.util.debounce(function () {
          if (self.root && document.body.contains(self.root)) self.updateArrows();
        }, 150));
      }

      this.updateArrows();
    },

    render: function () {
      this.track.innerHTML = ZB.collections.map(function (c, i) {
        var badge = c.badge
          ? '<span class="collection-card__badge">' + c.badge + '</span>'
          : '';

        return '' +
          '<a class="collection-card" href="' + c.href + '">' +
            '<span class="collection-card__rank" aria-hidden="true">' + (i + 1) + '</span>' +
            '<span class="collection-card__media">' +
              '<img src="' + c.image + '" alt="" loading="lazy" decoding="async">' +
              '<span class="collection-card__overlay"></span>' +
              '<span class="collection-card__stack">' +
                badge +
                '<span class="collection-card__label">' + c.label + '</span>' +
              '</span>' +
            '</span>' +
          '</a>';
      }).join('');
    },

    /** Scroll by one card-width step, a near-viewport at a time. */
    page: function (dir) {
      var card = this.track.querySelector('.collection-card');
      if (!card) return;

      // Card width plus the 35px gap, rounded down to whole cards.
      var step = card.getBoundingClientRect().width + 35;
      var perView = Math.max(1, Math.floor(this.track.clientWidth / step));

      this.track.scrollBy({ left: dir * step * perView, behavior: 'smooth' });
    },

    /** Hide an arrow once the rail cannot travel further that way. */
    updateArrows: function () {
      if (!this.prev || !this.next) return;

      var max = this.track.scrollWidth - this.track.clientWidth;
      var x = this.track.scrollLeft;

      this.prev.disabled = x <= 2;
      this.next.disabled = x >= max - 2;
    }
  };

  /* Mounted by the home page after the router renders its markup. */
  ZB.collectionsRail = Collections;

}(window.ZB));
