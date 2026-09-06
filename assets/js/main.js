/* =========================================================================
   main.js — global boot: scroll reveal, in-view toggling, scroll state
   -------------------------------------------------------------------------
   Loaded as a classic script (no modules) so index.html opens straight from
   the filesystem. Everything hangs off a single ZB namespace; later files
   (header.js, carousel.js, cart.js) extend it rather than adding globals.
   ========================================================================= */

window.ZB = window.ZB || {};

(function (ZB) {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* -----------------------------------------------------------------------
     Small shared helpers
     ----------------------------------------------------------------------- */

  ZB.util = {
    /** querySelectorAll as a real array. */
    all: function (selector, scope) {
      return Array.prototype.slice.call((scope || document).querySelectorAll(selector));
    },

    /** Trailing-edge debounce. */
    debounce: function (fn, wait) {
      var timer;
      return function () {
        var args = arguments, self = this;
        clearTimeout(timer);
        timer = setTimeout(function () { fn.apply(self, args); }, wait || 120);
      };
    },

    /** Run fn at most once per animation frame. */
    rafThrottle: function (fn) {
      var queued = false;
      return function () {
        var args = arguments, self = this;
        if (queued) return;
        queued = true;
        requestAnimationFrame(function () {
          queued = false;
          fn.apply(self, args);
        });
      };
    },

    /** Lock/unlock page scroll while a drawer or modal is open. */
    lockScroll: function (locked) {
      document.body.classList.toggle('is-locked', !!locked);
    }
  };

  /* -----------------------------------------------------------------------
     Scroll reveal
     `.reveal` gets `.is-in` once, the first time it enters the viewport.
     Stagger a group with style="--d:.08s" on each child.
     ----------------------------------------------------------------------- */

  function showAll(items) {
    items.forEach(function (el) { el.classList.add('is-in'); });
  }

  function initReveal() {
    var items = ZB.util.all('.reveal:not(.is-in)');
    if (!items.length) return;

    // No observer support, or the visitor asked for less motion: show at once.
    if (reduceMotion || !('IntersectionObserver' in window)) {
      showAll(items);
      return;
    }

    var reported = false;

    var observer = new IntersectionObserver(function (entries) {
      reported = true;
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        observer.unobserve(entry.target);   // one-shot
      });
    }, {
      // Fire slightly before the element reaches the fold, and don't wait
      // for tall sections to be fully visible.
      rootMargin: '0px 0px -12% 0px',
      threshold: 0.08
    });

    items.forEach(function (el) { observer.observe(el); });

    /* Fail open. A working observer always delivers an initial callback for
       everything it observes, intersecting or not. If nothing arrives, the
       observer is not running (some embedded viewers never dispatch it) and
       leaving the page as-is would hide every revealed element permanently.
       Content visibility must never depend on an animation succeeding. */
    setTimeout(function () {
      if (reported) return;
      observer.disconnect();
      showAll(items);
    }, 2000);
  }

  /* -----------------------------------------------------------------------
     In-view toggling
     [data-anim] gains `.in-view` while visible and loses it when it leaves,
     so continuous animation never runs off-screen.
     ----------------------------------------------------------------------- */

  function initInView() {
    var items = ZB.util.all('[data-anim]');
    if (!items.length || !('IntersectionObserver' in window)) return;

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        entry.target.classList.toggle('in-view', entry.isIntersecting);
      });
    }, { threshold: 0.15 });

    items.forEach(function (el) { observer.observe(el); });
  }

  /* -----------------------------------------------------------------------
     Scroll state
     Publishes two things the header (and anything else) can style against:
       body.is-scrolled   past the first 40px
       body.is-scroll-up  scrolling back up — used to reveal a hidden header
     ----------------------------------------------------------------------- */

  function initScrollState() {
    var lastY = window.pageYOffset;
    var body = document.body;

    var update = ZB.util.rafThrottle(function () {
      var y = window.pageYOffset;
      body.classList.toggle('is-scrolled', y > 40);
      // Ignore sub-pixel jitter and bounce at the very top.
      if (Math.abs(y - lastY) > 4) {
        body.classList.toggle('is-scroll-up', y < lastY);
        lastY = y;
      }
      ZB.scrollY = y;
    });

    window.addEventListener('scroll', update, { passive: true });
    update();
  }

  /* -----------------------------------------------------------------------
     Viewport unit fix
     Mobile browsers change 100vh as the address bar hides. --vh gives a
     stable unit for full-height panels.
     ----------------------------------------------------------------------- */

  function initViewportUnit() {
    var set = function () {
      document.documentElement.style.setProperty('--vh', (window.innerHeight * 0.01) + 'px');
    };
    set();
    window.addEventListener('resize', ZB.util.debounce(set, 150));
    window.addEventListener('orientationchange', set);
  }

  /* -----------------------------------------------------------------------
     Boot
     Re-runnable: call ZB.refresh() after injecting markup so newly added
     .reveal elements are picked up.
     ----------------------------------------------------------------------- */

  ZB.reduceMotion = reduceMotion;

  ZB.refresh = function () {
    initReveal();
    initInView();
  };

  function init() {
    document.documentElement.classList.add('js');
    initViewportUnit();
    initScrollState();
    ZB.refresh();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

}(window.ZB));
