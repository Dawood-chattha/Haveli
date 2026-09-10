/* =========================================================================
   bootstrap.js — fetch what the storefront cannot render without
   -------------------------------------------------------------------------
   Two things now come from the database rather than from a file: the
   products and the menu. Both are needed before the first page is drawn, so
   this starts fetching them the moment it is parsed — which is before
   DOMContentLoaded, and therefore in parallel with the browser finishing
   the document rather than after it.

   Everything that used to boot itself on DOMContentLoaded now waits on
   ZB.data.ready instead. There are exactly two of those, header.js and
   routes.js, and each waits in the same three lines.

   ZB.data.ready NEVER REJECTS
   A rejected promise here would leave the header unbuilt and the router
   unstarted — a blank page whose only symptom is a message in a console
   nobody has open. So a failure resolves like a success, and leaves the
   reason in ZB.data.error for anything that wants to say so.

   WHAT A FAILURE LEAVES BEHIND
   The menu falls back to data/navigation.js, which is still loaded and
   still holds the department structure, so the site remains navigable. The
   catalogue does not fall back to anything: pages show the "nothing found"
   state they already have. That asymmetry is deliberate. A menu is the
   shop's structure and changes rarely, so a slightly stale one is better
   than none; a product list is the shop's stock, and inventing one is how a
   customer ends up ordering something that does not exist.

   The shop's contact details follow the catalogue's rule, not the menu's.
   A stale menu is a menu; an invented email address is a mailbox a customer
   writes to and nobody reads.
   ========================================================================= */

window.ZB = window.ZB || {};

(function (ZB) {
  'use strict';

  var REQUEST = {
    headers: { Accept: 'application/json' },
    credentials: 'same-origin'
  };

  /**
   * The menu, in the shape ZB.navigation has always had.
   *
   * api/_lib/shape.js builds it from the categories table, so a category
   * the owner adds in the panel appears in the drawer without anyone
   * editing a file. Hidden categories are simply absent.
   */
  function loadNavigation() {
    return fetch('/api/categories', REQUEST).then(function (res) {
      if (!res.ok) {
        throw new Error('The menu could not be loaded (' + res.status + ').');
      }
      return res.json();
    }).then(function (payload) {
      var tree = payload && payload.ok && payload.data && payload.data.navigation;

      /* An empty tree is not an answer worth overwriting a working menu
         with. It means the shop has no active categories yet, and the
         drawer would have nothing in it either way — but keeping the
         previous value costs nothing and loses nothing. */
      if (tree && tree.length) ZB.navigation = tree;
    });
  }

  /**
   * The shop's own name and contact details.
   *
   * They used to be in data/footer.js, invented — an unroutable mailbox at
   * haveli.example and a phone number nobody answers. A customer reading a
   * footer has no way to tell an invented address from a real one, so those
   * are gone and this is where the real ones come from: the settings record,
   * which the owner fills in from the panel.
   *
   * A FAILURE HERE LEAVES NO CONTACT DETAILS, AND THAT IS RIGHT
   * The footer omits what it does not have. The alternative — falling back
   * to the values that used to be in the file — is publishing an address
   * nobody chose, which is the thing this replaced.
   */
  function loadShop() {
    return fetch('/api/shop', REQUEST).then(function (res) {
      if (!res.ok) {
        throw new Error('The shop details could not be loaded (' + res.status + ').');
      }
      return res.json();
    }).then(function (payload) {
      var shop = payload && payload.ok && payload.data && payload.data.shop;
      if (shop) ZB.shop = shop;
    });
  }

  /* What the pages read before the answer arrives, and what they keep if it
     never does. The name is the shop's real one and is a fair fallback; the
     contact details are blank because there is no honest fallback for
     those. */
  ZB.shop = ZB.shop || { name: 'HAVELI', tagline: '', email: '', phone: '',
                         address: '', city: '' };

  ZB.data = {
    /** Resolves when the shop's data is loaded, or when it is not. */
    ready: null,

    /** The first thing that went wrong, or null. */
    error: null
  };

  /**
   * The shop's written pages — FAQs, Returns, Terms, and the rest.
   *
   * Twelve short rows of text, fetched once here rather than one per
   * navigation: the router can land on any of them from any other, and a
   * visible wait on every footer link would be a wait for less text than
   * one product photograph.
   *
   * A FAILURE LEAVES THE PAGES SAYING SO
   * Each of the twelve keeps its route and its heading, which live in
   * assets/js/routes.js and in the row's own title — so a footer link never
   * leads nowhere. What is missing is the words, and the page says that
   * rather than showing an empty column.
   */
  function loadPages() {
    return fetch('/api/pages', REQUEST).then(function (res) {
      if (!res.ok) {
        throw new Error('The shop’s pages could not be loaded (' + res.status + ').');
      }
      return res.json();
    }).then(function (payload) {
      var items = payload && payload.ok && payload.data && payload.data.items;
      if (!items) return;

      var byslug = {};
      items.forEach(function (row) { byslug[row.slug] = row; });
      ZB.content = byslug;
    });
  }

  /* Empty until the answer arrives, and empty for good if it does not.
     Nothing here is invented: a page with no row shows its own heading and
     says the words have not been written. */
  ZB.content = ZB.content || {};

  ZB.data.ready = Promise.all([
    ZB.catalogue ? ZB.catalogue.load() : Promise.resolve(),
    loadNavigation(),
    loadShop(),
    loadPages(),

    /* WHO IS SIGNED IN, ON EVERY PAGE AND NOT ONLY TWO
       This used to be asked lazily, by the account page and the checkout,
       because they were the only two that drew anything different for a
       signed-in visitor. assets/js/store-sync.js needs it everywhere: a
       cart saved to an account cannot come back to a browser that never
       asked whose browser it is, and the symptom is an empty cart on the
       second device with the rows sitting on the server.

       It costs one small request per page load, in this same round rather
       than after it, and ZB.auth caches the answer — so the two pages that
       already asked are not asking twice. A failure is a signed-out
       visitor, which is how the site works anyway. */
    ZB.auth ? ZB.auth.load() : Promise.resolve()
  ]).then(function () {
    return true;
  }, function (err) {
    ZB.data.error = err;

    /* The console is the right place for this and the only place for it.
       A visitor is shown the pages' own empty states; a developer opening
       the console is shown why they are empty. */
    if (window.console && window.console.error) {
      window.console.error('HAVELI: ' + err.message);
    }

    return false;
  });

  /**
   * Run `fn` once the shop's data is in, whether or not it arrived.
   *
   * What header.js and routes.js call instead of booting themselves. Not
   * named `then`: an object with a `then` method is a thenable, and any
   * promise that ever resolved to ZB.data would try to unwrap it.
   */
  ZB.data.whenReady = function (fn) {
    ZB.data.ready.then(fn, fn);
  };

}(window.ZB));
