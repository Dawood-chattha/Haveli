/* =========================================================================
   pages/product.js — product detail
   -------------------------------------------------------------------------
   Gallery, colour, size picker, quantity and add-to-cart. Everything runs
   against ZB.store, which is localStorage; nothing is sent anywhere.

   A size must be chosen before the button will add, which is how the
   reference behaves — its button reads "Select a size" until one is picked.
   ========================================================================= */

window.ZB = window.ZB || {};
window.ZB.pages = window.ZB.pages || {};

(function (ZB) {
  'use strict';

  var heart = '<svg viewBox="0 0 24 24" aria-hidden="true">' +
                '<path d="M12 20s-7-4.35-7-9a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 4.65-7 9-7 9Z"/>' +
              '</svg>';

  /* Copy is written for this build; the reference's own product text is not
     reproduced. Description is filled in per product. */
  var TABS = [
    { id: 'description', label: 'Description' },
    { id: 'returns',     label: 'Returns & Exchange' },
    { id: 'care',        label: 'Care Instructions' }
  ];

  function tabContent(id, product) {
    var esc = ZB.ui.esc;

    if (id === 'returns') {
      return '<p>Unworn items can be exchanged or returned within 14 days of ' +
             'delivery, with tags attached and the original receipt. Sale items ' +
             'are exchange only.</p>';
    }

    if (id === 'care') {
      return '<ul>' +
               '<li>Machine wash cold with like colours</li>' +
               '<li>Do not bleach; wash dark shades separately for the first wash</li>' +
               '<li>Warm iron on the reverse</li>' +
               '<li>Dry in shade</li>' +
             '</ul>';
    }

    /* THE OWNER'S OWN WORDS, WHERE THERE ARE ANY
     *
     * This sentence was written when a product had no description to show:
     * the catalogue was generated, and every product in it had a colour and
     * a fabric to name. Both are optional now, and a product added through
     * the panel with neither is what turned this line into a crash — the
     * first real product ever saved took the whole page down with it.
     *
     * So the description comes first, and the fallback is assembled from
     * whatever the product actually has. */
    if (product.description) {
      return '<p>' + esc(product.description) + '</p>';
    }

    var facts = [];
    if (product.colour) facts.push('in ' + esc(product.colour));
    if (product.fabric) facts.push('cut from ' + esc(String(product.fabric).toLowerCase()));
    if (product.categoryLabel) {
      facts.push('part of the ' + esc(String(product.categoryLabel).toLowerCase()) + ' range');
    }

    return '<p>' + esc(product.title) +
           (facts.length ? ', ' + facts.join(', ') : '') +
           '. Made for everyday wear and priced to be worn often.</p>';
  }

  ZB.pages.product = {

    title: function (params) {
      var p = ZB.catalogue.byId(params.id);
      return p ? p.title : 'Product';
    },

    render: function (params) {
      var ui = ZB.ui;
      var product = ZB.catalogue.byId(params.id);

      if (!product) {
        return '' +
          '<div class="route-page container">' +
            ui.breadcrumbs([{ label: 'Home', path: '/' }, { label: 'Product' }]) +
            ui.emptyState({
              title: 'We could not find that product',
              body: 'The link may be out of date. Browse the departments from the menu instead.',
              ctaLabel: 'Back to home',
              ctaHref: '/'
            }) +
          '</div>';
      }

      /* ---- breadcrumbs ---- */

      var crumbs = [
        { label: 'Home', path: '/' },
        { label: product.deptLabel, path: ui.categoryPath(product.dept) }
      ];
      if (product.parentLabel) {
        crumbs.push({ label: product.parentLabel, path: ui.categoryPath(product.dept, product.parentLabel) });
      }
      crumbs.push({ label: product.categoryLabel, path: ui.categoryPath(product.dept, product.categoryLabel) });
      crumbs.push({ label: product.title });

      /* ---- pieces ---- */

      var thumbs = product.images.map(function (src, i) {
        return '<button class="pdp__thumb" type="button" data-pdp-thumb="' + i + '"' +
                 ' aria-current="' + (i === 0 ? 'true' : 'false') + '"' +
                 ' aria-label="View image ' + (i + 1) + '">' +
                 '<img src="' + src + '" alt="" width="800" height="1200" loading="lazy">' +
               '</button>';
      }).join('');

      var hasSizes = (product.sizes || []).length > 0;

      var sizes = (product.sizes || []).map(function (size) {
        return '<button class="pdp__size" type="button" data-pdp-size="' + ui.esc(size) + '"' +
                 ' aria-pressed="false">' + ui.esc(size) + '</button>';
      }).join('');

      var compare = product.compareAt
        ? '<span class="pdp__compare">' + ui.money(product.compareAt) + '</span>'
        : '';

      var tabButtons = TABS.map(function (t, i) {
        return '<button class="pdp__tab" type="button" role="tab" id="pdp-tab-' + t.id + '"' +
                 ' aria-controls="pdp-panel-' + t.id + '"' +
                 ' aria-selected="' + (i === 0 ? 'true' : 'false') + '"' +
                 ' tabindex="' + (i === 0 ? '0' : '-1') + '">' + t.label + '</button>';
      }).join('');

      var tabPanels = TABS.map(function (t, i) {
        return '<div class="pdp__tabpanel" role="tabpanel" id="pdp-panel-' + t.id + '"' +
                 ' aria-labelledby="pdp-tab-' + t.id + '"' + (i === 0 ? '' : ' hidden') + '>' +
                 tabContent(t.id, product) +
               '</div>';
      }).join('');

      var saved = ZB.store.inWishlist(product.id);
      var out = product.inStock === false;

      return '' +
        '<div class="route-page container">' +
          ui.breadcrumbs(crumbs) +

          '<div class="pdp">' +

            '<div class="pdp__media">' +
              '<div class="pdp__frame">' +
                '<img id="pdp-main" src="' + ZB.ui.productImage(product, 0) + '"' +
                     ' alt="' + ui.esc(product.title) + '" width="800" height="1200">' +
              '</div>' +
              '<div class="pdp__thumbs">' + thumbs + '</div>' +
            '</div>' +

            '<div class="pdp__details">' +

              '<div class="pdp__head">' +
                '<h1 class="pdp__title">' + ui.esc(product.title) + '</h1>' +
                '<p class="pdp__prices">' +
                  '<span class="pdp__price">' + ui.money(product.price) + '</span>' +
                  compare +
                '</p>' +
              '</div>' +

              '<div class="pdp__pills">' +
                '<span class="pdp__pill">' + ui.esc(product.fabric) + '</span>' +
                '<span class="pdp__pill">' + ui.esc(product.categoryLabel) + '</span>' +
                (product.badge ? '<span class="pdp__pill">' + ui.esc(product.badge) + '</span>' : '') +
              '</div>' +

              '<p class="pdp__stock' + (out ? ' is-out' : '') + '">' +
                (out ? 'Sold out' : 'In stock') +
              '</p>' +

              /* NOT EVERY PRODUCT HAS A COLOUR OR A SIZE
                 The generated catalogue gave every product both, so these
                 rows were always worth drawing. A fragrance has neither, a
                 bag has no size, and an empty "Colour:" with nothing after
                 it reads as something that failed to load. */
              (product.colour
                ? '<div class="pdp__option">' +
                    '<span class="pdp__option-label">Colour: ' +
                      '<span class="pdp__option-value">' + ui.esc(product.colour) + '</span>' +
                    '</span>' +
                    '<div class="pdp__swatches">' +
                      '<span class="pdp__swatch" style="background:' +
                            ui.esc(product.colourHex || 'transparent') + '"' +
                            ' title="' + ui.esc(product.colour) + '"></span>' +
                    '</div>' +
                  '</div>'
                : '') +

              (hasSizes
                ? '<div class="pdp__option">' +
                    '<span class="pdp__option-label">Size: ' +
                      '<span class="pdp__option-value" id="pdp-size-value">Select a size</span>' +
                    '</span>' +
                    '<div class="pdp__sizes">' + sizes + '</div>' +
                  '</div>'
                : '') +

              '<div class="pdp__buy">' +
                '<div class="pdp__qty">' +
                  '<button type="button" data-pdp-qty="-1" aria-label="Decrease quantity">−</button>' +
                  '<span class="pdp__qty-value" id="pdp-qty" aria-live="polite">1</span>' +
                  '<button type="button" data-pdp-qty="1" aria-label="Increase quantity">+</button>' +
                '</div>' +
                /* A product with no sizes has nothing to choose, so the
                   button must not wait for a choice — it stayed disabled
                   on "Select a size" forever, and the product could never
                   be bought. */
                '<button class="pdp__add" type="button" id="pdp-add"' +
                        (out || hasSizes ? ' disabled' : '') + '>' +
                  (out ? 'Sold out' : (hasSizes ? 'Select a size' : 'Add to cart')) +
                '</button>' +
                '<button class="pdp__save" type="button" data-wish="' + ui.esc(product.id) + '"' +
                        ' aria-pressed="' + (saved ? 'true' : 'false') + '">' +
                  heart + '<span>Save</span>' +
                '</button>' +
              '</div>' +

              '<p class="pdp__note" id="pdp-note" role="status"></p>' +

              '<div class="pdp__tabs">' +
                '<div class="pdp__tablist" role="tablist" aria-label="Product information">' +
                  tabButtons +
                '</div>' +
                tabPanels +
              '</div>' +

            '</div>' +
          '</div>' +

          '<section class="pdp-related">' +
            '<h2 class="pdp-related__title">You may also like</h2>' +
            '<div id="pdp-related"></div>' +
          '</section>' +

        '</div>';
    },

    mount: function (params) {
      var product = ZB.catalogue.byId(params.id);
      if (!product) return;

      var root = document.querySelector('.pdp');
      if (!root) return;

      var hasSizes = (product.sizes || []).length > 0;
      var chosenSize = null;
      var qty = 1;
      var out = product.inStock === false;

      var addBtn = document.getElementById('pdp-add');
      var note = document.getElementById('pdp-note');
      var sizeValue = document.getElementById('pdp-size-value');
      var qtyValue = document.getElementById('pdp-qty');
      var main = document.getElementById('pdp-main');

      var refreshAdd = function () {
        if (out) return;

        /* Nothing to choose means nothing to wait for. */
        var ready = !hasSizes || !!chosenSize;
        addBtn.disabled = !ready;
        addBtn.textContent = ready ? 'Add to cart' : 'Select a size';
      };

      root.addEventListener('click', function (e) {
        /* ---- gallery ---- */
        var thumb = e.target.closest('[data-pdp-thumb]');
        if (thumb) {
          var i = Number(thumb.getAttribute('data-pdp-thumb'));
          main.src = product.images[i];
          ZB.util.all('[data-pdp-thumb]', root).forEach(function (t) {
            t.setAttribute('aria-current', t === thumb ? 'true' : 'false');
          });
          return;
        }

        /* ---- size ---- */
        var size = e.target.closest('[data-pdp-size]');
        if (size) {
          chosenSize = size.getAttribute('data-pdp-size');
          ZB.util.all('[data-pdp-size]', root).forEach(function (b) {
            b.setAttribute('aria-pressed', b === size ? 'true' : 'false');
          });
          if (sizeValue) sizeValue.textContent = chosenSize;
          note.textContent = '';
          refreshAdd();
          return;
        }

        /* ---- quantity ---- */
        var step = e.target.closest('[data-pdp-qty]');
        if (step) {
          qty = Math.max(1, Math.min(10, qty + Number(step.getAttribute('data-pdp-qty'))));
          qtyValue.textContent = qty;
          return;
        }

        /* ---- add to cart ---- */
        if (e.target.closest('#pdp-add')) {
          if (out || (hasSizes && !chosenSize)) return;

          ZB.store.addToCart(product, chosenSize, qty);

          note.textContent = qty + ' × ' + product.title +
                             (chosenSize ? ' (' + chosenSize + ')' : '') +
                             ' added to your cart.';
          return;
        }

        /* ---- tabs ---- */
        var tab = e.target.closest('[role="tab"]');
        if (tab) {
          var tabs = ZB.util.all('[role="tab"]', root);
          tabs.forEach(function (t) {
            var on = t === tab;
            t.setAttribute('aria-selected', on ? 'true' : 'false');
            t.setAttribute('tabindex', on ? '0' : '-1');
            var panel = document.getElementById(t.getAttribute('aria-controls'));
            if (panel) panel.hidden = !on;
          });
        }
      });

      /* Related products use the same card as every other listing. */
      ZB.productCard.mount(
        document.getElementById('pdp-related'),
        ZB.catalogue.related(product, 4),
        { pageSize: 4 }
      );
    }
  };

}(window.ZB));
