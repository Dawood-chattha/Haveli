/* =========================================================================
   pages/search.js — search results
   -------------------------------------------------------------------------
   Reads the term from ?q= and matches it against the catalogue in the
   browser. Facets and suggestions belong to the search phase; the matching,
   the results grid and the recent-term history are live now.
   ========================================================================= */

window.ZB = window.ZB || {};
window.ZB.pages = window.ZB.pages || {};

(function (ZB) {
  'use strict';

  function term(params) {
    return (params.query && params.query.q) || '';
  }

  ZB.pages.search = {

    title: function (params) {
      var q = term(params);
      return q ? 'Search: ' + q : 'Search';
    },

    render: function (params) {
      var ui = ZB.ui;
      var q = term(params);

      if (!q) {
        return '' +
          '<div class="route-page container">' +
            ui.breadcrumbs([{ label: 'Home', path: '/' }, { label: 'Search' }]) +
            ui.pageHead({ eyebrow: 'Search', title: 'Search' }) +
            ui.emptyState({
              title: 'Search the store',
              body: 'Open search from the header and enter a term.',
              ctaLabel: 'Back to home',
              ctaHref: '/'
            }) +
          '</div>';
      }

      var count = ZB.catalogue.search(q).length;

      return '' +
        '<div class="route-page container">' +
          ui.breadcrumbs([{ label: 'Home', path: '/' }, { label: 'Search' }]) +
          ui.pageHead({
            eyebrow: 'Search',
            title: '"' + q + '"',
            sub: count
              ? count + ' product' + (count === 1 ? '' : 's') + ' match this term.'
              : null
          }) +
          '<div id="search-facets"></div>' +
          '<div id="search-grid"></div>' +
        '</div>';
    },

    mount: function (params) {
      var q = term(params);
      if (q && ZB.store) ZB.store.addRecent(q);

      var grid = document.getElementById('search-grid');
      if (!grid || !q) return;

      var matches = ZB.catalogue.search(q);

      if (!matches.length) {
        grid.innerHTML = ZB.ui.emptyState({
          title: 'No matches for "' + q + '"',
          body: 'Try a shorter term, a category name, or a colour.',
          ctaLabel: 'Back to home',
          ctaHref: '/'
        });
        return;
      }

      /* Results are filtered and sorted by the same toolbar the category
         pages use, so a search behaves like any other listing. */
      ZB.facets.init({
        root: document.getElementById('search-facets'),
        gridRoot: grid,
        products: matches
      });
    }
  };

}(window.ZB));
