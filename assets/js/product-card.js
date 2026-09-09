/* =========================================================================
   product-card.js — the product card and the grid that holds it
   -------------------------------------------------------------------------
   One renderer used by every listing in the site, so a card looks and
   behaves identically on a category page, in search results and on the
   wishlist.

     ZB.productCard.card(product)              -> <li> markup
     ZB.productCard.grid(products, options)    -> full grid markup
     ZB.productCard.mount(root, products, o)   -> renders and wires paging

   Card interactions are handled by two delegated listeners installed once
   on the document, so cards rendered later by the router need no wiring of
   their own. Both of them only ever touch ZB.store, which is localStorage
   and nothing else.
   ========================================================================= */

window.ZB = window.ZB || {};

(function (ZB) {
  'use strict';

  var PAGE = 12;          /* products revealed per "Load more" */
  var bound = false;

  var icons = {
    heart: '<svg viewBox="0 0 24 24" aria-hidden="true">' +
             '<path d="M12 20s-7-4.35-7-9a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 4.65-7 9-7 9Z"/>' +
           '</svg>',
    plus:  '<svg viewBox="0 0 24 24" aria-hidden="true">' +
             '<path d="M12 5v14M5 12h14"/>' +
           '</svg>'
  };

  /* -----------------------------------------------------------------------
     Markup
     ----------------------------------------------------------------------- */

  function renderBadges(product) {
    var ui = ZB.ui;
    var badges = [];

    if (product.compareAt) {
      var off = Math.round((1 - product.price / product.compareAt) * 100);
      badges.push('<span class="product-card__badge product-card__badge--sale">' +
                    off + '% off</span>');
    }

    if (product.badge) {
      badges.push('<span class="product-card__badge">' + ui.esc(product.badge) + '</span>');
    }

    /* No measured sold-out card in the reference — its catalogue had none in
       stock trouble while it was inspected — so this borrows the badge
       language already established rather than inventing a new treatment. */
    if (product.inStock === false) {
      badges.push('<span class="product-card__badge product-card__badge--out">Sold out</span>');
    }

    if (!badges.length) return '';
    return '<div class="product-card__badges">' + badges.join('') + '</div>';
  }

  function renderPrices(product) {
    var ui = ZB.ui;

    var compare = product.compareAt
      ? '<span class="product-card__compare">' + ui.money(product.compareAt) + '</span>'
      : '';

    return '' +
      '<p class="product-card__prices">' +
        '<span class="product-card__price">' + ui.money(product.price) + '</span>' +
        compare +
      '</p>';
  }

  /** One card, as a grid item. */
  function card(product) {
    var ui = ZB.ui;
    var saved = ZB.store.inWishlist(product.id);
    var label = ui.esc(product.title);
    var out = product.inStock === false;

    return '' +
      '<li class="product-card' + (out ? ' is-out-of-stock' : '') + '">' +

        '<a class="product-card__link" href="' + ui.href(product.path) + '">' +
          '<span class="visually-hidden">' + label + '</span>' +
        '</a>' +

        '<div class="product-card__media">' +
          '<div class="product-card__frame">' +
            '<img class="product-card__img" src="' + ZB.ui.productImage(product, 0) + '"' +
                 ' alt="' + label + '" width="800" height="1200"' +
                 ' loading="lazy" decoding="async">' +
            /* The hover image, falling back to the first rather than to the
               placeholder: a card that swaps a photograph for "no image
               yet" when the pointer crosses it looks broken, where showing
               the same photograph twice just looks still. */
            '<img class="product-card__img product-card__img--alt"' +
                 ' src="' + ZB.ui.productImage(product, (product.images || []).length > 1 ? 1 : 0) + '"' +
                 ' alt="" aria-hidden="true" width="800" height="1200"' +
                 ' loading="lazy" decoding="async">' +
          '</div>' +

          renderBadges(product) +

          '<button class="product-card__wish" type="button"' +
                  ' data-wish="' + ui.esc(product.id) + '"' +
                  ' aria-pressed="' + (saved ? 'true' : 'false') + '"' +
                  ' aria-label="' + (saved ? 'Remove from' : 'Save to') + ' wishlist">' +
            icons.heart +
          '</button>' +

          /* Nothing to add when there is nothing in stock. */
          (out ? '' :
          '<button class="product-card__quick" type="button"' +
                  ' data-quick-add="' + ui.esc(product.id) + '"' +
                  ' aria-label="Add ' + label + ' to cart">' +
            '<span class="product-card__quick-icon">' + icons.plus + '</span>' +
            '<span class="product-card__quick-label"><span><span>Add</span></span></span>' +
          '</button>') +
        '</div>' +

        '<div class="product-card__info">' +
          '<h3 class="product-card__title">' + label + '</h3>' +
          renderPrices(product) +
        '</div>' +

      '</li>';
  }

  function grid(products) {
    return '<ul class="product-grid product-grid--bleed">' +
             products.map(card).join('') +
           '</ul>';
  }

  /* -----------------------------------------------------------------------
     Mounting — grid plus frontend paging
     ----------------------------------------------------------------------- */

  /**
   * Render products into root, revealing PAGE at a time.
   * options.pageSize overrides the default; options.empty is the markup
   * shown when there is nothing to list.
   */
  function mount(root, products, options) {
    if (!root) return;
    options = options || {};

    var size = options.pageSize || PAGE;
    var shown = Math.min(size, products.length);

    if (!products.length) {
      root.innerHTML = options.empty || ZB.ui.emptyState({
        title: 'Nothing here yet',
        body: 'Try another category from the menu.',
        ctaLabel: 'Back to home',
        ctaHref: '/'
      });
      return;
    }

    /* Paging furniture only appears where paging actually happens; a short
       list such as a related-products row shows the grid and nothing else. */
    var paged = products.length > size;

    var paint = function () {
      var remaining = products.length - shown;

      root.innerHTML =
        grid(products.slice(0, shown)) +
        (paged
          ? '<div class="product-grid-more">' +
              '<p class="product-grid-count">Showing ' + shown + ' of ' + products.length + '</p>' +
              (remaining > 0
                ? '<button class="btn btn--secondary" type="button" data-load-more>Load more</button>'
                : '') +
            '</div>'
          : '');

      var more = root.querySelector('[data-load-more]');
      if (more) {
        more.addEventListener('click', function () {
          shown = Math.min(shown + size, products.length);
          paint();
          /* Keep the newly revealed row in view rather than jumping. */
          var button = root.querySelector('[data-load-more]');
          if (button) button.focus();
          if (ZB.refresh) ZB.refresh();
        });
      }
    };

    paint();
  }

  /* -----------------------------------------------------------------------
     Interactions — installed once, delegated
     ----------------------------------------------------------------------- */

  /** Bring every heart on the page back in step with the store. */
  function syncWishlist() {
    ZB.util.all('[data-wish]').forEach(function (button) {
      var saved = ZB.store.inWishlist(button.getAttribute('data-wish'));
      button.setAttribute('aria-pressed', saved ? 'true' : 'false');
      button.setAttribute('aria-label', (saved ? 'Remove from' : 'Save to') + ' wishlist');
    });
  }

  function bind() {
    if (bound) return;
    bound = true;

    document.addEventListener('click', function (e) {
      var wish = e.target.closest('[data-wish]');
      if (wish) {
        /* The card is one big link; a control on top of it must not follow. */
        e.preventDefault();
        e.stopPropagation();

        var saved = ZB.store.toggleWishlist(wish.getAttribute('data-wish'));
        wish.setAttribute('aria-pressed', saved ? 'true' : 'false');
        wish.setAttribute('aria-label', (saved ? 'Remove from' : 'Save to') + ' wishlist');

        if (saved) {
          wish.classList.remove('is-bumped');
          void wish.offsetWidth;          /* restart the animation */
          wish.classList.add('is-bumped');
        }
        return;
      }

      var quick = e.target.closest('[data-quick-add]');
      if (quick) {
        e.preventDefault();
        e.stopPropagation();

        var product = ZB.catalogue.byId(quick.getAttribute('data-quick-add'));
        if (!product) return;

        /* No size chosen on a card, so the first one stands in — the full
           picker belongs to the product detail page. */
        ZB.store.addToCart(product, product.sizes[0], 1);

        quick.classList.add('is-added');
        var text = quick.querySelector('.product-card__quick-label span span');
        if (text) text.textContent = 'Added';

        window.setTimeout(function () {
          quick.classList.remove('is-added');
          if (text) text.textContent = 'Add';
        }, 1400);
      }
    });

    /* A card rendered by a later route starts with the right heart state. */
    document.addEventListener('zb:navigated', syncWishlist);
    ZB.store.subscribe(syncWishlist);
  }

  ZB.productCard = {
    card: card,
    grid: grid,
    mount: mount,
    sync: syncWishlist,
    init: bind
  };

  bind();

}(window.ZB));
