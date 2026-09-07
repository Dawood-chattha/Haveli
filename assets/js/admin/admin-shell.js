/* =========================================================================
   admin-shell.js — the sidebar, the topbar, and the chrome around them
   -------------------------------------------------------------------------
   Everything that stays on screen while routes come and go. The shell is
   built once at boot and then only updated, so navigating never rebuilds
   the menu and never loses the drawer or collapse state.

   It listens for the router's `zb:navigated` event rather than being called
   by each page, which means a page cannot forget to update the chrome.

   RESPONSIVE BEHAVIOUR
     >= 990px   sidebar is a column of the grid, and can be collapsed to
                icons only. That choice is remembered.
     <  990px   sidebar becomes an off-canvas drawer over a scrim, opened
                from the topbar. Collapse does not apply.

   The 990px step is the same one the storefront uses for its own layout
   change, so both halves of the site break at the same width.
   ========================================================================= */

window.ZB = window.ZB || {};

(function (ZB) {
  'use strict';

  /* A UI convenience, not data about the user: which way the sidebar was
     left. Nothing sensitive is stored here, and nothing ever should be. */
  var COLLAPSE_KEY = 'zb.admin.sidebar.collapsed';

  /* The other two chrome preferences, in one entry beside it: how tightly
     the panel is spaced, and whether it animates. Same rule as above —
     these describe this browser on this desk, not the person using it, and
     nothing about the user, the shop or any credential may ever be added
     here. Everything the panel knows that is not a device preference goes
     through data/admin/admin-repo.js instead.

     They live here rather than in that record because they are not shop
     data: they are the same kind of thing as the collapse state, and they
     are why appearance is the one part of Settings that survives a reload. */
  var APPEARANCE_KEY = 'zb.admin.appearance';

  var DRAWER_QUERY = '(max-width: 989px)';

  var Shell = {

    root: null,
    sidebar: null,
    topbar: null,
    scrim: null,

    collapsed: false,
    drawerOpen: false,
    returnFocusTo: null,

    /* Filled from the defaults in data/admin/admin-settings.js, then from
       whatever this browser has stored. */
    appearance: null,

    /* -------------------------------------------------------------------
       Boot
       ------------------------------------------------------------------- */

    init: function () {
      this.root = document.getElementById('admin');
      this.sidebar = document.getElementById('admin-sidebar');
      this.topbar = document.getElementById('admin-topbar');
      this.scrim = document.getElementById('admin-scrim');
      if (!this.root || !this.sidebar || !this.topbar) return;

      this.sidebar.innerHTML = this.renderSidebar();
      this.topbar.innerHTML = this.renderTopbar();

      this.collapsed = this.readCollapsed();
      this.applyCollapse();

      /* Before the first page paints, so the panel is never drawn at one
         density and then re-drawn at another. */
      this.appearance = this.readAppearance();
      this.applyAppearance();

      this.bind();
      this.loadBadges();
    },

    /* -------------------------------------------------------------------
       Sidebar
       ------------------------------------------------------------------- */

    renderSidebar: function () {
      var ui = ZB.adminUI;
      var user = ZB.adminUser;

      var items = ZB.adminNav.map(function (item) {
        /* `exact` items manage their own active class — see admin-nav.js
           for why Dashboard cannot use the router's prefix matching. */
        var manual = item.exact ? ' data-manual-active' : '';

        return '' +
          '<li class="a-nav__item">' +
            '<a class="a-nav__link" href="' + ui.href(item.path) + '"' + manual +
               ' title="' + ui.esc(item.label) + '">' +
              '<span class="a-nav__icon">' + ui.icon(item.icon) + '</span>' +
              '<span class="a-nav__label">' + ui.esc(item.label) + '</span>' +
              (item.badge
                ? '<span class="a-nav__badge" data-badge="' + ui.esc(item.badge) + '" hidden></span>'
                : '') +
            '</a>' +
          '</li>';
      }).join('');

      return '' +
        '<div class="a-sidebar__head">' +
          '<a class="a-sidebar__brand" href="' + ui.href('/admin') + '" data-manual-active>' +
            '<span class="a-sidebar__mark" aria-hidden="true">H</span>' +
            '<span class="a-sidebar__wordmark">' +
              'HAVELI<span class="a-sidebar__sub">Admin</span>' +
            '</span>' +
          '</a>' +

          /* Closes the drawer on small screens; collapses the column on
             large ones. One control, because to the viewer it is one idea:
             get the menu out of the way. */
          '<button class="a-sidebar__toggle" type="button" data-admin-toggle' +
                 ' aria-label="Collapse menu">' +
            ui.icon('collapse') +
          '</button>' +
        '</div>' +

        '<nav class="a-sidebar__nav" aria-label="Admin sections">' +
          '<ul class="a-nav">' + items + '</ul>' +
        '</nav>' +

        '<div class="a-sidebar__foot">' +
          /* Crosses into the storefront shell, which is a different HTML
             document — so the router must let the browser handle it. */
          '<a class="a-sidebar__store" href="/" data-full-load' +
             ' title="View store">' +
            '<span class="a-nav__icon">' + ui.icon('store') + '</span>' +
            '<span class="a-nav__label">View store</span>' +
          '</a>' +

          '<div class="a-sidebar__user">' +
            '<span class="a-sidebar__avatar" aria-hidden="true">' +
              ui.esc(user.initials) +
            '</span>' +
            '<span class="a-sidebar__identity">' +
              '<span class="a-sidebar__name">' + ui.esc(user.name) + '</span>' +
              '<span class="a-sidebar__role">' + ui.esc(user.role) + '</span>' +
            '</span>' +
            '<button class="a-sidebar__logout" type="button" data-admin-logout' +
                   ' aria-label="Sign out" title="Sign out">' +
              ui.icon('logout') +
            '</button>' +
          '</div>' +
        '</div>';
    },

    /* -------------------------------------------------------------------
       Topbar
       ------------------------------------------------------------------- */

    renderTopbar: function () {
      var ui = ZB.adminUI;

      return '' +
        '<button class="a-topbar__menu" type="button" data-admin-drawer' +
               ' aria-label="Open menu" aria-expanded="false" aria-controls="admin-sidebar">' +
          ui.icon('menu') +
        '</button>' +

        '<nav class="a-crumbs" aria-label="Breadcrumb">' +
          '<ol class="a-crumbs__list" id="admin-crumbs"></ol>' +
        '</nav>' +

        '<div class="a-topbar__tools">' +
          '<form class="a-topbar__search" id="admin-search" role="search">' +
            '<label class="visually-hidden" for="admin-search-input">Search the admin panel</label>' +
            '<span class="a-topbar__search-icon" aria-hidden="true">' + ui.icon('search') + '</span>' +
            '<input class="a-topbar__search-input" id="admin-search-input" type="search"' +
                  ' placeholder="Search products" autocomplete="off">' +
          '</form>' +

          '<div class="a-topbar__menu-wrap">' +
            '<button class="a-topbar__icon-btn" type="button" data-admin-bell' +
                   ' aria-label="Notifications" aria-expanded="false" aria-haspopup="true">' +
              ui.icon('bell') +
            '</button>' +
            '<div class="a-dropdown" id="admin-bell-menu" hidden>' +
              '<div class="a-dropdown__head">Activity</div>' +
              '<p class="a-dropdown__empty">' +
                'Nothing yet. Order and stock activity appears here once those ' +
                'sections are built.' +
              '</p>' +
            '</div>' +
          '</div>' +
        '</div>';
    },

    /* -------------------------------------------------------------------
       Wiring
       ------------------------------------------------------------------- */

    bind: function () {
      var self = this;

      /* One delegated listener for the whole shell rather than one per
         control, so nothing has to be rebound if a region is re-rendered. */
      this.root.addEventListener('click', function (e) {
        if (e.target.closest('[data-admin-toggle]')) {
          e.preventDefault();
          if (self.isDrawerMode()) self.closeDrawer();
          else self.toggleCollapse();
          return;
        }

        if (e.target.closest('[data-admin-drawer]')) {
          e.preventDefault();
          self.openDrawer();
          return;
        }

        if (e.target.closest('[data-admin-bell]')) {
          e.preventDefault();
          self.toggleBell();
          return;
        }

        if (e.target.closest('[data-admin-logout]')) {
          e.preventDefault();
          self.logout();
          return;
        }

        /* A click anywhere else closes an open dropdown. */
        if (!e.target.closest('.a-dropdown')) self.closeBell();

        /* Following a menu link on a phone should put the drawer away. */
        if (self.drawerOpen && e.target.closest('.a-sidebar__nav a')) {
          self.closeDrawer();
        }
      });

      if (this.scrim) {
        this.scrim.addEventListener('click', function () { self.closeDrawer(); });
      }

      document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
        if (self.drawerOpen) self.closeDrawer();
        self.closeBell();
      });

      /* Keep focus inside the drawer while it covers the page. */
      this.sidebar.addEventListener('keydown', function (e) {
        if (e.key === 'Tab' && self.drawerOpen) self.trapFocus(e);
      });

      var search = document.getElementById('admin-search');
      if (search) {
        search.addEventListener('submit', function (e) {
          e.preventDefault();
          var input = document.getElementById('admin-search-input');
          var term = (input.value || '').trim();
          /* The query string is the search state, the same way the
             storefront's collection filters work. */
          ZB.router.navigate('/admin/products' + (term ? '?q=' + encodeURIComponent(term) : ''));
          if (self.drawerOpen) self.closeDrawer();
        });
      }

      /* Leaving drawer widths must not strand an open drawer. */
      window.addEventListener('resize', ZB.util.debounce(function () {
        if (!self.isDrawerMode() && self.drawerOpen) self.closeDrawer();
        self.applyCollapse();
      }, 150));

      document.addEventListener('zb:navigated', function (e) {
        self.onNavigate(e.detail.path, e.detail.params);
      });
    },

    /* -------------------------------------------------------------------
       Route changes
       ------------------------------------------------------------------- */

    onNavigate: function (path, params) {
      /* The login route is deliberately outside the shell: signing in
         should not show the panel the sign-in guards. */
      var isAuth = path === '/admin/login';
      this.root.classList.toggle('is-auth', isAuth);

      this.markDashboard(path);
      this.setCrumbs(path, params);
      this.closeBell();
      if (this.drawerOpen) this.closeDrawer();

      /* Route changes move the eye to new content; announce where it is. */
      var content = document.getElementById('admin-app');
      if (content) content.setAttribute('aria-busy', 'false');
    },

    /**
     * Dashboard is exact-match only. '/admin' is a prefix of every other
     * admin path, so the router's prefix rule would leave it lit on every
     * page; it opts out and is set here instead.
     */
    markDashboard: function (path) {
      var links = this.root.querySelectorAll('[data-manual-active]');
      Array.prototype.forEach.call(links, function (link) {
        var target = (link.getAttribute('href') || '').replace(/^#/, '');
        var active = target === path;
        link.classList.toggle('is-active', active);
        if (active) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
      });
    },

    /**
     * The trail in the topbar. Pages describe their own trail through a
     * `crumbs` property, so the shell never has to keep a second copy of
     * the route table in sync with the real one.
     */
    setCrumbs: function (path, params) {
      var list = document.getElementById('admin-crumbs');
      if (!list) return;

      var ui = ZB.adminUI;
      var hit = ZB.router.match(path);
      var page = hit && hit.route.page;

      var crumbs = [];
      if (page && page.crumbs) {
        crumbs = typeof page.crumbs === 'function' ? page.crumbs(params) : page.crumbs;
      }

      var trail = [{ label: 'Admin', path: '/admin' }].concat(crumbs || []);
      var last = trail.length - 1;

      list.innerHTML = trail.map(function (crumb, i) {
        var label = ui.esc(crumb.label);
        var body = (i === last || !crumb.path)
          ? '<span aria-current="page">' + label + '</span>'
          : '<a href="' + ui.href(crumb.path) + '">' + label + '</a>';
        return '<li class="a-crumbs__item">' + body + '</li>';
      }).join('');
    },

    /* -------------------------------------------------------------------
       Collapse (desktop)
       ------------------------------------------------------------------- */

    isDrawerMode: function () {
      return window.matchMedia(DRAWER_QUERY).matches;
    },

    readCollapsed: function () {
      /* localStorage throws in some privacy modes; a missing preference is
         not a failure, it just means the default. */
      try {
        return localStorage.getItem(COLLAPSE_KEY) === '1';
      } catch (e) {
        return false;
      }
    },

    toggleCollapse: function () {
      this.collapsed = !this.collapsed;
      try {
        localStorage.setItem(COLLAPSE_KEY, this.collapsed ? '1' : '0');
      } catch (e) { /* the preference simply will not survive a reload */ }
      this.applyCollapse();
    },

    applyCollapse: function () {
      var on = this.collapsed && !this.isDrawerMode();
      this.root.classList.toggle('is-collapsed', on);

      var toggle = this.root.querySelector('[data-admin-toggle]');
      if (!toggle) return;

      if (this.isDrawerMode()) {
        toggle.setAttribute('aria-label', 'Close menu');
      } else {
        toggle.setAttribute('aria-label', on ? 'Expand menu' : 'Collapse menu');
        toggle.setAttribute('aria-expanded', on ? 'false' : 'true');
      }
    },

    /** Set the collapse state outright. The settings screen uses this. */
    setCollapsed: function (on) {
      if (this.collapsed === !!on) return;
      this.toggleCollapse();
    },

    /* -------------------------------------------------------------------
       Appearance

       Two preferences, both applied as attributes on the panel's root so
       that the whole answer is in CSS: `data-density` retunes the spacing
       tokens, `data-motion="reduced"` switches transitions off. No page
       has to know either exists, and neither can leave a component behind.

       `motion: 'system'` deliberately sets nothing. The panel's stylesheets
       already honour prefers-reduced-motion, so "follow my system setting"
       is the absence of an override rather than a second opinion about it —
       and somebody who has asked their operating system for less motion
       must not have it handed back by a store admin panel.
       ------------------------------------------------------------------- */

    readAppearance: function () {
      var defaults = (ZB.adminSettings && ZB.adminSettings.appearance) || {};
      var out = {
        density: defaults.density || 'comfortable',
        motion: defaults.motion || 'system'
      };

      /* Same defensive read as the collapse state: localStorage throws in
         some privacy modes, and a stored value can be anything at all if
         somebody has edited it by hand. A bad value means the default, not
         a broken panel. */
      try {
        var stored = JSON.parse(localStorage.getItem(APPEARANCE_KEY) || '{}');
        if (stored.density === 'compact' || stored.density === 'comfortable') {
          out.density = stored.density;
        }
        if (stored.motion === 'reduced' || stored.motion === 'system') {
          out.motion = stored.motion;
        }
      } catch (e) { /* the defaults stand */ }

      return out;
    },

    applyAppearance: function () {
      var a = this.appearance || { density: 'comfortable', motion: 'system' };
      this.root.setAttribute('data-density', a.density);

      if (a.motion === 'reduced') this.root.setAttribute('data-motion', 'reduced');
      else this.root.removeAttribute('data-motion');
    },

    /** Change one or both, apply, and remember. Returns the new state. */
    setAppearance: function (patch) {
      this.appearance = this.appearance || this.readAppearance();

      Object.keys(patch || {}).forEach(function (key) {
        this.appearance[key] = patch[key];
      }, this);

      this.applyAppearance();

      try {
        localStorage.setItem(APPEARANCE_KEY, JSON.stringify(this.appearance));
      } catch (e) { /* the preference simply will not survive a reload */ }

      return this.appearance;
    },

    /**
     * Redraw the sidebar's profile block from ZB.adminUser.
     *
     * Only that block, not the whole sidebar: rebuilding the menu would
     * throw away the active item and, on a phone, the open drawer. The
     * settings screen calls this after saving a name so the sidebar agrees
     * with the form without a reload.
     */
    refreshUser: function () {
      var host = this.sidebar && this.sidebar.querySelector('.a-sidebar__identity');
      var avatar = this.sidebar && this.sidebar.querySelector('.a-sidebar__avatar');
      var user = ZB.adminUser || {};
      var ui = ZB.adminUI;
      if (!host) return;

      host.innerHTML =
        '<span class="a-sidebar__name">' + ui.esc(user.name || '') + '</span>' +
        '<span class="a-sidebar__role">' + ui.esc(user.role || '') + '</span>';

      if (avatar) avatar.textContent = user.initials || '';
    },

    /* -------------------------------------------------------------------
       Drawer (mobile)
       ------------------------------------------------------------------- */

    openDrawer: function () {
      if (this.drawerOpen) return;
      this.drawerOpen = true;
      this.returnFocusTo = document.activeElement;

      this.root.classList.add('is-drawer-open');
      ZB.util.lockScroll(true);
      this.sidebar.setAttribute('aria-modal', 'true');
      this.sidebar.setAttribute('role', 'dialog');

      var trigger = this.root.querySelector('[data-admin-drawer]');
      if (trigger) trigger.setAttribute('aria-expanded', 'true');

      var first = this.focusable()[0];
      if (first) first.focus();
    },

    closeDrawer: function () {
      if (!this.drawerOpen) return;
      this.drawerOpen = false;

      this.root.classList.remove('is-drawer-open');
      ZB.util.lockScroll(false);
      this.sidebar.removeAttribute('aria-modal');
      this.sidebar.removeAttribute('role');

      var trigger = this.root.querySelector('[data-admin-drawer]');
      if (trigger) trigger.setAttribute('aria-expanded', 'false');

      /* Only pull focus back if it is still inside the drawer; a click on a
         menu link has already moved it somewhere better. */
      if (this.returnFocusTo && this.sidebar.contains(document.activeElement)) {
        this.returnFocusTo.focus();
      }
      this.returnFocusTo = null;
    },

    focusable: function () {
      return Array.prototype.filter.call(
        this.sidebar.querySelectorAll('a[href], button:not([disabled])'),
        function (el) { return el.offsetParent !== null; }
      );
    },

    trapFocus: function (e) {
      var items = this.focusable();
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
    },

    /* -------------------------------------------------------------------
       Notifications dropdown
       ------------------------------------------------------------------- */

    toggleBell: function () {
      var menu = document.getElementById('admin-bell-menu');
      if (!menu) return;
      if (menu.hidden) this.openBell();
      else this.closeBell();
    },

    openBell: function () {
      var menu = document.getElementById('admin-bell-menu');
      var button = this.root.querySelector('[data-admin-bell]');
      if (!menu) return;
      menu.hidden = false;
      if (button) button.setAttribute('aria-expanded', 'true');
    },

    closeBell: function () {
      var menu = document.getElementById('admin-bell-menu');
      var button = this.root.querySelector('[data-admin-bell]');
      if (!menu || menu.hidden) return;
      menu.hidden = true;
      if (button) button.setAttribute('aria-expanded', 'false');
    },

    /* -------------------------------------------------------------------
       Sign out
       ------------------------------------------------------------------- */

    /**
     * There is no session to end, so this only returns to the login screen.
     *
     * It is written as its own method because that is where the real thing
     * will go: sign out through whatever auth service is chosen, then
     * navigate. Nothing else in the panel should have to change.
     */
    logout: function () {
      ZB.router.navigate('/admin/login');
    },

    /* -------------------------------------------------------------------
       Sidebar counters
       ------------------------------------------------------------------- */

    /**
     * Fills the small counts beside menu items. Reads through ZB.repo like
     * every other part of the panel, so these become live numbers the day a
     * backend is connected without this code changing.
     */
    loadBadges: function () {
      var root = this.root;

      ZB.repo.metrics.navBadges().then(function (counts) {
        Object.keys(counts).forEach(function (key) {
          var slot = root.querySelector('[data-badge="' + key + '"]');
          var value = counts[key];
          if (!slot || !value) return;
          slot.textContent = value > 99 ? '99+' : String(value);
          slot.hidden = false;
        });
      });
    }
  };

  ZB.adminShell = Shell;

}(window.ZB));
