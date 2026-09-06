/* =========================================================================
   rails.js — the homepage department rails
   -------------------------------------------------------------------------
   Renders ZB.rails into a container and wires the tab switching. Tabs use
   the standard tablist pattern: click or arrow key selects, and selection
   shows the matching panel. Everything is client side; the tiles are plain
   links into the category routes.

   The data lives at ZB.rails, this component at ZB.railSections, and
   pages/home.js mounts it.
   ========================================================================= */

window.ZB = window.ZB || {};

(function (ZB) {
  'use strict';

  var Rails = {

    /* ---------------------------------------------------------------------
       Markup
       --------------------------------------------------------------------- */

    /** The department a tab belongs to: its own, or the rail's. */
    deptOf: function (rail, tab) {
      return tab.dept || rail.dept;
    },

    tile: function (rail, tab, tile) {
      var ui = ZB.ui;
      var label = ui.esc(tile.label);
      var path = ui.categoryPath(this.deptOf(rail, tab), tile.label);

      return '' +
        '<div class="rail-tile">' +
          '<div class="rail-tile__media">' +
            '<img src="' + tile.image + '" alt="' + label + '"' +
                 ' width="600" height="1000" loading="lazy" decoding="async">' +
            (tile.badge
              ? '<span class="rail-tile__badge">' + ui.esc(tile.badge) + '</span>'
              : '') +
          '</div>' +
          '<div class="rail-tile__info">' +
            '<p class="rail-tile__name">' + label + '</p>' +
          '</div>' +
          '<a class="rail-tile__link" href="' + ui.href(path) + '">' +
            '<span class="visually-hidden">' + label + '</span>' +
          '</a>' +
        '</div>';
    },

    explore: function (rail, tab) {
      var ui = ZB.ui;
      var path = ui.categoryPath(this.deptOf(rail, tab), tab.category);
      var count = tab.explore.count;

      return '' +
        '<a class="rail-explore" href="' + ui.href(path) + '">' +
          '<img class="rail-explore__bg" src="' + rail.exploreImage + '" alt=""' +
               ' width="600" height="1000" loading="lazy" decoding="async" aria-hidden="true">' +
          '<span class="rail-explore__overlay" aria-hidden="true"></span>' +
          '<span class="rail-explore__content">' +
            '<span class="rail-explore__text">Discover ' + count + ' More ↗</span>' +
            '<span class="rail-explore__btn">Explore</span>' +
          '</span>' +
          '<span class="visually-hidden">' + ui.esc(tab.label) + '</span>' +
        '</a>';
    },

    section: function (rail) {
      var ui = ZB.ui;
      var self = this;

      var tabs = rail.tabs.map(function (tab, i) {
        var id = 'rail-' + rail.id + '-tab-' + i;
        return '<button class="rail-tab" type="button" role="tab"' +
                 ' id="' + id + '"' +
                 ' aria-controls="rail-' + rail.id + '-panel-' + i + '"' +
                 ' aria-selected="' + (i === 0 ? 'true' : 'false') + '"' +
                 ' tabindex="' + (i === 0 ? '0' : '-1') + '">' +
                 ui.esc(tab.label) +
               '</button>';
      }).join('');

      var panels = rail.tabs.map(function (tab, i) {
        var tiles = tab.tiles.map(function (t) {
          return self.tile(rail, tab, t);
        }).join('');

        return '<div class="rail-panel' + (i === 0 ? ' is-active' : '') + '"' +
                 ' id="rail-' + rail.id + '-panel-' + i + '"' +
                 ' role="tabpanel" tabindex="0"' +
                 ' aria-labelledby="rail-' + rail.id + '-tab-' + i + '"' +
                 (i === 0 ? '' : ' hidden') + '>' +
                 tiles +
                 self.explore(rail, tab) +
               '</div>';
      }).join('');

      return '' +
        '<section class="rail-section" data-rail="' + ui.esc(rail.id) + '"' +
                 ' aria-labelledby="rail-' + rail.id + '-title">' +

          '<div class="rail-section__bg" aria-hidden="true"' +
               ' style="background-image:url(' + rail.background + ')"></div>' +
          '<div class="rail-section__veil" aria-hidden="true"></div>' +
          '<div class="rail-section__glow" aria-hidden="true"></div>' +

          '<div class="rail-section__inner">' +
            '<header class="rail-head">' +
              '<h2 class="rail-head__title" id="rail-' + rail.id + '-title">' +
                ui.esc(rail.title) +
              '</h2>' +
              '<p class="rail-head__sub">' + ui.esc(rail.subtitle) + '</p>' +
            '</header>' +

            '<div class="rail-tabs">' +
              '<div class="rail-tabs__list" role="tablist"' +
                   ' aria-label="' + ui.esc(rail.title) + ' categories">' +
                tabs +
              '</div>' +
            '</div>' +

            panels +
          '</div>' +

        '</section>';
    },

    render: function () {
      var self = this;
      return (ZB.rails || []).map(function (rail) {
        return self.section(rail);
      }).join('');
    },

    /* ---------------------------------------------------------------------
       Behaviour
       --------------------------------------------------------------------- */

    /** Show one tab's panel and hide the rest within the same rail. */
    select: function (section, index) {
      var tabs = ZB.util.all('[role="tab"]', section);
      var panels = ZB.util.all('.rail-panel', section);

      tabs.forEach(function (tab, i) {
        var on = i === index;
        tab.setAttribute('aria-selected', on ? 'true' : 'false');
        tab.setAttribute('tabindex', on ? '0' : '-1');
      });

      panels.forEach(function (panel, i) {
        var on = i === index;
        panel.classList.toggle('is-active', on);
        panel.hidden = !on;
      });

      /* A tab scrolled out of the strip on a narrow screen is brought back
         into view, which is why the list has scroll-behavior: smooth. */
      var active = tabs[index];
      if (active && active.scrollIntoView) {
        active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    },

    bindSection: function (section) {
      var self = this;
      var tabs = ZB.util.all('[role="tab"]', section);

      section.addEventListener('click', function (e) {
        var tab = e.target.closest('[role="tab"]');
        if (!tab || !section.contains(tab)) return;
        self.select(section, tabs.indexOf(tab));
      });

      section.addEventListener('keydown', function (e) {
        var tab = e.target.closest('[role="tab"]');
        if (!tab) return;

        var i = tabs.indexOf(tab);
        var next = null;

        if (e.key === 'ArrowRight') next = (i + 1) % tabs.length;
        else if (e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length;
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = tabs.length - 1;
        else return;

        e.preventDefault();
        self.select(section, next);
        tabs[next].focus();
      });
    },

    /** Render into root and wire every rail it produced. */
    init: function (root) {
      if (!root) return;
      var self = this;

      root.innerHTML = this.render();

      ZB.util.all('.rail-section', root).forEach(function (section) {
        self.bindSection(section);
      });
    }
  };

  ZB.railSections = Rails;

}(window.ZB));
