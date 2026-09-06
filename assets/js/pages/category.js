/* =========================================================================
   pages/category.js — department and category listing
   -------------------------------------------------------------------------
   Handles both /category/:dept and /category/:dept/:sub. The grid is real:
   products come from ZB.catalogue and are rendered by ZB.productCard, with
   frontend paging. Filters and sort controls arrive with the listing phase.
   ========================================================================= */

window.ZB = window.ZB || {};
window.ZB.pages = window.ZB.pages || {};

(function (ZB) {
  'use strict';

  function resolve(params) {
    var ui = ZB.ui;
    var dept = ui.findDept(ui.slug(params.dept || ''));
    var category = params.sub ? ui.findCategory(dept, ui.slug(params.sub)) : null;
    return { dept: dept, category: category };
  }

  ZB.pages.category = {

    title: function (params) {
      var r = resolve(params);
      if (r.category) return r.category.label;
      return r.dept ? r.dept.label : 'Category';
    },

    render: function (params) {
      var ui = ZB.ui;
      var r = resolve(params);

      // An unknown slug is still a real page, just an empty one.
      if (!r.dept) {
        return '<div class="route-page container">' +
                 ui.breadcrumbs([{ label: 'Home', path: '/' }, { label: 'Category' }]) +
                 ui.emptyState({
                   title: 'That category does not exist',
                   body: 'The link may be out of date. Browse the departments from the menu instead.',
                   ctaLabel: 'Back to home',
                   ctaHref: '/'
                 }) +
               '</div>';
      }

      var crumbs = [
        { label: 'Home', path: '/' },
        { label: r.dept.label, path: ui.categoryPath(r.dept.id) }
      ];

      if (r.category) {
        // A nested category shows its parent in the trail.
        if (r.category.parent) {
          crumbs.push({
            label: r.category.parent,
            path: ui.categoryPath(r.dept.id, r.category.parent)
          });
        }
        crumbs.push({ label: r.category.label });
      }

      var title = r.category ? r.category.label : r.dept.label;
      var sub = r.category
        ? null
        : 'Everything in ' + r.dept.label.toLowerCase() + ', in one place.';

      return '' +
        '<div class="route-page container">' +
          ui.breadcrumbs(crumbs) +
          ui.pageHead({ eyebrow: r.dept.label, title: title, sub: sub }) +
          this.renderSubNav(r.dept, r.category) +
          '<div id="category-facets"></div>' +
          '<div id="category-grid"></div>' +
        '</div>';
    },

    mount: function (params) {
      var grid = document.getElementById('category-grid');
      if (!grid) return;

      var r = resolve(params);
      if (!r.dept) return;

      var products = r.category
        ? ZB.catalogue.byCategory(r.dept.id, ZB.ui.slug(r.category.label))
        : ZB.catalogue.byDept(r.dept.id);

      /* The toolbar owns the grid from here: it filters, sorts and paints. */
      ZB.facets.init({
        root: document.getElementById('category-facets'),
        gridRoot: grid,
        products: products
      });
    },

    /** Sibling categories, so a department page is browsable straight away. */
    renderSubNav: function (dept, current) {
      var ui = ZB.ui;
      var currentLabel = current ? current.label : null;

      var currentParent = current ? current.parent : null;

      var chips = dept.items.map(function (item) {
        /* Viewing a nested category keeps its container chip lit, so you can
           always see which branch of the department you are in. */
        var here = item.label === currentLabel || item.label === currentParent;

        return '<a class="chip' + (here ? ' is-active' : '') + '"' +
                 ' data-manual-active' +
                 (item.label === currentLabel ? ' aria-current="page"' : '') +
                 ' href="' + ui.href(ui.categoryPath(dept.id, item.label)) + '">' +
                 ui.esc(item.label) +
               '</a>';
      }).join('');

      return '<div class="chip-row reveal">' + chips + '</div>';
    }
  };

}(window.ZB));
