/* =========================================================================
   hero.js — hero carousel
   -------------------------------------------------------------------------
   Renders ZB.heroSlides into a native scroll-snap track and keeps three
   things in sync with the scroll position: the active slide, its entrance
   animation, and the progress bar.

   The reference storefront has no arrows, no dots and no autoplay: it was
   sampled for eleven seconds and never moved, and its track is the same
   flex + overflow-x:auto + scroll-snap-type:x mandatory as this one. So it
   is operated purely by swiping.

   That is fine on a phone and close to unusable with a mouse — there is
   nothing to click and nothing to suggest there are seven slides at all.
   This build therefore departs from the reference on purpose in two ways:
   it advances on its own, and it carries prev/next arrows on wider screens.
   The progress bar is still the measured one.

   Autoplay yields whenever it should: while the pointer is over the hero,
   while focus is inside it, while the tab is hidden, and entirely when the
   viewer prefers reduced motion.
   ========================================================================= */

window.ZB = window.ZB || {};

(function (ZB) {
  'use strict';

  var Hero = {
    root: null,
    track: null,
    fill: null,
    slides: [],
    index: -1,
    bound: false,     /* window listeners are attached only once */

    DELAY: 6000,      /* long enough to read a headline before it moves on */
    timer: null,
    paused: false,

    init: function () {
      this.root = document.getElementById('hero');
      if (!this.root || !ZB.heroSlides) return;

      // A route change replaces the markup, so state must reset.
      this.index = -1;

      this.track = this.root.querySelector('.hero__track');
      this.fill = this.root.querySelector('.hero__progress-fill');
      if (!this.track) return;

      this.render();
      this.slides = Array.prototype.slice.call(this.track.querySelectorAll('.hero__slide'));

      var self = this;

      // Track listeners live on markup that is thrown away on navigation,
      // so they are re-attached each time; window listeners are not.
      this.track.addEventListener('scroll', ZB.util.rafThrottle(function () {
        self.update();
      }), { passive: true });

      this.track.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowRight') { e.preventDefault(); self.go(self.index + 1); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); self.go(self.index - 1); }
      });

      /* Arrows, and the hover/focus rules that hold autoplay back. */
      this.buildControls();

      this.root.addEventListener('pointerenter', function () { self.paused = true; });
      this.root.addEventListener('pointerleave', function () { self.paused = false; });
      this.root.addEventListener('focusin', function () { self.paused = true; });
      this.root.addEventListener('focusout', function () { self.paused = false; });

      if (!this.bound) {
        this.bound = true;
        window.addEventListener('resize', ZB.util.debounce(function () {
          if (self.root && document.body.contains(self.root)) self.update(true);
        }, 150));
      }

      this.update(true);
      this.startAuto();
    },

    /* -----------------------------------------------------------------------
       Controls
       ----------------------------------------------------------------------- */

    buildControls: function () {
      if (this.root.querySelector('.hero__nav')) return;

      var self = this;
      var arrow = function (dir, label, path) {
        return '<button class="hero__nav hero__nav--' + dir + '" type="button" ' +
                 'data-hero-go="' + dir + '" aria-label="' + label + '">' +
                 '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + path + '"/></svg>' +
               '</button>';
      };

      this.root.insertAdjacentHTML('beforeend',
        arrow('prev', 'Previous slide', 'M15 6l-6 6 6 6') +
        arrow('next', 'Next slide', 'M9 6l6 6-6 6'));

      this.root.addEventListener('click', function (e) {
        var button = e.target.closest('[data-hero-go]');
        if (!button) return;
        var dir = button.getAttribute('data-hero-go') === 'next' ? 1 : -1;
        self.step(dir);
      });
    },

    /**
     * Which slide the track is actually showing, read from the scroll
     * position rather than from this.index.
     *
     * this.index is only refreshed by the scroll listener, which lags a
     * smooth scroll and, in some embedded viewers, never fires at all.
     * Stepping from it meant a second click did nothing (it recomputed the
     * same target) and a Previous click wrapped to the last slide, because
     * the cached index still read zero.
     */
    currentIndex: function () {
      var width = this.track.clientWidth;
      if (!width) return 0;

      var i = Math.round(this.track.scrollLeft / width);
      return Math.max(0, Math.min(this.slides.length - 1, i));
    },

    /** Move one slide, wrapping at either end. */
    step: function (dir) {
      var total = this.slides.length;
      var next = this.currentIndex() + dir;

      if (next >= total) { this.go(0, true); return; }   /* jump, not a long sweep */
      if (next < 0) { this.go(total - 1, true); return; }

      this.go(next);
    },

    /* -----------------------------------------------------------------------
       Autoplay
       ----------------------------------------------------------------------- */

    startAuto: function () {
      var self = this;
      this.stopAuto();

      var reduced = window.matchMedia &&
                    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduced || this.slides.length < 2) return;

      this.timer = window.setInterval(function () {
        /* The markup is thrown away on navigation; the interval is not. */
        if (!self.root || !document.body.contains(self.root)) { self.stopAuto(); return; }
        if (self.paused || document.hidden) return;
        self.step(1);
      }, this.DELAY);
    },

    stopAuto: function () {
      if (this.timer) { window.clearInterval(this.timer); this.timer = null; }
    },

    /*
     * THESE VALUES ARE NO LONGER ONLY THE DEVELOPER'S
     *
     * This built its markup from ZB.heroSlides without escaping, which was
     * defensible while that list was a data file nobody but the developer
     * edited. It is not any more: the admin panel's banners screen writes
     * headlines, body copy and alt text straight into this same array, so
     * these strings are now typed by whoever runs the shop — and the day
     * they are persisted by a backend, they will be typed by whoever has an
     * account. Text that reaches innerHTML is escaped; there is no version
     * of this rule that has exceptions for trusted authors.
     *
     * `href` is escaped for the same reason but that alone would not make an
     * arbitrary URL safe, so the banners screen offers a list of the site's
     * real destinations rather than a free text field. See the note on
     * checkLink() in data/admin/admin-repo.js.
     */
    render: function () {
      var esc = ZB.ui.esc;

      var html = ZB.heroSlides.map(function (s, i) {
        // Only the first slide is eager: the rest are off-screen at load.
        var loading = i === 0 ? 'eager' : 'lazy';

        return '' +
          '<div class="hero__slide" role="group" aria-roledescription="slide" ' +
               'aria-label="' + (i + 1) + ' of ' + ZB.heroSlides.length + '">' +
            '<div class="hero__media">' +
              '<img src="' + esc(s.image) + '" alt="' + esc(s.alt) + '"' +
                  ' loading="' + loading + '" decoding="async">' +
            '</div>' +
            '<div class="hero__content">' +
              '<div class="hero__eyebrow" style="--i:0">' + esc(s.eyebrow) + '</div>' +
              '<h2 class="hero__headline" style="--i:1">' + esc(s.headline) + '</h2>' +
              '<p class="hero__body" style="--i:2">' + esc(s.body) + '</p>' +
              '<a class="btn btn--on-image hero__cta" style="--i:3"' +
                 ' href="' + esc(s.href) + '">' + esc(s.cta) + '</a>' +
              '<div class="hero__proof" style="--i:4">' + esc(s.proof) + '</div>' +
            '</div>' +
          '</div>';
      }).join('');

      this.track.innerHTML = html;
      this.track.setAttribute('tabindex', '0');
    },

    /**
     * Scroll to a slide by index, clamped to the ends. `instant` is used
     * when wrapping round, where a smooth scroll would sweep the viewer
     * back across all seven slides.
     */
    go: function (i, instant) {
      var max = this.slides.length - 1;
      i = Math.max(0, Math.min(max, i));

      /* Assigning scrollLeft rather than calling scrollTo({behavior}): the
         track already carries scroll-behavior: smooth in CSS, so a plain
         assignment animates, and an instant move only needs that rule
         suspended for the one frame. This also avoids scrollTo's options
         object, which some embedded viewers ignore entirely. */
      var left = i * this.track.clientWidth;

      if (instant) {
        var previous = this.track.style.scrollBehavior;
        this.track.style.scrollBehavior = 'auto';
        this.track.scrollLeft = left;
        this.track.style.scrollBehavior = previous;
        return;
      }

      this.track.scrollLeft = left;
    },

    /** Derive the active slide from scroll position and reflect it. */
    update: function (force) {
      var width = this.track.clientWidth;
      if (!width) return;

      var total = this.slides.length;
      var i = Math.round(this.track.scrollLeft / width);
      i = Math.max(0, Math.min(total - 1, i));

      // Progress bar: one segment per slide, travelling across the rail.
      if (this.fill) {
        var span = this.track.scrollWidth - width;
        var ratio = span > 0 ? this.track.scrollLeft / span : 0;
        this.fill.style.setProperty('--progress-w', (100 / total) + '%');
        this.fill.style.setProperty('--progress-x', (ratio * (total - 1) * 100) + '%');
      }

      if (i === this.index && !force) return;
      this.index = i;

      this.slides.forEach(function (slide, n) {
        var active = n === i;
        slide.classList.toggle('is-active', active);
        // Off-screen slides should not be reachable by Tab.
        Array.prototype.forEach.call(slide.querySelectorAll('a, button'), function (el) {
          if (active) el.removeAttribute('tabindex');
          else el.setAttribute('tabindex', '-1');
        });
      });
    }
  };

  /* Mounted by the home page after the router renders its markup, rather
     than booting itself on DOMContentLoaded. */
  ZB.hero = Hero;

}(window.ZB));
