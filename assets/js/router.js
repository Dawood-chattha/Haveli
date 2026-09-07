/* =========================================================================
   router.js — client-side router
   -------------------------------------------------------------------------
   Hand written, no dependency. Two modes, chosen automatically:

     history mode   served over http(s)  ->  /category/women
     hash mode      no History API       ->  #/category/women

   History mode is the real one. The hash branch remains as a fallback for
   an environment without pushState; note that it does NOT make the site
   work from the file system, because index.html carries <base href="/">
   so that deep routes can resolve their assets. Serve the folder over http
   (dev/serve.ps1) rather than opening the file directly.

   Registering a page:

     ZB.router.add('/category/:dept', {
       title:  function (p) { return p.dept; },
       render: function (p) { return '<h1>...</h1>'; },   // HTML string
       mount:  function (p) { ... }                       // optional wiring
     });

   Building a link:  ZB.router.href('/cart')  ->  '/cart' or '#/cart'
   ========================================================================= */

window.ZB = window.ZB || {};

(function (ZB) {
  'use strict';

  var routes = [];
  var notFound = null;
  var outlet = null;
  var currentKey = null;
  var scrollPositions = {};
  var started = false;

  var mode = (window.location.protocol === 'file:' || !window.history.pushState)
    ? 'hash'
    : 'history';

  /* -----------------------------------------------------------------------
     Path helpers
     ----------------------------------------------------------------------- */

  /** '/category/:dept' -> matcher */
  function compile(path) {
    var keys = [];
    var pattern = path
      .replace(/[.+*?^${}()|[\]\\]/g, '\\$&')
      .replace(/\/:([A-Za-z0-9_]+)/g, function (_, key) {
        keys.push(key);
        return '/([^/]+)';
      });
    return { rx: new RegExp('^' + pattern + '/?$'), keys: keys };
  }

  function currentPath() {
    if (mode === 'hash') {
      var h = window.location.hash.replace(/^#/, '');
      return h || '/';
    }
    return window.location.pathname || '/';
  }

  function currentQuery() {
    var qs;
    if (mode === 'hash') {
      var h = window.location.hash.replace(/^#/, '');
      qs = h.indexOf('?') > -1 ? h.slice(h.indexOf('?') + 1) : '';
    } else {
      qs = window.location.search.replace(/^\?/, '');
    }

    var out = {};
    qs.split('&').forEach(function (pair) {
      if (!pair) return;
      var i = pair.indexOf('=');
      var k = decodeURIComponent(i > -1 ? pair.slice(0, i) : pair);
      var v = i > -1 ? decodeURIComponent(pair.slice(i + 1).replace(/\+/g, ' ')) : '';
      out[k] = v;
    });
    return out;
  }

  /** Strip any query so matching only sees the path. */
  function pathOnly(p) {
    var i = p.indexOf('?');
    return i > -1 ? p.slice(0, i) : p;
  }

  /**
   * Whether the cross-fade between routes should happen at all.
   *
   * This used to be ZB.reduceMotion, which main.js captures once at load.
   * Two things it therefore could not see:
   *
   *   - the system setting being changed after the page loaded, which a
   *     reader who has just turned it on has every reason to expect to work;
   *   - the admin panel's own Reduce motion switch, which stamps
   *     data-motion="reduced" on the panel root (see admin-shell.js). That
   *     switch turned the CSS transitions off and left the timeout below
   *     running, so choosing it replaced a 160ms cross-fade with a 160ms
   *     pause in which nothing happened — a setting delivering a delay in
   *     place of the motion it had removed.
   *
   * Asked at navigation time, both are answered. Nothing here knows what an
   * admin panel is: it asks whether anything on the page has said motion is
   * off, and the storefront simply never has such an element, so its
   * behaviour is unchanged.
   */
  function motionOff() {
    if (window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches) return true;

    return !!document.querySelector('[data-motion="reduced"]');
  }

  /* -----------------------------------------------------------------------
     Router
     ----------------------------------------------------------------------- */

  var Router = {
    mode: mode,

    add: function (path, page) {
      var c = compile(path);
      routes.push({ path: path, rx: c.rx, keys: c.keys, page: page });
      return Router;
    },

    setNotFound: function (page) {
      notFound = page;
      return Router;
    },

    /** Turn an app path into an href usable in the current mode. */
    href: function (path) {
      if (!path) return mode === 'hash' ? '#/' : '/';
      if (/^(https?:)?\/\//.test(path) || path.charAt(0) === '#') return path;
      return mode === 'hash' ? '#' + path : path;
    },

    match: function (path) {
      path = pathOnly(path);
      for (var i = 0; i < routes.length; i++) {
        var m = path.match(routes[i].rx);
        if (!m) continue;

        var params = {};
        routes[i].keys.forEach(function (key, n) {
          params[key] = decodeURIComponent(m[n + 1]);
        });
        return { route: routes[i], params: params };
      }
      return null;
    },

    navigate: function (path, options) {
      options = options || {};
      if (!path) return;

      // Remember where we were, so going back restores the scroll position.
      if (currentKey) scrollPositions[currentKey] = window.pageYOffset;

      var target = mode === 'hash' ? '#' + path : path;

      if (mode === 'hash') {
        if (options.replace) window.location.replace(target);
        else window.location.hash = path;
        // hashchange drives the render
      } else {
        if (options.replace) window.history.replaceState({}, '', target);
        else window.history.pushState({}, '', target);
        Router.render();
      }
    },

    /** Render whatever the current URL points at. */
    render: function (restoreScroll) {
      if (!outlet) return;

      var path = currentPath();
      var query = currentQuery();
      var hit = Router.match(path);
      var page = hit ? hit.route.page : notFound;
      var params = hit ? hit.params : {};

      params.query = query;

      if (!page) return;

      var key = pathOnly(path);
      var previous = currentKey;
      currentKey = key;

      // Leave, swap, enter — a short cross-fade rather than a hard cut.
      outlet.classList.add('is-leaving');

      var swap = function () {
        outlet.innerHTML = typeof page.render === 'function' ? page.render(params) : '';

        document.title = typeof page.title === 'function'
          ? page.title(params) + ' — HAVELI'
          : (page.title ? page.title + ' — HAVELI' : 'HAVELI — Real Fashion, Real Prices');

        document.body.setAttribute('data-route', hit ? hit.route.path : '404');

        if (typeof page.mount === 'function') page.mount(params);

        Router.markActive();
        if (ZB.refresh) ZB.refresh();

        outlet.classList.remove('is-leaving');
        outlet.classList.add('is-entering');

        // Restore on back/forward, otherwise start at the top.
        var y = restoreScroll && scrollPositions[key] != null ? scrollPositions[key] : 0;
        window.scrollTo(0, y);

        window.setTimeout(function () {
          outlet.classList.remove('is-entering');
        }, 300);

        document.dispatchEvent(new CustomEvent('zb:navigated', {
          detail: { path: key, params: params, from: previous }
        }));
      };

      // Skip the wait on the very first paint.
      if (previous === null || motionOff()) swap();
      else window.setTimeout(swap, 160);
    },

    /** Flag links that point at the current route. */
    markActive: function () {
      var here = pathOnly(currentPath());
      var links = document.querySelectorAll('a[href]');

      Array.prototype.forEach.call(links, function (a) {
        /* Some links know better than the router does whether they are the
           current one — a category chip stays lit while you are inside one
           of its children, which is not something a path comparison can
           work out. Those opt out and manage the class themselves. */
        if (a.hasAttribute('data-manual-active')) return;

        var raw = a.getAttribute('href') || '';
        var target = raw.charAt(0) === '#' ? raw.slice(1) : raw;
        if (!target || target.charAt(0) !== '/') return;

        target = pathOnly(target);
        var exact = target === here;
        // A department link stays lit while you are inside its sub-category.
        var within = target !== '/' && here.indexOf(target + '/') === 0;

        a.classList.toggle('is-active', exact || within);
        if (exact) a.setAttribute('aria-current', 'page');
        else a.removeAttribute('aria-current');
      });
    },

    start: function (outletEl) {
      if (started) return;
      started = true;
      outlet = outletEl || document.getElementById('app');

      // Intercept in-app links anywhere on the page, including markup that
      // pages render after this runs.
      document.addEventListener('click', function (e) {
        if (e.defaultPrevented || e.button !== 0) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

        var a = e.target.closest('a[href]');
        if (!a || a.hasAttribute('download') || a.getAttribute('target') === '_blank') return;

        /* Links that cross between the storefront shell and the admin shell
           are real page loads, not routes: each shell is its own HTML
           document with its own route table, so swapping #app would land on
           a route the current table has never heard of. They opt out here
           rather than being rewritten as buttons, which would cost
           middle-click and "open in new tab". */
        if (a.hasAttribute('data-full-load')) return;

        var raw = a.getAttribute('href') || '';
        var path = raw.charAt(0) === '#' ? raw.slice(1) : raw;

        // Only handle app paths; leave real external links alone.
        if (!path || path.charAt(0) !== '/') return;

        e.preventDefault();
        if (pathOnly(path) === pathOnly(currentPath())) {
          window.scrollTo({ top: 0, behavior: 'smooth' });
          return;
        }
        Router.navigate(path);
      });

      if (mode === 'hash') {
        window.addEventListener('hashchange', function () { Router.render(true); });
        if (!window.location.hash) window.location.replace('#/');
      } else {
        window.addEventListener('popstate', function () { Router.render(true); });
      }

      Router.render();
    }
  };

  ZB.router = Router;

}(window.ZB));
