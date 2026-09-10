/* =========================================================================
   store-sync.js — the cart and wishlist follow the customer, not the browser
   -------------------------------------------------------------------------
   assets/js/store.js is the cart: an array in memory, mirrored into
   localStorage, knowing nothing about a server. That file stays exactly
   what it says it is. This one sits beside it and carries the same list to
   the account, so a cart filled on a phone is there on a laptop.

   WHAT HAPPENS AT SIGN-IN: MERGE, NOT REPLACE
   Somebody can arrive signed in with something already in this browser's
   cart, and with something else saved against their account. Both are
   theirs and both were deliberate, so both are kept — and where the same
   product in the same size is in each, the LARGER quantity wins.

   Replacing one with the other was the alternative and it is worse in both
   directions: taking the server's list throws away what they just put in,
   and taking the browser's throws away what they saved last week. Neither
   is a thing to do without asking, and asking at sign-in is a dialogue
   nobody wants.

   The larger quantity rather than the sum, because two devices showing "2"
   usually means one shopper who wants two, not four.

   WHAT HAPPENS AT SIGN-OUT: THIS BROWSER FORGETS
   The cart and the wishlist are cleared locally. They are not lost — they
   are on the account, and signing back in brings them straight back. This
   is for the shared machine: without it, the next person to sign in on a
   family laptop would find somebody else's shopping merged into their own
   account by the rule above.

   Recent searches are left alone. They are not shopping and never leave
   this browser.

   NOTHING HERE DECIDES A PRICE
   The server stores a product, a size and a quantity, and returns today's
   price for display. What an order costs is decided by public.place_order
   at the moment of ordering. A cart is a list of intentions.
   ========================================================================= */

window.ZB = window.ZB || {};

(function (ZB) {
  'use strict';

  /* Pushing is debounced: a quantity stepper held down is one save, not
     eight. Long enough to collect a burst, short enough that closing the
     tab straight after a change almost always catches it. */
  var PUSH_AFTER = 600;

  var timer = null;
  var applying = false;
  var signedIn = false;

  function request(method, path, body) {
    return fetch(path, {
      method: method,
      headers: Object.assign({ Accept: 'application/json' },
                             body ? { 'Content-Type': 'application/json' } : {}),
      credentials: 'same-origin',
      body: body ? JSON.stringify(body) : undefined
    }).then(function (res) {
      if (!res.ok) throw new Error('The shop did not answer (' + res.status + ').');
      return res.json();
    }).then(function (payload) {
      if (!payload.ok) throw new Error((payload.error && payload.error.message) || 'Failed.');
      return payload.data;
    });
  }

  /**
   * The uuid the database knows a product by, from the slug the cart holds.
   *
   * The catalogue carries both — see the note on productId in
   * api/_lib/shape.js — so this is a lookup rather than a request. A line
   * whose product is no longer in the catalogue has no uuid and is left
   * behind, which is the same thing the cart page already does with it.
   */
  function uuidOf(slug) {
    var product = ZB.catalogue && ZB.catalogue.byId ? ZB.catalogue.byId(slug) : null;
    return (product && product.productId) || null;
  }

  /** The local cart, in the shape the endpoint takes. */
  function cartToSend() {
    return ZB.store.state.cart.map(function (line) {
      return { productId: uuidOf(line.id), size: line.size || null, qty: line.qty };
    }).filter(function (line) { return line.productId; });
  }

  function wishlistToSend() {
    return ZB.store.state.wishlist.map(uuidOf).filter(function (id) { return id; });
  }

  /* -----------------------------------------------------------------------
     Merging
     ----------------------------------------------------------------------- */

  function keyOf(line) { return line.id + '|' + (line.size || ''); }

  /**
   * Two carts into one.
   *
   * `mine` first so this browser's order is kept and anything only on the
   * server is appended — a list that reorders itself at sign-in looks like
   * a list that lost something.
   */
  function mergeCarts(mine, theirs) {
    var out = mine.map(function (line) {
      var copy = {};
      Object.keys(line).forEach(function (k) { copy[k] = line[k]; });
      return copy;
    });

    var at = {};
    out.forEach(function (line, i) { at[keyOf(line)] = i; });

    theirs.forEach(function (line) {
      var key = keyOf(line);

      if (at[key] === undefined) {
        at[key] = out.length;
        out.push(line);
        return;
      }

      /* The larger, not the sum. See the note at the top. */
      out[at[key]].qty = Math.max(out[at[key]].qty, line.qty);
    });

    return out;
  }

  function mergeWishlists(mine, theirs) {
    var out = mine.slice();

    theirs.forEach(function (id) {
      if (out.indexOf(id) === -1) out.push(id);
    });

    return out;
  }

  /* -----------------------------------------------------------------------
     Pushing
     ----------------------------------------------------------------------- */

  function push() {
    if (!signedIn || applying) return;

    /* A failure is not shown. The cart in front of the customer is correct
       and still works — this is the copy for next time, and nagging
       somebody about it while they shop helps nobody. The next change
       pushes the whole list again, so one lost save repairs itself. */
    request('PUT', '/api/account/cart', { items: cartToSend() })
      .catch(function () {});

    request('PUT', '/api/account/wishlist', { items: wishlistToSend() })
      .catch(function () {});
  }

  function schedulePush() {
    if (!signedIn || applying) return;

    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(function () {
      timer = null;
      push();
    }, PUSH_AFTER);
  }

  /* A change made in the last moments of a page is worth one more attempt.
     keepalive lets the request outlive the document, which a normal fetch
     does not. */
  function pushNow() {
    if (!signedIn || !timer) return;

    window.clearTimeout(timer);
    timer = null;

    try {
      fetch('/api/account/cart', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        keepalive: true,
        body: JSON.stringify({ items: cartToSend() })
      }).catch(function () {});
    } catch (e) { /* nothing useful to do while the page is going away */ }
  }

  /* -----------------------------------------------------------------------
     Signing in and out
     ----------------------------------------------------------------------- */

  function adopt(user) {
    if (!user) {
      /* Signed out. See the note at the top: this browser forgets, because
         the account remembers, and the next person to sign in here should
         not inherit somebody else's basket. */
      if (signedIn) {
        applying = true;
        ZB.store.replace({ cart: [], wishlist: [] });
        applying = false;
      }

      signedIn = false;
      return;
    }

    if (signedIn) return;
    signedIn = true;

    Promise.all([
      request('GET', '/api/account/cart').catch(function () { return null; }),
      request('GET', '/api/account/wishlist').catch(function () { return null; })
    ]).then(function (answers) {
      var serverCart = (answers[0] && answers[0].items) || [];
      var serverWish = (answers[1] && answers[1].items) || [];

      var mergedCart = mergeCarts(ZB.store.state.cart, serverCart);
      var mergedWish = mergeWishlists(ZB.store.state.wishlist, serverWish);

      /* Installed as one change rather than replayed line by line, which
         would stack every quantity on top of the one already there. The
         flag holds off the subscriber while it happens, so this is one
         push at the end instead of one per line. */
      applying = true;
      ZB.store.replace({ cart: mergedCart, wishlist: mergedWish });
      applying = false;

      /* Both sides now hold the merged list. */
      push();
    });
  }

  /* -----------------------------------------------------------------------
     Wiring
     ----------------------------------------------------------------------- */

  function start() {
    if (!ZB.store || !ZB.auth) return;

    ZB.auth.subscribe(adopt);
    ZB.store.subscribe(schedulePush);

    window.addEventListener('pagehide', pushNow);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') pushNow();
    });
  }

  /* After the catalogue, because a slug cannot become a uuid without it and
     a push before it has loaded would send an empty cart over a full one. */
  if (ZB.data && ZB.data.whenReady) ZB.data.whenReady(start);
  else start();

}(window.ZB));
