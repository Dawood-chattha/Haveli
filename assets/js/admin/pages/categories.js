/* =========================================================================
   pages/categories.js — how the catalogue is organised
   -------------------------------------------------------------------------
   The category tree behind the storefront menu: every category and
   sub-category, how many products sit in each, and whether it is visible.

   WHY THE PRODUCT COUNT IS THE POINT OF THIS SCREEN
   A category list on its own is a list of words. The count is what makes it
   worth opening — it is how an owner spots the category with four products
   in it that the menu is promising a section for. So the count is not a
   quiet meta line: it is a column, it is right-aligned with the other
   numbers, it is a link to those products, and a zero is drawn as a warning
   rather than as a number.

   WHY ADD AND EDIT ARE A DIALOG, NOT A ROUTE
   A category is a name, a place in the tree and a visibility. A whole page
   for three fields would take the list away — and the list is the context:
   the reason to rename something is usually the row above or below it. The
   dialog keeps it on screen and returns the reader to the row they were on.
   Products earn a route because a product is thirty fields and a set of
   images; a category does not.

   Applied from the UI guidance consulted for this panel:
     - Deleting asks first, in a dialog that names the category AND says how
       many sub-categories go with it, and the confirmation offers undo (#35).
     - An empty result is never a blank panel (#79, #90).
     - Refreshing holds the previous rows rather than collapsing the table,
       so nothing below jumps (#19, #78).
     - Every write says so afterwards (#83).
     - Filter chips wrap; they are never clipped into one row (#115).
   ========================================================================= */

window.ZB = window.ZB || {};
window.ZB.adminPages = window.ZB.adminPages || {};

(function (ZB) {
  'use strict';

  var ui = ZB.adminUI;
  var PER_PAGE = 15;

  var state = { q: '', dept: '', level: '', status: '', sort: 'tree', page: 1 };
  var facets = null;
  var lastResult = null;

  /* The row to flash once, after it is next drawn. A category is added
     into menu order rather than at the top of the list, which is correct
     and also makes it easy to miss — so it announces itself. */
  var highlightId = null;

  /* -----------------------------------------------------------------------
     URL state — the same contract the product list uses: replaceState, so
     refreshing keeps the view and a filtered list is a shareable link,
     without burying the way out of the section under history entries.
     ----------------------------------------------------------------------- */

  function readState(params) {
    var query = (params && params.query) || {};
    state = {
      q: query.q || '',
      dept: query.dept || '',
      level: query.level || '',
      status: query.status || '',
      sort: query.sort || 'tree',
      page: Math.max(1, parseInt(query.page, 10) || 1)
    };
  }

  function writeState() {
    var parts = [];
    if (state.q) parts.push('q=' + encodeURIComponent(state.q));
    if (state.dept) parts.push('dept=' + encodeURIComponent(state.dept));
    if (state.level) parts.push('level=' + encodeURIComponent(state.level));
    if (state.status) parts.push('status=' + encodeURIComponent(state.status));
    if (state.sort && state.sort !== 'tree') parts.push('sort=' + state.sort);
    if (state.page > 1) parts.push('page=' + state.page);

    var url = '/admin/categories' + (parts.length ? '?' + parts.join('&') : '');
    if (window.history.replaceState) window.history.replaceState({}, '', url);
  }

  function hasFilters() {
    return !!(state.q || state.dept || state.level || state.status);
  }

  /* -----------------------------------------------------------------------
     Page
     ----------------------------------------------------------------------- */

  ZB.adminPages.categories = {

    title: 'Categories',
    crumbs: [{ label: 'Categories' }],

    render: function () {
      return '' +
        ui.pageHead({
          title: 'Categories',
          sub: 'How the catalogue is organised.',
          actions:
            '<button class="a-btn a-btn--primary" type="button" data-cat-add>' +
              ui.icon('layers') + 'Add category' +
            '</button>'
        }) +

        '<div class="a-metrics" id="a-cat-metrics" aria-busy="true">' +
          metricTile('total', 'Categories') +
          metricTile('top', 'Top level') +
          metricTile('hidden', 'Hidden') +
          metricTile('empty', 'With no products') +
        '</div>' +

        '<div class="a-card">' +

          '<div class="a-toolbar">' +
            '<div class="a-search">' +
              '<label class="visually-hidden" for="a-cat-search">Search categories</label>' +
              '<span class="a-search__icon" aria-hidden="true">' + ui.icon('search') + '</span>' +
              '<input class="a-search__input" id="a-cat-search" type="search"' +
                    ' placeholder="Search by name, parent or department" autocomplete="off">' +
            '</div>' +

            '<div class="a-toolbar__selects" id="a-cat-selects"></div>' +
          '</div>' +

          '<div class="a-chips" id="a-cat-chips" hidden></div>' +

          '<div class="a-resultbar">' +
            '<p class="a-resultbar__count" id="a-cat-count" role="status"></p>' +
            '<p class="a-resultbar__note" id="a-cat-note" hidden></p>' +
          '</div>' +

          '<div class="a-card__body a-card__body--flush" id="a-cat-body" aria-busy="true">' +
            '<div class="a-skeleton" aria-hidden="true">' +
              new Array(8).join('|').split('|').map(function () {
                return '<div class="a-skeleton__row"></div>';
              }).join('') +
            '</div>' +
          '</div>' +

          '<div class="a-pager" id="a-cat-pager" hidden></div>' +

        '</div>';
    },

    mount: function (params) {
      var body = document.getElementById('a-cat-body');
      if (!body) return;

      readState(params);
      lastResult = null;

      var search = document.getElementById('a-cat-search');
      search.value = state.q;

      search.addEventListener('input', ZB.util.debounce(function () {
        state.q = search.value.trim();
        state.page = 1;
        writeState();
        load();
      }, 250));

      document.addEventListener('click', onClick);
      document.addEventListener('change', onChange);

      loadFacets();
      load();
      loadMetrics();

      /* The listeners outlive this page unless they retire themselves. The
         router fires zb:navigated at the end of the render that mounted
         this page, so unsubscribing on that event would cancel immediately;
         checking that the markup is still in the document is what works. */
      function gone() {
        if (document.body.contains(body)) return false;
        document.removeEventListener('click', onClick);
        document.removeEventListener('change', onChange);
        return true;
      }

      function onChange(e) {
        if (gone()) return;
        var select = e.target.closest('[data-filter]');
        if (!select) return;

        state[select.getAttribute('data-filter')] = select.value;
        state.page = 1;
        writeState();
        load();
      }

      function onClick(e) {
        if (gone()) return;

        if (e.target.closest('[data-cat-add]')) { openAdd(); return; }

        var edit = e.target.closest('[data-cat-edit]');
        if (edit) { openEdit(edit.getAttribute('data-cat-edit')); return; }

        var del = e.target.closest('[data-cat-delete]');
        if (del) { confirmDelete(del.getAttribute('data-cat-delete')); return; }

        var chip = e.target.closest('[data-chip-clear]');
        if (chip) {
          state[chip.getAttribute('data-chip-clear')] = '';
          if (chip.getAttribute('data-chip-clear') === 'q') search.value = '';
          state.page = 1;
          writeState();
          load();
          return;
        }

        if (e.target.closest('[data-clear-all]')) {
          state.q = ''; state.dept = ''; state.level = ''; state.status = '';
          state.page = 1;
          search.value = '';
          writeState();
          load();
          return;
        }

        var pageButton = e.target.closest('[data-page]');
        if (pageButton) {
          state.page = Number(pageButton.getAttribute('data-page'));
          writeState();
          load();
          window.scrollTo({ top: 0, behavior: ZB.reduceMotion ? 'auto' : 'smooth' });
        }
      }
    }
  };

  /* -----------------------------------------------------------------------
     Loading
     ----------------------------------------------------------------------- */

  function loadFacets() {
    var body = document.getElementById('a-cat-body');

    return ZB.repo.categories.facets().then(function (result) {
      if (!document.body.contains(body)) return null;
      facets = result;
      paintSelects();
      paintChips();
      return result;
    });
  }

  function load() {
    var body = document.getElementById('a-cat-body');
    if (!body) return;

    body.setAttribute('aria-busy', 'true');
    if (lastResult) body.classList.add('is-refreshing');

    ZB.repo.categories.list({
      search: state.q,
      dept: state.dept,
      level: state.level,
      status: state.status,
      sort: state.sort,
      page: state.page,
      perPage: PER_PAGE
    }).then(function (result) {
      if (!document.body.contains(body)) return;

      lastResult = result;
      paintChips();
      paintCount(result);
      paintTable(result);
      paintPager(result);

      body.classList.remove('is-refreshing');
      body.setAttribute('aria-busy', 'false');
    });
  }

  function loadMetrics() {
    var host = document.getElementById('a-cat-metrics');
    if (!host) return;

    ZB.repo.categories.summary().then(function (sum) {
      if (!document.body.contains(host)) return;

      setMetric('total', sum.total);
      setMetric('top', sum.topLevel);
      setMetric('hidden', sum.hidden);
      setMetric('empty', sum.empty);
      host.setAttribute('aria-busy', 'false');
    });
  }

  /* -----------------------------------------------------------------------
     Painting
     ----------------------------------------------------------------------- */

  function metricTile(key, label) {
    return '' +
      '<div class="a-stat a-metric">' +
        '<p class="a-stat__label">' + ui.esc(label) + '</p>' +
        '<p class="a-stat__value" id="a-cat-m-' + key + '">—</p>' +
      '</div>';
  }

  function setMetric(key, value) {
    var el = document.getElementById('a-cat-m-' + key);
    if (el) el.textContent = String(value);
  }

  function select(o) {
    var options = [{ id: '', label: o.anyLabel }].concat(o.options).map(function (item) {
      return '<option value="' + ui.esc(item.id) + '"' +
             (String(item.id) === String(o.value) ? ' selected' : '') + '>' +
             ui.esc(item.label) + '</option>';
    }).join('');

    return '' +
      '<span class="a-select">' +
        '<label class="visually-hidden" for="' + o.id + '">' + ui.esc(o.label) + '</label>' +
        '<select class="a-select__input" id="' + o.id + '" data-filter="' + o.name + '">' +
          options +
        '</select>' +
        '<span class="a-select__arrow" aria-hidden="true">' + ui.icon('chevron') + '</span>' +
      '</span>';
  }

  function paintSelects() {
    var host = document.getElementById('a-cat-selects');
    if (!host || !facets) return;

    /* Status is offered only when the data actually holds more than one —
       nothing is hidden until somebody hides it, and a control whose only
       option returns the whole list is a control that lies about having
       done something. */
    var statusSelect = facets.statuses.length > 1
      ? select({
          id: 'a-cat-status', name: 'status', label: 'Visibility',
          anyLabel: 'Any visibility', options: facets.statuses, value: state.status
        })
      : '';

    host.innerHTML =
      select({
        id: 'a-cat-dept', name: 'dept', label: 'Department',
        anyLabel: 'All departments', options: facets.departments, value: state.dept
      }) +
      select({
        id: 'a-cat-level', name: 'level', label: 'Level',
        anyLabel: 'All levels', options: facets.levels, value: state.level
      }) +
      statusSelect +
      select({
        id: 'a-cat-sort', name: 'sort', label: 'Sort by',
        anyLabel: 'Menu order',
        options: ZB.repo.categories.sorts.filter(function (s) { return s.id !== 'tree'; }),
        value: state.sort === 'tree' ? '' : state.sort
      });
  }

  function labelFor(list, id) {
    var hit = (list || []).filter(function (item) {
      return String(item.id) === String(id);
    })[0];
    return hit ? hit.label : id;
  }

  function paintChips() {
    var host = document.getElementById('a-cat-chips');
    if (!host) return;

    var chips = [];
    if (state.q) chips.push({ key: 'q', label: 'Search: ' + state.q });
    if (state.dept) {
      chips.push({ key: 'dept', label: labelFor(facets && facets.departments, state.dept) });
    }
    if (state.level) {
      chips.push({ key: 'level', label: labelFor(facets && facets.levels, state.level) });
    }
    if (state.status) {
      chips.push({ key: 'status', label: labelFor(facets && facets.statuses, state.status) });
    }

    if (!chips.length) {
      host.hidden = true;
      host.innerHTML = '';
      return;
    }

    host.hidden = false;
    host.innerHTML = chips.map(function (chip) {
      return '<button class="a-chip" type="button" data-chip-clear="' + chip.key + '">' +
               '<span class="a-chip__label">' + ui.esc(chip.label) + '</span>' +
               '<span class="a-chip__x" aria-hidden="true">' +
                 '<svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg>' +
               '</span>' +
               '<span class="visually-hidden"> — remove this filter</span>' +
             '</button>';
    }).join('') +
    '<button class="a-chip a-chip--clear" type="button" data-clear-all>Clear all</button>';
  }

  function paintCount(result) {
    var count = document.getElementById('a-cat-count');
    var note = document.getElementById('a-cat-note');
    if (!count) return;

    var from = (result.page - 1) * result.perPage + 1;
    var to = Math.min(result.page * result.perPage, result.total);

    count.textContent = result.total
      ? 'Showing ' + from + '–' + to + ' of ' + result.total + ' categories'
      : 'No categories found';

    /* Kept, and now always hidden: the repo saves every change to the
       database before its promise resolves, so it answers false. The
       element stays because the answer is the repo's to give, not this
       page's to assume. */
    if (note) {
      var dirty = ZB.repo.categories.hasUnsavedEdits();
      note.hidden = !dirty;
      note.textContent = dirty ? 'Some changes have not been saved.' : '';
    }
  }

  function paintTable(result) {
    var body = document.getElementById('a-cat-body');
    if (!body) return;

    if (!result.total) {
      body.innerHTML = hasFilters() ? noMatches() : noCategories();
      return;
    }

    var rows = result.items.map(function (row) {
      return '' +
        '<tr' + (row.id === highlightId ? ' class="is-new" data-highlight' : '') + '>' +
          '<th scope="row" class="a-cell--name' +
              /* Indented only while the rows are still in menu order; under
                 any other sort a child's parent may be pages away, and an
                 indent then claims a relationship the reader cannot see. */
              (result.tree && row.level === 2 ? ' a-cell--child' : '') + '">' +
            '<span class="a-cell__strong">' + ui.esc(row.label) + '</span>' +
            '<span class="a-cell__meta">' +
              (row.childCount
                ? row.childCount + (row.childCount === 1
                    ? ' sub-category' : ' sub-categories')
                : ui.esc(row.slug)) +
            '</span>' +
          '</th>' +
          '<td>' + ui.esc(row.deptLabel) + '</td>' +
          '<td class="a-cell--muted">' +
            (row.parentLabel ? ui.esc(row.parentLabel) : '<span aria-hidden="true">—</span>' +
              '<span class="visually-hidden">No parent — top level</span>') +
          '</td>' +
          '<td class="a-num">' + productCountCell(row) + '</td>' +
          '<td>' + ui.statusPill(row.status === 'active' ? 'active' : 'hidden',
                                 row.status === 'active' ? 'Visible' : 'Hidden') + '</td>' +
          '<td class="a-cell--actions">' +
            '<div class="a-rowactions">' +
              (row.storefrontPath
                ? '<a class="a-iconbtn" href="' + ui.esc(row.storefrontPath) + '" data-full-load' +
                     ' target="_blank" rel="noopener" title="View in store"' +
                     ' aria-label="View ' + ui.esc(row.label) + ' in the store">' +
                    ui.icon('store') +
                  '</a>'
                : '') +
              '<button class="a-iconbtn" type="button" data-cat-edit="' + ui.esc(row.id) + '"' +
                     ' title="Edit" aria-label="Edit ' + ui.esc(row.label) + '">' +
                ui.icon('sliders') +
              '</button>' +
              '<button class="a-iconbtn a-iconbtn--danger" type="button"' +
                     ' data-cat-delete="' + ui.esc(row.id) + '"' +
                     ' title="Delete" aria-label="Delete ' + ui.esc(row.label) + '">' +
                '<svg class="a-icon" viewBox="0 0 24 24" aria-hidden="true">' +
                  '<path d="M4 7h16"/><path d="M10 11v6"/><path d="M14 11v6"/>' +
                  '<path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/>' +
                '</svg>' +
              '</button>' +
            '</div>' +
          '</td>' +
        '</tr>';
    }).join('');

    body.innerHTML =
      '<table class="a-table a-table--categories">' +
        '<thead><tr>' +
          '<th scope="col">Category</th>' +
          '<th scope="col">Department</th>' +
          '<th scope="col">Parent</th>' +
          '<th scope="col" class="a-num">Products</th>' +
          '<th scope="col">Visibility</th>' +
          '<th scope="col"><span class="visually-hidden">Actions</span></th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>';

    /* Flashed once, then forgotten — a permanent marker on "the new one"
       stops meaning anything by the third addition. Scrolled to only when
       it is off screen, so adding a row never yanks a page that was
       already showing it. */
    var flash = body.querySelector('[data-highlight]');
    if (flash) {
      highlightId = null;
      var box = flash.getBoundingClientRect();
      if (box.top < 0 || box.bottom > window.innerHeight) {
        flash.scrollIntoView({
          block: 'center',
          behavior: ZB.reduceMotion ? 'auto' : 'smooth'
        });
      }
    }
  }

  /**
   * The count, as a link to exactly those products.
   *
   * A zero is drawn as a warning rather than as a number: an empty category
   * is a promise the menu is making that the shop cannot keep, and it is
   * the single thing on this screen most worth acting on. It is not a link,
   * because there is nothing on the other end of it.
   */
  function productCountCell(row) {
    if (!row.productCount) {
      return '<span class="a-count a-count--zero">' +
               'Empty<span class="visually-hidden"> — no products in this category</span>' +
             '</span>';
    }

    var href = ui.href('/admin/products?dept=' + encodeURIComponent(row.dept) +
                       '&category=' + encodeURIComponent(row.slug));

    return '<a class="a-count" href="' + href + '"' +
              ' aria-label="' + ui.esc(row.productCount + ' products in ' + row.label) + '">' +
             row.productCount +
           '</a>';
  }

  function noMatches() {
    return '' +
      '<div class="a-blank">' +
        '<p class="a-blank__title">No categories match those filters</p>' +
        '<p class="a-blank__body">Try a shorter search, or a different department.</p>' +
        '<button class="a-btn a-btn--ghost" type="button" data-clear-all>Clear all filters</button>' +
      '</div>';
  }

  function noCategories() {
    return '' +
      '<div class="a-blank">' +
        '<p class="a-blank__title">No categories yet</p>' +
        '<p class="a-blank__body">Add the first one and it appears here.</p>' +
        '<button class="a-btn a-btn--primary" type="button" data-cat-add>Add category</button>' +
      '</div>';
  }

  function paintPager(result) {
    var pager = document.getElementById('a-cat-pager');
    if (!pager) return;

    if (result.pages <= 1) {
      pager.hidden = true;
      pager.innerHTML = '';
      return;
    }

    var numbers = [];
    var from = Math.max(1, result.page - 2);
    var to = Math.min(result.pages, from + 4);
    from = Math.max(1, to - 4);

    for (var i = from; i <= to; i++) {
      numbers.push(
        '<button class="a-pager__no" type="button" data-page="' + i + '"' +
               (i === result.page ? ' aria-current="page"' : '') + '>' + i + '</button>'
      );
    }

    pager.hidden = false;
    pager.innerHTML =
      '<button class="a-pager__step" type="button" data-page="' + (result.page - 1) + '"' +
             (result.page === 1 ? ' disabled' : '') + '>Previous</button>' +
      '<div class="a-pager__numbers">' + numbers.join('') + '</div>' +
      '<button class="a-pager__step" type="button" data-page="' + (result.page + 1) + '"' +
             (result.page === result.pages ? ' disabled' : '') + '>Next</button>';
  }

  /* -----------------------------------------------------------------------
     Add and edit

     One dialog, two callers. The fields a category has are the same either
     way; only the placement control differs, and only because moving an
     existing category is a larger operation than a form field: it carries
     every product under it into another department, and the API does not
     accept the change for that reason. Offering a control that would be
     ignored is worse than not offering it.
     ----------------------------------------------------------------------- */

  var fields = ZB.adminFields.make('cat');

  /**
   * The placement options, as one control rather than two.
   *
   * Asking for a department and then a parent makes the reader hold a rule
   * in their head — that picking a parent overrides the department. One
   * list of real destinations does not: every option is a place that
   * exists, and "Men → Polo" already says which department it is in.
   */
  function placementOptions() {
    var options = (ZB.navigation || []).map(function (dept) {
      return { id: 'dept:' + dept.id, label: dept.label + ' — top level' };
    });

    ((facets && facets.parents) || []).forEach(function (parent) {
      options.push({ id: 'cat:' + parent.id, label: parent.label });
    });

    return options;
  }

  function statusOptions() {
    return [
      { id: 'active', label: 'Visible in the menu' },
      { id: 'hidden', label: 'Hidden' }
    ];
  }

  function openAdd() {
    /* The parent list has to be current, not whatever the page loaded with
       — a category added a moment ago must be available to nest under. */
    loadFacets().then(function () {
      ZB.adminModal.form({
        title: 'Add a category',
        intro: 'It is saved straight away, and appears in the shop\u2019s menu ' +
               'the next time a page there is opened.',
        submitLabel: 'Add category',

        body:
          fields.text({
            name: 'label', label: 'Category name',
            help: 'What shoppers see in the menu.'
          }) +
          fields.select({
            name: 'placement', label: 'Place it under',
            options: placementOptions(),
            help: 'A department for a top-level category, or an existing ' +
                  'category to nest it inside.'
          }) +
          fields.select({
            name: 'status', label: 'Visibility',
            options: statusOptions(), value: 'active'
          }),

        onSubmit: function (form, done) {
          var label = fields.valueOf(form, 'label');
          var placement = fields.valueOf(form, 'placement');
          var status = fields.valueOf(form, 'status');

          var parentId = placement.indexOf('cat:') === 0 ? placement.slice(4) : null;
          var dept = placement.indexOf('dept:') === 0 ? placement.slice(5) : null;

          var problem = validate(label, { parentId: parentId, dept: dept });
          if (problem) {
            fields.showErrors(form, { label: problem }, ['label']);
            return;
          }

          ZB.repo.categories.create({
            label: label, parentId: parentId, dept: dept, status: status
          }).then(function (row) {
            done(true);
            highlightId = row.id;
            loadFacets();
            load();
            loadMetrics();

            /* A new category lands in menu order, which can be any page of
               eighty-eight rows — so the confirmation carries the way to
               it rather than leaving the reader to hunt. Searching for it
               by name works from wherever they currently are. */
            ZB.adminToast.success('“' + row.label + '” added.', {
              label: 'Find it',
              onClick: function () {
                var search = document.getElementById('a-cat-search');
                if (search) search.value = row.label;
                state.q = row.label;
                state.page = 1;
                highlightId = row.id;
                writeState();
                load();
              }
            });
          }).catch(function (failure) {
            /* Not calling done() keeps the dialog open with what was typed
               still in it, which is what a failure needs — the name may be
               the thing to change. The server wrote the message; it knows
               what went wrong and this page does not. */
            fields.showErrors(form, {
              label: (failure && failure.message) || 'That could not be saved.'
            }, ['label']);
          });
        }
      });
    });
  }

  function openEdit(id) {
    ZB.repo.categories.get(id).then(function (row) {
      if (!row) {
        ZB.adminToast.error('That category no longer exists.');
        load();
        return;
      }

      var where = row.parentLabel
        ? row.deptLabel + ' → ' + row.parentLabel
        : row.deptLabel + ' — top level';

      ZB.adminModal.form({
        title: 'Edit category',
        intro: row.storefrontPath
          ? 'Its storefront address stays /category/' + row.dept + '/' + row.slug +
            ' — renaming changes the label, not the link.'
          : 'Added in this session. It has no storefront page yet.',
        submitLabel: 'Save changes',

        body:
          fields.text({
            name: 'label', label: 'Category name', value: row.label
          }) +
          /* Read-only, and shown rather than hidden: the reader still needs
             to know which of the two "Footwear" rows they opened.

             Not built with fields.wrap, deliberately. That helper emits a
             <label for>, and a label may only point at a form control —
             pointing one at a paragraph is markup a screen reader is
             entitled to ignore. A read-only value is not a control, so it
             gets a heading-style term and its value instead. */
          '<div class="a-field">' +
            '<p class="a-field__label" aria-hidden="true">Place in the menu</p>' +
            '<p class="a-readonly">' +
              '<span class="visually-hidden">Place in the menu: </span>' +
              ui.esc(where) +
            '</p>' +
          '</div>' +
          fields.select({
            name: 'status', label: 'Visibility',
            options: statusOptions(), value: row.status,
            help: row.childCount
              ? 'Hiding this also hides the ' + row.childCount + ' categories under it.'
              : ''
          }),

        onSubmit: function (form, done) {
          var label = fields.valueOf(form, 'label');
          var status = fields.valueOf(form, 'status');

          var problem = validate(label, row, id);
          if (problem) {
            fields.showErrors(form, { label: problem }, ['label']);
            return;
          }

          ZB.repo.categories.update(id, { label: label, status: status })
            .then(function (saved) {
              done(true);
              loadFacets();
              load();
              loadMetrics();
              ZB.adminToast.success('“' + saved.label + '” updated.');
            })
            .catch(function (failure) {
              /* Held open, for the same reason as the add dialog. */
              fields.showErrors(form, {
                label: (failure && failure.message) || 'That could not be saved.'
              }, ['label']);
            });
        }
      });
    });
  }

  /**
   * Returns a message, or nothing when the name is fine.
   *
   * The duplicate check is scoped to the same parent, which is how the menu
   * itself works: Men and Women both have a Footwear, and refusing the
   * second one would contradict the tree this screen is reading from.
   */
  function validate(label, place, ignoreId) {
    if (!label) return 'Give the category a name.';
    if (label.length < 2) return 'That name is too short.';
    if (label.length > 40) return 'Keep the name under 40 characters.';

    var siblings = lastSiblings(place, ignoreId);
    var clash = siblings.some(function (row) {
      return row.label.toLowerCase() === label.toLowerCase();
    });

    return clash
      ? 'There is already a category called “' + label + '” in the same place.'
      : '';
  }

  /* Everything at the same level under the same parent. Read from the repo
     rather than from the rendered page, which only holds one page of rows. */
  function lastSiblings(place, ignoreId) {
    var all = [];

    /* categories.childrenOf covers the nested case; the top level is
       everything in the department with no parent. */
    if (place && place.parentId) {
      all = ZB.repo.categories.childrenOf(place.parentId);
    } else if (place && place.dept) {
      all = ZB.repo.categories.childrenOf(null).filter(function (row) {
        return row.dept === place.dept;
      });
    }

    return all.filter(function (row) { return row.id !== ignoreId; });
  }

  /* -----------------------------------------------------------------------
     Delete
     ----------------------------------------------------------------------- */

  /**
   * Delete, or explain why not.
   *
   * A category that still holds sub-categories or products cannot be
   * deleted, and the server is what refuses it. That is not a limitation to
   * apologise for: the alternative is a cascade, and deleting "Eastern
   * Wear" would take six sub-categories and every product in them from one
   * click, with an undo that cannot bring products back once their images
   * and order lines are gone.
   *
   * So a full category is offered the thing that was almost certainly
   * meant instead — hide it, which takes it out of the shop immediately and
   * can be undone by showing it again. An empty one is deleted outright,
   * and needs no undo: nothing was in it, and adding it again is the same
   * three fields it took the first time.
   */
  function confirmDelete(id) {
    ZB.repo.categories.get(id).then(function (row) {
      if (!row) { load(); return; }

      var children = ZB.repo.categories.childrenOf(id).length;

      if (children || row.productCount) {
        var holds = [];
        if (children) {
          holds.push(children + (children === 1 ? ' sub-category' : ' sub-categories'));
        }
        if (row.productCount) {
          holds.push(row.productCount + (row.productCount === 1 ? ' product' : ' products'));
        }

        ZB.adminModal.confirm({
          title: 'This category is not empty',
          body: '“' + row.label + '” still holds ' + holds.join(' and ') + ', so it ' +
                'cannot be deleted. Hiding it takes it out of the shop straight ' +
                'away, leaves everything in it where it is, and can be undone by ' +
                'showing it again.',
          confirmLabel: 'Hide it instead',
          cancelLabel: 'Leave it as it is'
        }).then(function (yes) {
          if (!yes) return;

          ZB.repo.categories.update(id, { status: 'hidden' }).then(function () {
            loadFacets();
            load();
            loadMetrics();
            ZB.adminToast.success('“' + row.label + '” is hidden.');
          }).catch(function (failure) {
            ZB.adminToast.error((failure && failure.message) || 'That could not be changed.');
          });
        });

        return;
      }

      ZB.adminModal.confirm({
        title: 'Delete this category?',
        body: '“' + row.label + '” is empty, so nothing goes with it. It is ' +
              'removed from the shop\u2019s menu as well as from this list.',
        confirmLabel: 'Delete category',
        cancelLabel: 'Keep it',
        tone: 'danger'
      }).then(function (yes) {
        if (!yes) return;

        ZB.repo.categories.remove(id).then(function () {
          loadFacets();
          load();
          loadMetrics();
          ZB.adminToast.success('“' + row.label + '” deleted.');
        }).catch(function (failure) {
          /* Most likely something was put in it between the dialog opening
             and this running. The server counted; this page guessed. */
          ZB.adminToast.error((failure && failure.message) || 'That could not be deleted.');
          loadFacets();
          load();
          loadMetrics();
        });
      });
    });
  }

}(window.ZB));
