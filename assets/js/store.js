/* =========================================================================
   store.js — client-side state (cart, wishlist, recent searches)
   -------------------------------------------------------------------------
   Frontend only. State lives in memory and is mirrored into localStorage so
   it survives a refresh. Nothing here talks to a server.

   Subscribe to changes:  ZB.store.subscribe(function (state) { ... })
   ========================================================================= */

window.ZB = window.ZB || {};

(function (ZB) {
  'use strict';

  var KEY = 'zb.store.v1';

  var state = {
    cart: [],       /* { id, title, price, size, qty, image, href } */
    wishlist: [],   /* product ids */
    recent: []      /* recent search terms */
  };

  var listeners = [];

  /* localStorage can throw in private modes; state must survive that. */
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return;
      var saved = JSON.parse(raw);
      if (saved && typeof saved === 'object') {
        state.cart = Array.isArray(saved.cart) ? saved.cart : [];
        state.wishlist = Array.isArray(saved.wishlist) ? saved.wishlist : [];
        state.recent = Array.isArray(saved.recent) ? saved.recent : [];
      }
    } catch (e) { /* start empty */ }
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) { /* nothing to do; state stays in memory */ }
  }

  function emit() {
    save();
    listeners.forEach(function (fn) { fn(state); });
  }

  var Store = {
    get state() { return state; },

    subscribe: function (fn) {
      listeners.push(fn);
      fn(state);
      return function () {
        listeners = listeners.filter(function (l) { return l !== fn; });
      };
    },

    /* ---- cart ---- */

    cartCount: function () {
      return state.cart.reduce(function (n, l) { return n + l.qty; }, 0);
    },

    cartTotal: function () {
      return state.cart.reduce(function (n, l) { return n + l.price * l.qty; }, 0);
    },

    /** Same product in the same size stacks rather than adding a second line. */
    addToCart: function (product, size, qty) {
      qty = qty || 1;
      size = size || null;

      var line = state.cart.filter(function (l) {
        return l.id === product.id && l.size === size;
      })[0];

      if (line) {
        line.qty += qty;
      } else {
        state.cart.push({
          id: product.id,
          title: product.title,
          price: product.price,
          /* Catalogue products carry images[] and path; accept either shape
             so a line is self-contained once it is in the cart. */
          image: product.image || (product.images && product.images[0]) || null,
          href: product.href || product.path || null,
          size: size,
          qty: qty
        });
      }
      emit();
    },

    setQty: function (id, size, qty) {
      if (qty <= 0) return Store.removeFromCart(id, size);
      state.cart.forEach(function (l) {
        if (l.id === id && l.size === size) l.qty = qty;
      });
      emit();
    },

    removeFromCart: function (id, size) {
      state.cart = state.cart.filter(function (l) {
        return !(l.id === id && l.size === size);
      });
      emit();
    },

    clearCart: function () {
      state.cart = [];
      emit();
    },

    /**
     * Put a whole cart and wishlist in place at once.
     *
     * For assets/js/store-sync.js, which has one job this cannot be done
     * with the methods above: at sign-in it holds a list merged from this
     * browser and the customer's account, and has to install it as it is.
     * Replaying it through addToCart would stack every quantity on top of
     * the one already there, and would notify — and therefore save — once
     * per line.
     *
     * Either list may be left out, in which case it is not touched. One
     * notification for the pair, because they changed together.
     */
    replace: function (next) {
      next = next || {};

      if (Array.isArray(next.cart)) state.cart = next.cart;
      if (Array.isArray(next.wishlist)) state.wishlist = next.wishlist;

      emit();
    },

    /* ---- wishlist ---- */

    inWishlist: function (id) {
      return state.wishlist.indexOf(id) !== -1;
    },

    toggleWishlist: function (id) {
      var i = state.wishlist.indexOf(id);
      if (i === -1) state.wishlist.push(id);
      else state.wishlist.splice(i, 1);
      emit();
      return Store.inWishlist(id);
    },

    /* ---- searches ---- */

    addRecent: function (term) {
      term = String(term || '').trim();
      if (!term) return;
      state.recent = [term].concat(state.recent.filter(function (t) {
        return t.toLowerCase() !== term.toLowerCase();
      })).slice(0, 6);
      emit();
    }
  };

  load();
  ZB.store = Store;

}(window.ZB));
