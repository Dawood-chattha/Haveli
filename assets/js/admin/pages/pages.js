/* =========================================================================
   pages/pages.js — the shop's written pages
   -------------------------------------------------------------------------
   The pages the storefront links to from its footer and its menu drawer,
   including Terms and Privacy. Every one of them used to render the same
   sentence about being a placeholder; this is where they get their words.

   THE SCREEN IS ABOUT WHAT IS MISSING
   A list of nine titles is not worth a screen. What is worth a screen is
   which of them are still blank, and the tiles say so first. A shop can
   trade with an unwritten Careers page; it should not trade with an
   unwritten Returns policy, and the only way the owner finds that out is if
   this page tells them plainly.

   PUBLISHED IS NOT THE SAME AS WRITTEN
   A page can be published with an empty body — a live footer link leading
   to a heading and white space. That is the one state that looks finished
   and is not, so it is counted on its own and marked on the row. The server
   refuses to publish an empty page; this is for one that was emptied after
   publishing.

   NOTHING TYPED HERE BECOMES MARKUP
   The body is plain text. assets/js/rich-text.js escapes it and then applies
   three rules, and the preview below calls that same function — so what is
   shown while writing is what a visitor gets, rather than an approximation
   that drifts.

   THERE IS NO "ADD PAGE" AND NO "DELETE"
   Each of these has a route in assets/js/routes.js and a link in
   data/footer.js. A thirteenth would be words nothing leads to; a deleted
   one would be a footer link leading nowhere. Emptying a page is what
   removing it means here.
   ========================================================================= */

window.ZB = window.ZB || {};
window.ZB.adminPages = window.ZB.adminPages || {};

(function (ZB) {
  'use strict';

  var ui = ZB.adminUI;
  var fields = ZB.adminFields.make('pg');

  var VIEWS = [
    { id: '', label: 'All' },
    { id: 'empty', label: 'Not written' },
    { id: 'draft', label: 'Drafts' },
    { id: 'published', label: 'Published' }
  ];

  /* What the screen is showing, kept here rather than read back out of the
     DOM. A filter read from a chip's class is a filter that disagrees with
     itself the first time a redraw is interrupted. */
  var view = '';
  var open = null;
  var busy = false;

  /* ----------------------------------------------------------------------- */

  function statusPill(row) {
    if (row.status !== 'published') {
      return '<span class="a-pill a-pill--muted">Draft</span>';
    }
    if (!row.written) {
      /* Live, and with nothing on it. Worth its own words rather than a
         green pill that says everything is fine. */
      return '<span class="a-pill a-pill--warn">Published, empty</span>';
    }
    return '<span class="a-pill a-pill--on">Published</span>';
  }

  function rowOf(row) {
    return '' +
      '<li class="a-page-row' + (row.written ? '' : ' is-empty') + '"' +
          ' data-page="' + ui.esc(row.slug) + '">' +
        '<div class="a-page-row__main">' +
          '<span class="a-page-row__title">' + ui.esc(row.title) + '</span>' +
          '<span class="a-page-row__path">' + ui.esc(row.storefrontPath) + '</span>' +
        '</div>' +
        '<div class="a-page-row__aside">' +
          statusPill(row) +
          '<button class="a-btn a-btn--ghost" type="button" data-edit>' +
            (row.written ? 'Edit' : 'Write') +
          '</button>' +
        '</div>' +
      '</li>';
  }

  function editorOf(row) {
    return '' +
      '<form class="a-card a-page-editor" id="a-page-form" novalidate>' +
        '<header class="a-card__head">' +
          '<h2 class="a-card__title">' + ui.esc(row.title) + '</h2>' +
          '<div class="a-card__aside">' +
            '<a class="a-btn a-btn--ghost" href="' + ui.esc(row.storefrontPath) + '"' +
               ' target="_blank" rel="noopener">' +
              ui.icon('link') + 'View on the shop' +
            '</a>' +
          '</div>' +
        '</header>' +

        '<div class="a-card__body">' +
          fields.text({ name: 'title', label: 'Page title', value: row.title,
                        help: 'The heading on the page, and the name in its ' +
                              'breadcrumb. The address ' + row.storefrontPath +
                              ' does not change — the footer links to it.' }) +

          '<div class="a-form__row">' +
            fields.text({ name: 'eyebrow', label: 'Eyebrow', value: row.eyebrow,
                          help: 'The small line above the title. Leave it empty ' +
                                'and nothing is shown.' }) +
            fields.text({ name: 'lead', label: 'Lead', value: row.lead,
                          help: 'One sentence under the title, before the body.' }) +
          '</div>' +

          fields.area({
            name: 'body', label: 'The page', value: row.body, rows: 16,
            help: 'Plain text. Leave a blank line between paragraphs. Start a ' +
                  'line with "## " for a heading, or with "- " for a bullet. ' +
                  'Anything else appears exactly as you type it.'
          }) +

          '<div class="a-page-editor__preview">' +
            '<p class="a-page-editor__preview-label">How it will look</p>' +
            '<div class="page-copy" data-preview></div>' +
          '</div>' +
        '</div>' +

        '<footer class="a-set__foot">' +
          '<p class="a-set__state" role="status" data-state></p>' +
          '<div class="a-set__actions">' +
            '<button class="a-btn" type="button" data-close>Close</button>' +
            (row.status === 'published'
              ? '<button class="a-btn" type="button" data-unpublish>Unpublish</button>'
              : '') +
            '<button class="a-btn a-btn--primary" type="submit" data-save>' +
              (row.status === 'published' ? 'Save' : 'Save and publish') +
            '</button>' +
          '</div>' +
        '</footer>' +
      '</form>';
  }

  /* ----------------------------------------------------------------------- */

  function paint(host, data) {
    var chips = VIEWS.map(function (v) {
      return '<button class="a-chip' + (v.id === view ? ' is-on' : '') + '"' +
                    ' type="button" data-view="' + v.id + '">' +
               ui.esc(v.label) +
             '</button>';
    }).join('');

    host.innerHTML =
      '<div class="a-chips">' + chips + '</div>' +

      (data.items.length
        ? '<ul class="a-page-rows">' + data.items.map(rowOf).join('') + '</ul>'
        : '<div class="a-blank">' +
            '<p class="a-blank__title">Nothing in that view</p>' +
            '<p class="a-blank__body">Every page is accounted for here.</p>' +
          '</div>') +

      (open ? editorOf(open) : '');

    if (open) refreshPreview(host);
  }

  function refreshPreview(host) {
    var body = host.querySelector('[name="body"]');
    var into = host.querySelector('[data-preview]');
    if (!body || !into) return;

    var drawn = ZB.richText(body.value);

    into.innerHTML = drawn ||
      '<p class="page-copy__para page-copy__para--quiet">' +
        'Nothing yet. What you type appears here.' +
      '</p>';
  }

  function load(host) {
    return Promise.all([ZB.repo.pages.list({ view: view }), ZB.repo.pages.summary()])
      .then(function (answers) {
        if (!document.body.contains(host)) return;

        paintTiles(answers[1]);
        paint(host, answers[0]);
      })
      .catch(function (err) {
        if (!document.body.contains(host)) return;

        host.innerHTML =
          '<div class="a-blank">' +
            '<p class="a-blank__title">The pages did not load</p>' +
            '<p class="a-blank__body">' +
              ui.esc((err && err.message) || 'They could not be read just now.') +
            '</p>' +
            '<button class="a-btn a-btn--primary" type="button" data-retry>Try again</button>' +
          '</div>';
      });
  }

  /* Drawn once by render(), filled by id — the shape coupons.js uses, so a
     refresh moves the numbers rather than replacing the row and making the
     whole strip flicker. */
  function metricTile(key, label) {
    return '' +
      '<div class="a-stat a-metric">' +
        '<p class="a-stat__label">' + ui.esc(label) + '</p>' +
        '<p class="a-stat__value" id="a-pg-m-' + key + '">—</p>' +
      '</div>';
  }

  function paintTiles(sum) {
    var host = document.getElementById('a-page-metrics');
    if (host) host.setAttribute('aria-busy', 'false');

    [['total', sum.total], ['published', sum.published],
     ['empty', sum.empty], ['hollow', sum.hollow]].forEach(function (pair) {
      var el = document.getElementById('a-pg-m-' + pair[0]);
      if (el) el.textContent = String(pair[1]);
    });
  }

  /* ----------------------------------------------------------------------- */

  function save(host, publish) {
    var form = document.getElementById('a-page-form');
    if (!form || busy) return;

    var state = form.querySelector('[data-state]');
    var button = form.querySelector('[data-save]');
    var value = function (n) {
      var el = form.querySelector('[name="' + n + '"]');
      return el ? el.value.trim() : '';
    };

    var text = value('body');

    /* Refused here as well as on the server, so the message lands under the
       button that was pressed rather than after a round trip. */
    if (publish && !text) {
      state.textContent = 'Write something before publishing this page.';
      state.className = 'a-set__state is-error';
      return;
    }

    busy = true;
    button.disabled = true;
    state.textContent = 'Saving…';
    state.className = 'a-set__state';

    ZB.repo.pages.update(open.slug, {
      title: value('title'),
      eyebrow: value('eyebrow'),
      lead: value('lead'),
      body: text,
      status: publish ? 'published' : 'draft'
    }).then(function (saved) {
      open = saved;
      ZB.adminToast.success(publish ? 'Page published.' : 'Page saved as a draft.');
      return load(host);
    }).catch(function (err) {
      var fieldSaid = err && err.fields
        ? Object.keys(err.fields).map(function (k) { return err.fields[k]; }).join(' ')
        : '';

      state.textContent = fieldSaid || (err && err.message) || 'That was not saved.';
      state.className = 'a-set__state is-error';
      button.disabled = false;
    }).then(function () {
      busy = false;
    });
  }

  /* ----------------------------------------------------------------------- */

  ZB.adminPages.pages = {

    title: 'Pages',
    crumbs: [{ label: 'Pages' }],

    render: function () {
      return '' +
        ui.pageHead({
          title: 'Pages',
          sub: 'The written pages the shop links to from its footer and menu.'
        }) +

        '<div class="a-metrics" id="a-page-metrics" aria-busy="true">' +
          metricTile('total', 'Pages') +
          metricTile('published', 'Published') +
          metricTile('empty', 'Not written') +
          metricTile('hollow', 'Live but empty') +
        '</div>' +

        '<div class="a-notice a-notice--quiet" role="note">' +
          ui.icon('warn') +
          '<p>' +
            'These pages are fixed: each has an address the shop links to, so ' +
            'none can be added or removed here. <strong>Terms and Conditions' +
            '</strong> and <strong>Privacy Policy</strong> are among them, and a ' +
            'shop should not trade with those left blank.' +
          '</p>' +
        '</div>' +

        '<div id="a-pages" aria-busy="true">' +
          '<div class="a-blank a-blank--loading">' +
            '<p class="a-blank__title">Loading…</p>' +
          '</div>' +
        '</div>';
    },

    mount: function () {
      var host = document.getElementById('a-pages');
      if (!host) return;

      open = null;
      view = '';

      load(host);

      host.addEventListener('click', function (e) {
        var chip = e.target.closest('[data-view]');
        var edit = e.target.closest('[data-edit]');
        var close = e.target.closest('[data-close]');
        var unpublish = e.target.closest('[data-unpublish]');
        var save2 = e.target.closest('[data-save]');
        var retry = e.target.closest('[data-retry]');

        if (retry) { load(host); return; }

        if (chip) {
          view = chip.getAttribute('data-view');
          load(host);
          return;
        }

        if (close) {
          open = null;
          load(host);
          return;
        }

        if (unpublish) { save(host, false); return; }
        if (save2) { save(host, true); return; }

        if (edit) {
          var li = e.target.closest('[data-page]');
          if (!li) return;

          ZB.repo.pages.get(li.getAttribute('data-page')).then(function (row) {
            open = row;
            return load(host);
          }).then(function () {
            var form = document.getElementById('a-page-form');
            if (form) {
              form.scrollIntoView({ block: 'start', behavior: 'smooth' });
              form.querySelector('[name="body"]').focus();
            }
          });
        }
      });

      /* The preview follows the typing rather than a Save, because the
         point of it is seeing what "## " does before committing to it. */
      host.addEventListener('input', function (e) {
        if (e.target.name === 'body') refreshPreview(host);
      });

      host.addEventListener('submit', function (e) {
        if (!e.target.closest('#a-page-form')) return;
        e.preventDefault();
        save(host, true);
      });
    }
  };

}(window.ZB));
