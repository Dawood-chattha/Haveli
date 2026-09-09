/* =========================================================================
   ui.js — shared render helpers used by the page modules
   -------------------------------------------------------------------------
   Small pure functions that return HTML strings, plus lookups that turn a
   route slug back into the label it came from.
   ========================================================================= */

window.ZB = window.ZB || {};

(function (ZB) {
  'use strict';

  /** 'Wash & Wear' -> 'wash-and-wear' */
  function slug(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  /** Escape anything that came from user input before it reaches innerHTML. */
  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * A product's nth image, or the placeholder.
   *
   * Every product in the generated catalogue had two photographs, so the
   * cards and the gallery read product.images[0] straight. A product the
   * owner adds starts with none, and that wrote src="undefined" into the
   * page — a broken-image icon in the middle of the shop. One helper, so
   * the answer is the same everywhere it is asked.
   */
  function productImage(product, index) {
    var list = (product && product.images) || [];
    return list[index || 0] || 'assets/img/placeholder.svg';
  }

  var UI = {
    slug: slug,
    esc: esc,
    productImage: productImage,

    /** Route-aware href, so links work in both history and hash mode. */
    href: function (path) {
      return ZB.router ? ZB.router.href(path) : path;
    },

    categoryPath: function (deptId, label) {
      return '/category/' + slug(deptId) + (label ? '/' + slug(label) : '');
    },

    /* ---- lookups against the navigation tree ---- */

    findDept: function (deptSlug) {
      if (!ZB.navigation) return null;
      return ZB.navigation.filter(function (d) {
        return slug(d.id) === deptSlug || slug(d.label) === deptSlug;
      })[0] || null;
    },

    /** Find a category label anywhere in a department, top level or nested. */
    findCategory: function (dept, subSlug) {
      if (!dept) return null;
      var found = null;

      dept.items.some(function (item) {
        if (slug(item.label) === subSlug) { found = { label: item.label, parent: null }; return true; }
        return (item.children || []).some(function (child) {
          if (slug(child.label) === subSlug) { found = { label: child.label, parent: item.label }; return true; }
          return false;
        });
      });

      return found;
    },

    /* ---- markup ---- */

    /**
     * Breadcrumb trail. Pass [{label, path}], last item rendered as plain
     * text because it is the page you are already on.
     */
    breadcrumbs: function (items) {
      var last = items.length - 1;

      var trail = items.map(function (item, i) {
        var label = esc(item.label);
        if (i === last || !item.path) {
          return '<li class="crumbs__item"><span aria-current="page">' + label + '</span></li>';
        }
        return '<li class="crumbs__item">' +
                 '<a href="' + UI.href(item.path) + '">' + label + '</a>' +
                 '<span class="crumbs__sep" aria-hidden="true">/</span>' +
               '</li>';
      }).join('');

      return '<nav class="crumbs" aria-label="Breadcrumb"><ol class="crumbs__list">' + trail + '</ol></nav>';
    },

    pageHead: function (o) {
      return '' +
        '<header class="page-head">' +
          (o.eyebrow ? '<p class="eyebrow reveal">' + esc(o.eyebrow) + '</p>' : '') +
          '<h1 class="page-head__title reveal" style="--d:.06s">' + esc(o.title) + '</h1>' +
          (o.sub ? '<p class="page-head__sub reveal" style="--d:.12s">' + esc(o.sub) + '</p>' : '') +
        '</header>';
    },

    emptyState: function (o) {
      return '' +
        '<div class="empty-state">' +
          '<h2 class="empty-state__title">' + esc(o.title) + '</h2>' +
          (o.body ? '<p class="empty-state__body">' + esc(o.body) + '</p>' : '') +
          (o.ctaLabel
            ? '<a class="btn btn--primary" href="' + UI.href(o.ctaHref || '/') + '">' + esc(o.ctaLabel) + '</a>'
            : '') +
        '</div>';
    },

    /** Marker for sections whose content arrives in a later phase. */
    pending: function (what) {
      return '<p class="page-pending">' + esc(what) + '</p>';
    },

    money: function (n) {
      return 'PKR ' + Number(n || 0).toLocaleString('en-PK');
    }
  };

  ZB.ui = UI;

}(window.ZB));
