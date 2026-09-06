/* =========================================================================
   header.js — panels (nav drawer, search, account, cart), drawer navigation
   -------------------------------------------------------------------------
   Extends the ZB namespace set up in main.js. Classic script, no modules.

   Panel contract, so later phases can open a panel without touching this
   file:  any element with data-panel-open="menu|search|account|cart" opens
   the matching [data-panel] element; data-panel-close closes the current one.
   Only one panel is open at a time; they share a single overlay.
   ========================================================================= */

window.ZB = window.ZB || {};

(function (ZB) {
  'use strict';

  var all = function (sel, scope) {
    return Array.prototype.slice.call((scope || document).querySelectorAll(sel));
  };

  /* -----------------------------------------------------------------------
     Inline icons — the reference's own icon assets are not reusable, so
     these are hand-drawn to the same 22px / 1.5 stroke weight.
     ----------------------------------------------------------------------- */

  var icons = {
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/>',
    user: '<path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="8" r="4"/>',
    bag: '<path d="M6 8h12l1 12H5L6 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    chevron: '<path d="M9 6l6 6-6 6"/>',
    back: '<path d="M15 6l-6 6 6 6"/>',
    pin: '<path d="M12 21s7-5.3 7-11a7 7 0 1 0-14 0c0 5.7 7 11 7 11Z"/><circle cx="12" cy="10" r="2.5"/>',
    truck: '<path d="M3 7h11v9H3z"/><path d="M14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="1.8"/><circle cx="17" cy="18" r="1.8"/>',
    briefcase: '<rect x="3" y="8" width="18" height="12" rx="1.5"/><path d="M9 8V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>'
  };

  function svg(name, cls) {
    return '<svg class="' + (cls || '') + '" viewBox="0 0 24 24" aria-hidden="true">' + icons[name] + '</svg>';
  }

  ZB.icon = svg;

  /* =======================================================================
     PANELS
     ======================================================================= */

  var FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';

  var Panels = {
    current: null,
    lastTrigger: null,
    overlay: null,

    init: function () {
      this.overlay = document.getElementById('overlay');
      var self = this;

      document.addEventListener('click', function (e) {
        var opener = e.target.closest('[data-panel-open]');
        if (opener) {
          e.preventDefault();
          self.open(opener.getAttribute('data-panel-open'), opener);
          return;
        }
        if (e.target.closest('[data-panel-close]')) {
          e.preventDefault();
          self.close();
        }
      });

      if (this.overlay) {
        this.overlay.addEventListener('click', function () { self.close(); });
      }

      document.addEventListener('keydown', function (e) {
        if (!self.current) return;
        if (e.key === 'Escape') {
          e.preventDefault();
          self.close();
        } else if (e.key === 'Tab') {
          self.trapFocus(e);
        }
      });
    },

    open: function (name, trigger) {
      var panel = document.querySelector('[data-panel="' + name + '"]');
      if (!panel) return;

      // Opening a second panel replaces the first rather than stacking.
      if (this.current && this.current !== panel) this.close(true);

      this.current = panel;
      this.lastTrigger = trigger || null;

      panel.classList.add('is-open');
      panel.setAttribute('aria-hidden', 'false');
      if (this.overlay) this.overlay.classList.add('is-open');
      ZB.util.lockScroll(true);

      if (trigger && trigger.hasAttribute('aria-expanded')) {
        trigger.setAttribute('aria-expanded', 'true');
      }

      // Move focus inside so the keyboard follows the visible panel.
      var target = panel.querySelector('[data-panel-autofocus]') ||
                   panel.querySelector(FOCUSABLE);
      if (target) {
        // Wait a frame: focusing a still-hidden element is ignored.
        requestAnimationFrame(function () { target.focus(); });
      }

      document.dispatchEvent(new CustomEvent('zb:panel-open', { detail: { name: name, panel: panel } }));
    },

    close: function (silent) {
      var panel = this.current;
      if (!panel) return;

      panel.classList.remove('is-open');
      panel.setAttribute('aria-hidden', 'true');
      this.current = null;

      if (!silent) {
        if (this.overlay) this.overlay.classList.remove('is-open');
        ZB.util.lockScroll(false);
      }

      all('[data-panel-open][aria-expanded]').forEach(function (btn) {
        btn.setAttribute('aria-expanded', 'false');
      });

      if (!silent && this.lastTrigger) {
        this.lastTrigger.focus();
        this.lastTrigger = null;
      }

      document.dispatchEvent(new CustomEvent('zb:panel-close', { detail: { panel: panel } }));
    },

    /** Keep Tab inside the open panel. */
    trapFocus: function (e) {
      var items = all(FOCUSABLE, this.current).filter(function (el) {
        return el.offsetParent !== null;
      });
      if (!items.length) return;

      var first = items[0];
      var last = items[items.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  ZB.panels = Panels;

  /* =======================================================================
     NAV DRAWER
     Renders from ZB.navigation. Two views: the department list, and a
     sub-category view that pushes in from the right.
     ======================================================================= */

  var Nav = {
    tabsEl: null,
    inkEl: null,
    rootEl: null,
    subEl: null,
    activeId: null,

    init: function () {
      this.tabsEl = document.getElementById('nav-tabs');
      this.inkEl = document.getElementById('nav-tabs-ink');
      this.rootEl = document.getElementById('nav-root');
      this.subEl = document.getElementById('nav-sub');

      if (!this.tabsEl || !this.rootEl || !ZB.navigation) return;

      this.buildTabs();
      this.buildUtilities();
      this.select(ZB.navigation[0].id, true);

      var self = this;

      // Re-measure the sliding underline when the drawer opens or the
      // viewport changes — offsetWidth is 0 while the panel is hidden.
      document.addEventListener('zb:panel-open', function (e) {
        if (e.detail.name === 'menu') self.moveInk();
      });
      window.addEventListener('resize', ZB.util.debounce(function () { self.moveInk(); }, 150));

      // Always reopen the drawer at the top level.
      document.addEventListener('zb:panel-close', function () { self.closeSub(); });
    },

    buildTabs: function () {
      var self = this;
      var frag = document.createDocumentFragment();

      ZB.navigation.forEach(function (dept) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'nav-tabs__btn';
        btn.textContent = dept.label;
        btn.setAttribute('role', 'tab');
        btn.setAttribute('aria-selected', 'false');
        btn.dataset.dept = dept.id;
        btn.addEventListener('click', function () { self.select(dept.id); });
        frag.appendChild(btn);
      });

      this.tabsEl.insertBefore(frag, this.inkEl);
    },

    buildUtilities: function () {
      var host = document.getElementById('nav-utils');
      if (!host || !ZB.navUtilities) return;

      host.innerHTML = ZB.navUtilities.map(function (u) {
        return '<a class="nav-utils__tile" href="' + ZB.ui.href(u.href) + '">' +
                 svg(u.icon) + '<span>' + u.label + '</span>' +
               '</a>';
      }).join('');
    },

    /** Switch department, cross-fading the list so rows do not jump. */
    select: function (id, immediate) {
      if (id === this.activeId) return;

      var dept = ZB.navigation.filter(function (d) { return d.id === id; })[0];
      if (!dept) return;

      this.activeId = id;
      this.closeSub();

      all('.nav-tabs__btn', this.tabsEl).forEach(function (btn) {
        btn.setAttribute('aria-selected', String(btn.dataset.dept === id));
      });

      var self = this;
      var paint = function () {
        self.renderList(self.rootEl, dept.items, dept.id);
        self.rootEl.scrollTop = 0;
        self.rootEl.classList.remove('is-swapping');
        self.moveInk();
      };

      if (immediate) {
        paint();
      } else {
        this.rootEl.classList.add('is-swapping');
        setTimeout(paint, 150);
      }
    },

    /**
     * Render a list of entries; those with children open a sub-view, the
     * rest link to their category route. Hrefs are derived from the label
     * so the data file carries no duplicated paths.
     */
    renderList: function (host, items, deptId) {
      var self = this;
      host.innerHTML = '';

      var ul = document.createElement('ul');
      ul.className = 'nav-list';

      items.forEach(function (item, i) {
        var li = document.createElement('li');
        li.className = 'nav-list__item';
        li.style.setProperty('--i', i);

        var row;
        if (item.children && item.children.length) {
          row = document.createElement('button');
          row.type = 'button';
          row.className = 'nav-list__row';
          row.innerHTML = '<span>' + item.label + '</span>' + svg('chevron', 'nav-list__chevron');
          row.addEventListener('click', function () { self.openSub(item, deptId); });
        } else {
          row = document.createElement('a');
          row.className = 'nav-list__row';
          row.href = ZB.ui.href(item.path || ZB.ui.categoryPath(deptId, item.label));
          row.innerHTML = '<span>' + item.label + '</span>';
        }

        li.appendChild(row);
        ul.appendChild(li);
      });

      host.appendChild(ul);
    },

    openSub: function (item, deptId) {
      if (!this.subEl) return;
      var self = this;

      this.subEl.innerHTML = '';

      var back = document.createElement('button');
      back.type = 'button';
      back.className = 'nav-back';
      back.innerHTML = svg('back') + '<span>' + item.label + '</span>';
      back.addEventListener('click', function () { self.closeSub(); });
      this.subEl.appendChild(back);

      var listHost = document.createElement('div');
      this.subEl.appendChild(listHost);

      // "All <category>" first, then the children.
      var entries = [{
        label: 'All ' + item.label,
        path: ZB.ui.categoryPath(deptId, item.label)
      }].concat(item.children);

      this.renderList(listHost, entries, deptId);

      this.subEl.classList.add('is-open');
      this.subEl.scrollTop = 0;
      this.rootEl.classList.add('is-pushed');

      requestAnimationFrame(function () { back.focus(); });
    },

    closeSub: function () {
      if (!this.subEl) return;
      this.subEl.classList.remove('is-open');
      this.rootEl.classList.remove('is-pushed');
    },

    /** Slide the active-tab underline. */
    moveInk: function () {
      if (!this.inkEl) return;
      var active = this.tabsEl.querySelector('.nav-tabs__btn[aria-selected="true"]');
      if (!active || !active.offsetWidth) return;

      // Set the geometry directly rather than only through custom properties:
      // an engine that resolves var() poorly would otherwise collapse the
      // underline to its 0px fallback and hide it entirely.
      this.inkEl.style.width = active.offsetWidth + 'px';
      this.inkEl.style.transform = 'translateX(' + active.offsetLeft + 'px)';

      // Kept in sync so the CSS defaults stay meaningful.
      this.inkEl.style.setProperty('--tab-x', active.offsetLeft + 'px');
      this.inkEl.style.setProperty('--tab-w', active.offsetWidth + 'px');
    }
  };

  ZB.nav = Nav;

  /* =======================================================================
     CART BADGE
     UI state only — the working cart arrives in its own phase. Later code
     calls ZB.setCartCount(n) and the badge takes care of itself.
     ======================================================================= */

  ZB.cartCount = 0;

  ZB.setCartCount = function (n) {
    var badge = document.getElementById('cart-count');
    var live = document.getElementById('cart-count-label');
    ZB.cartCount = Math.max(0, n | 0);

    if (badge) {
      badge.textContent = ZB.cartCount;
      badge.classList.toggle('is-visible', ZB.cartCount > 0);

      // Restart the pop animation on every change.
      badge.classList.remove('is-bumped');
      void badge.offsetWidth;
      if (ZB.cartCount > 0) badge.classList.add('is-bumped');
    }
    if (live) {
      live.textContent = 'Total items in cart: ' + ZB.cartCount;
    }
  };

  /* =======================================================================
     SEARCH MODAL — presentation only for now.
     ======================================================================= */

  function initSearch() {
    var form = document.getElementById('search-form');
    if (!form) return;

    var submit = function (term) {
      term = String(term || '').trim();
      if (!term) return;
      Panels.close();
      ZB.router.navigate('/search?q=' + encodeURIComponent(term));
    };

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var input = document.getElementById('search-input');
      submit(input && input.value);
    });

    all('.search-chip').forEach(function (chip) {
      chip.addEventListener('click', function (e) {
        e.preventDefault();
        submit(chip.textContent);
      });
    });

    /* ---- live suggestions ---- */

    var input = document.getElementById('search-input');
    var results = document.getElementById('search-results');
    var chips = document.getElementById('search-chips');
    var hint = document.querySelector('.search-modal__hint');
    if (!input || !results) return;

    /** Category labels anywhere in the navigation tree that match a term. */
    var matchCategories = function (term) {
      var found = [];
      (ZB.navigation || []).forEach(function (dept) {
        dept.items.forEach(function (item) {
          var check = function (label, parent) {
            if (found.length >= 3) return;
            if (label.toLowerCase().indexOf(term) === -1) return;
            found.push({
              label: label,
              context: dept.label + (parent ? ' · ' + parent : ''),
              path: ZB.ui.categoryPath(dept.id, label)
            });
          };
          check(item.label, null);
          (item.children || []).forEach(function (child) { check(child.label, item.label); });
        });
      });
      return found;
    };

    var render = function (term) {
      term = String(term || '').trim().toLowerCase();

      var showChips = term.length < 2;
      if (chips) chips.hidden = !showChips;
      if (hint) hint.hidden = !showChips;
      results.hidden = showChips;
      if (showChips) { results.innerHTML = ''; return; }

      var esc = ZB.ui.esc;
      var products = ZB.catalogue.search(term).slice(0, 6);
      var categories = matchCategories(term);

      if (!products.length && !categories.length) {
        results.innerHTML = '<p class="search-results__empty">No matches for “' +
                            esc(term) + '”.</p>';
        return;
      }

      var catRows = categories.map(function (c) {
        return '<a class="search-result search-result--category" href="' + ZB.ui.href(c.path) + '">' +
                 '<span class="search-result__title">' + esc(c.label) + '</span>' +
                 '<span class="search-result__meta">' + esc(c.context) + '</span>' +
               '</a>';
      }).join('');

      var productRows = products.map(function (p) {
        return '<a class="search-result" href="' + ZB.ui.href(p.path) + '">' +
                 '<span class="search-result__thumb">' +
                   '<img src="' + p.images[0] + '" alt="" width="800" height="1200" loading="lazy">' +
                 '</span>' +
                 '<span class="search-result__text">' +
                   '<span class="search-result__title">' + esc(p.title) + '</span>' +
                   '<span class="search-result__meta">' + esc(p.categoryLabel) + ' · ' +
                     ZB.ui.money(p.price) + '</span>' +
                 '</span>' +
               '</a>';
      }).join('');

      results.innerHTML =
        (catRows ? '<div class="search-results__group">' +
                     '<p class="search-results__label">Categories</p>' + catRows +
                   '</div>' : '') +
        (productRows ? '<div class="search-results__group">' +
                         '<p class="search-results__label">Products</p>' + productRows +
                       '</div>' : '') +
        '<button class="search-results__all" type="button" data-search-all>' +
          'See everything for “' + esc(term) + '”' +
        '</button>';
    };

    input.addEventListener('input', ZB.util.debounce(function () {
      render(input.value);
    }, 140));

    results.addEventListener('click', function (e) {
      if (e.target.closest('[data-search-all]')) {
        submit(input.value);
        return;
      }
      /* A suggestion is an ordinary link; the router handles it. Just make
         sure the modal is not left hanging open behind the new page. */
      if (e.target.closest('a')) Panels.close();
    });

    /* Reopening search should not show the last query's suggestions. */
    document.addEventListener('zb:panel-open', function (e) {
      if (e.detail && e.detail.name === 'search') {
        input.value = '';
        render('');
      }
    });
  }

  /* =======================================================================
     CART PANEL — the drawer behind the header's cart icon
     ======================================================================= */

  function initCartPanel() {
    var body = document.getElementById('cart-panel-body');
    if (!body || !ZB.store) return;

    var empty = '' +
      '<div class="panel__empty">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 8h12l1 12H5L6 8Z"/>' +
          '<path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>' +
        '<p>Your cart is empty</p>' +
        '<a class="btn btn--primary" href="' + ZB.ui.href('/') + '">Continue shopping</a>' +
      '</div>';

    var paint = function () {
      var lines = ZB.store.state.cart;

      if (!lines.length) { body.innerHTML = empty; return; }

      var esc = ZB.ui.esc;

      var rows = lines.map(function (l) {
        return '' +
          '<li class="mini-line" data-id="' + esc(l.id) + '" data-size="' + esc(l.size || '') + '">' +
            '<span class="mini-line__media">' +
              (l.image ? '<img src="' + esc(l.image) + '" alt="" loading="lazy">' : '') +
            '</span>' +
            '<span class="mini-line__info">' +
              '<span class="mini-line__title">' + esc(l.title) + '</span>' +
              '<span class="mini-line__meta">Size ' + esc(l.size || '—') + '</span>' +
              '<span class="mini-line__meta">' + ZB.ui.money(l.price) + '</span>' +
            '</span>' +
            '<span class="mini-line__qty">' +
              '<button type="button" data-mini-qty="-1" aria-label="Decrease quantity">−</button>' +
              '<span>' + l.qty + '</span>' +
              '<button type="button" data-mini-qty="1" aria-label="Increase quantity">+</button>' +
            '</span>' +
            '<button class="mini-line__remove" type="button" data-mini-remove' +
                    ' aria-label="Remove ' + esc(l.title) + '">' +
              '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
            '</button>' +
          '</li>';
      }).join('');

      body.innerHTML =
        '<ul class="mini-cart">' + rows + '</ul>' +
        '<div class="mini-cart__foot">' +
          '<p class="mini-cart__total">' +
            '<span>Subtotal</span><span>' + ZB.ui.money(ZB.store.cartTotal()) + '</span>' +
          '</p>' +
          '<a class="btn btn--primary btn--block" href="' + ZB.ui.href('/cart') + '">View cart</a>' +
        '</div>';
    };

    body.addEventListener('click', function (e) {
      var row = e.target.closest('[data-id]');
      if (!row) return;

      var id = row.getAttribute('data-id');
      var size = row.getAttribute('data-size') || null;

      if (e.target.closest('[data-mini-remove]')) {
        ZB.store.removeFromCart(id, size);
        return;
      }

      var step = e.target.closest('[data-mini-qty]');
      if (step) {
        var line = ZB.store.state.cart.filter(function (l) {
          return l.id === id && l.size === size;
        })[0];
        if (line) ZB.store.setQty(id, size, line.qty + Number(step.getAttribute('data-mini-qty')));
      }
    });

    ZB.store.subscribe(paint);
  }

  /* =======================================================================
     BOOT
     ======================================================================= */

  function init() {
    Panels.init();
    Nav.init();
    initSearch();
    initCartPanel();

    // The badge follows the store, so anything that changes the cart —
    // a product page, the cart page, another tab's restore — updates it.
    if (ZB.store) {
      ZB.store.subscribe(function () { ZB.setCartCount(ZB.store.cartCount()); });
    } else {
      ZB.setCartCount(0);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

}(window.ZB));
