/* =========================================================================
   pages/banners.js — the slides the homepage opens with
   -------------------------------------------------------------------------
   The hero carousel is the first thing every visitor sees and the only
   part of the shop an owner changes weekly. This screen is where that
   happens.

   WHY THIS IS A LIST OF PREVIEWS AND NOT A TABLE
   A banner is a picture with words on it. A table row saying
   "01-kaftaan.jpg · The Kaftan That Does the Work · /category/women/dresses"
   is a description of a banner; it is not the banner, and nobody can tell
   from it whether the headline is legible over the image — which is the
   only question worth asking about a hero slide. So each row draws the
   actual composition: the real image, the real text, in the real order.

   WHY IT IS ONE COLUMN AND NOT A GRID
   Because the order is the point. A carousel plays in sequence: slide one
   is what nearly everybody sees, slide seven is what almost nobody does.
   In a grid, "move up" means "move left" on some rows and "move to the end
   of the row above" on others, and the reader has to work out which. Down
   a single column, up is up.

   Applied from the UI guidance consulted for this panel:
     - The destructive action asks first and the confirmation offers undo,
       while routine ones are one press (#35).
     - Reordering is announced, not merely animated, so it reaches a
       screen reader as well as an eye (#1).
     - An empty result is never a blank panel (#79, #90).
     - Refreshing holds the previous rows rather than collapsing them (#19).
     - Every write says so afterwards (#83).
   ========================================================================= */

window.ZB = window.ZB || {};
window.ZB.adminPages = window.ZB.adminPages || {};

(function (ZB) {
  'use strict';

  var ui = ZB.adminUI;

  var state = { view: '' };
  var lastResult = null;

  /* The slide to flash once after the next draw, and the button to put the
     keyboard back on after a move — a control that moves out from under
     the finger that pressed it has taken the keyboard with it. */
  var highlightId = null;
  var refocus = null;

  /* -----------------------------------------------------------------------
     URL state

     One filter, so one parameter. replaceState for the same reason the
     other lists use it: refreshing keeps the view, and a filtered list is
     a link worth sending, without burying the way out of the section under
     history entries.
     ----------------------------------------------------------------------- */

  function readState(params) {
    var query = (params && params.query) || {};
    var view = query.view || '';
    state.view = ['active', 'hidden', 'broken'].indexOf(view) > -1 ? view : '';
  }

  function writeState() {
    var url = '/admin/banners' + (state.view ? '?view=' + state.view : '');
    if (window.history.replaceState) window.history.replaceState({}, '', url);
  }

  /* -----------------------------------------------------------------------
     Page
     ----------------------------------------------------------------------- */

  ZB.adminPages.banners = {

    title: 'Banners',
    crumbs: [{ label: 'Banners' }],

    render: function () {
      return '' +
        ui.pageHead({
          title: 'Banners',
          sub: 'The slides the homepage opens with, in the order they play.',
          actions:
            '<button class="a-btn a-btn--primary" type="button" data-bn-add>' +
              ui.icon('plus') + 'Add slide' +
            '</button>'
        }) +

        '<div class="a-metrics a-metrics--filters" id="a-bn-metrics" aria-busy="true">' +
          plainTile('total', 'Slides') +
          filterTile('active', 'active', 'Live in the carousel') +
          filterTile('hidden', 'hidden', 'Hidden') +
          filterTile('broken', 'broken', 'Links going nowhere') +
        '</div>' +

        '<div class="a-card">' +

          '<div class="a-resultbar">' +
            '<p class="a-resultbar__count" id="a-bn-count" role="status"></p>' +
            '<p class="a-resultbar__note" id="a-bn-note" hidden></p>' +
          '</div>' +

          '<div class="a-card__body a-card__body--flush" id="a-bn-body" aria-busy="true">' +
            '<div class="a-skeleton" aria-hidden="true">' +
              '<div class="a-skeleton__row"></div>' +
              '<div class="a-skeleton__row"></div>' +
              '<div class="a-skeleton__row"></div>' +
            '</div>' +
          '</div>' +

        '</div>' +

        /* Reordering is a change with no visible confirmation of its own —
           the row simply is somewhere else. This says so out loud, and is
           in the markup before it has anything to say, because a live
           region created at the same moment as its text is missed. */
        '<p class="visually-hidden" id="a-bn-live" role="status" aria-live="polite"></p>';
    },

    mount: function (params) {
      var body = document.getElementById('a-bn-body');
      if (!body) return;

      readState(params);
      lastResult = null;

      document.addEventListener('click', onClick);

      load();
      loadMetrics();

      /* The listeners outlive this page unless they retire themselves.
         Checking that the markup is still in the document is what works —
         the router fires zb:navigated at the end of the render that
         mounted this page, so unsubscribing on it would fire at once. */
      function gone() {
        if (document.body.contains(body)) return false;
        document.removeEventListener('click', onClick);
        return true;
      }

      function onClick(e) {
        if (gone()) return;

        if (e.target.closest('[data-bn-add]')) { openAdd(); return; }

        var tile = e.target.closest('[data-bn-view]');
        if (tile) {
          var wanted = tile.getAttribute('data-bn-view');
          /* Pressing the tile that is already in force clears it. A filter
             with no way off it is a trap. */
          state.view = state.view === wanted ? '' : wanted;
          writeState();
          paintTiles();
          load();
          return;
        }

        var edit = e.target.closest('[data-bn-edit]');
        if (edit) { openEdit(edit.getAttribute('data-bn-edit')); return; }

        var del = e.target.closest('[data-bn-delete]');
        if (del) { confirmDelete(del.getAttribute('data-bn-delete')); return; }

        var move = e.target.closest('[data-bn-move]');
        if (move) {
          moveSlide(move.getAttribute('data-bn-move'),
                    Number(move.getAttribute('data-bn-delta')));
          return;
        }

        if (e.target.closest('[data-clear-view]')) {
          state.view = '';
          writeState();
          paintTiles();
          load();
        }
      }
    }
  };

  /* -----------------------------------------------------------------------
     Loading
     ----------------------------------------------------------------------- */

  function load() {
    var body = document.getElementById('a-bn-body');
    if (!body) return;

    body.setAttribute('aria-busy', 'true');
    if (lastResult) body.classList.add('is-refreshing');

    return ZB.repo.banners.list({ view: state.view }).then(function (result) {
      if (!document.body.contains(body)) return null;

      lastResult = result;
      paintCount(result);
      paintList(result);

      body.classList.remove('is-refreshing');
      body.setAttribute('aria-busy', 'false');
      return result;
    });
  }

  function loadMetrics() {
    var host = document.getElementById('a-bn-metrics');
    if (!host) return;

    return ZB.repo.banners.summary().then(function (sum) {
      if (!document.body.contains(host)) return;

      setMetric('total', sum.total);
      setMetric('active', sum.active);
      setMetric('hidden', sum.hidden);
      setMetric('broken', sum.broken);

      /* A zero here is good news, so it is not painted as an alarm. A red
         0 under "Links going nowhere" reads at a glance as a problem and
         costs the reader a second look to find out it is the opposite. */
      var broken = document.querySelector('[data-bn-view="broken"]');
      if (broken) broken.classList.toggle('is-clean', sum.broken === 0);

      host.setAttribute('aria-busy', 'false');
      paintTiles();
    });
  }

  /* -----------------------------------------------------------------------
     Tiles
     ----------------------------------------------------------------------- */

  function plainTile(key, label) {
    return '' +
      '<div class="a-stat a-metric">' +
        '<p class="a-stat__label">' + ui.esc(label) + '</p>' +
        '<p class="a-stat__value" id="a-bn-m-' + key + '">—</p>' +
      '</div>';
  }

  /* A count an owner cannot act on is a count they have to act on
     somewhere else, so the three that have a subset behind them are
     buttons that apply it. */
  function filterTile(key, view, label) {
    return '' +
      '<button class="a-stat a-metric a-metric--button a-metric--' + view + '"' +
             ' type="button" data-bn-view="' + view + '" aria-pressed="false">' +
        '<span class="a-stat__label">' + ui.esc(label) + '</span>' +
        '<span class="a-stat__value" id="a-bn-m-' + key + '">—</span>' +
      '</button>';
  }

  function setMetric(key, value) {
    var el = document.getElementById('a-bn-m-' + key);
    if (el) el.textContent = String(value);
  }

  function paintTiles() {
    ZB.util.all('[data-bn-view]').forEach(function (tile) {
      tile.setAttribute('aria-pressed',
        tile.getAttribute('data-bn-view') === state.view ? 'true' : 'false');
    });
  }

  /* -----------------------------------------------------------------------
     Painting
     ----------------------------------------------------------------------- */

  function paintCount(result) {
    var count = document.getElementById('a-bn-count');
    var note = document.getElementById('a-bn-note');
    if (!count) return;

    var what =
      state.view === 'active' ? 'live ' :
      state.view === 'hidden' ? 'hidden ' :
      state.view === 'broken' ? 'broken ' : '';

    count.textContent = result.total
      ? result.total + ' ' + what + (result.total === 1 ? 'slide' : 'slides')
      : 'No slides to show';

    if (note) {
      var dirty = ZB.repo.banners.hasUnsavedEdits();
      note.hidden = !dirty;
      note.textContent = dirty
        ? 'Changes are held in this tab only and do not reach the homepage — ' +
          'there is no database yet.'
        : '';
    }
  }

  function paintList(result) {
    var body = document.getElementById('a-bn-body');
    if (!body) return;

    if (!result.total) {
      body.innerHTML = state.view ? noMatches() : noSlides();
      return;
    }

    body.innerHTML =
      '<ol class="a-slides">' +
        result.items.map(function (row, i) {
          return slideRow(row, i, result.items.length);
        }).join('') +
      '</ol>';

    /* Put the keyboard back on the button that was pressed, now that it is
       in a new place in the document. Without this a run of moves needs a
       fresh Tab journey after every single one. */
    if (refocus) {
      var button = body.querySelector(
        '[data-bn-move="' + refocus.id + '"][data-bn-delta="' + refocus.delta + '"]'
      );
      /* At the end of the run that button is disabled, so the other one
         takes the focus rather than letting it fall back to the body. */
      if (button && !button.disabled) button.focus();
      else {
        var other = body.querySelector('[data-bn-move="' + refocus.id + '"]:not(:disabled)');
        if (other) other.focus();
      }
      refocus = null;
    }

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
   * One slide.
   *
   * The preview is the real composition — the actual image, with the
   * actual eyebrow, headline and button drawn over it the way the
   * storefront draws them. It is scaled down, so it is not a pixel-exact
   * proof; it is enough to answer "is the headline readable over that
   * photograph", which the filename never could.
   */
  function slideRow(row, i, count) {
    var hidden = row.status !== 'active';
    var flash = row.id === highlightId;

    var classes = 'a-slide' +
                  (hidden ? ' a-slide--hidden' : '') +
                  (flash ? ' is-new' : '');

    return '' +
      '<li class="' + classes + '"' + (flash ? ' data-highlight' : '') + '>' +

        '<div class="a-slide__preview">' +
          '<img class="a-slide__img" src="' + ui.esc(row.image) + '"' +
              ' alt="" loading="lazy" data-bn-img>' +
          '<div class="a-slide__wash" aria-hidden="true"></div>' +
          '<div class="a-slide__copy">' +
            (row.eyebrow
              ? '<p class="a-slide__eyebrow">' + ui.esc(row.eyebrow) + '</p>' : '') +
            '<p class="a-slide__headline">' + ui.esc(row.headline) + '</p>' +
            (row.cta ? '<p class="a-slide__cta">' + ui.esc(row.cta) + '</p>' : '') +
          '</div>' +
          '<p class="a-slide__badge">' +
            (hidden
              ? '<span class="visually-hidden">Hidden — not in the carousel</span>' +
                '<span aria-hidden="true">—</span>'
              : '<span class="visually-hidden">Position </span>' + row.position) +
          '</p>' +
        '</div>' +

        '<div class="a-slide__detail">' +
          '<div class="a-slide__heading">' +
            '<h3 class="a-slide__title">' + ui.esc(row.headline) + '</h3>' +
            ui.statusPill(hidden ? 'hidden' : 'active', hidden ? 'Hidden' : 'Live') +
          '</div>' +

          (row.body ? '<p class="a-slide__body">' + ui.esc(row.body) + '</p>' : '') +

          linkLine(row) +

          /* The alt text is a field on the form, so it is shown here too:
             a slide with no alt text is invisible to a screen reader and
             to every image search, and nothing else on this screen would
             ever reveal it. */
          (row.alt
            ? ''
            : '<p class="a-slide__flag">' + ui.icon('warn') +
                'No alt text — this image has nothing to announce itself with.' +
              '</p>') +
        '</div>' +

        '<div class="a-slide__actions">' +
          '<div class="a-slide__order">' +
            '<button class="a-iconbtn" type="button" data-bn-move="' + ui.esc(row.id) + '"' +
                   ' data-bn-delta="-1"' + (i === 0 ? ' disabled' : '') +
                   ' title="Move up" aria-label="Move ' + ui.esc(row.headline) + ' up">' +
              ui.icon('up') +
            '</button>' +
            '<button class="a-iconbtn" type="button" data-bn-move="' + ui.esc(row.id) + '"' +
                   ' data-bn-delta="1"' + (i === count - 1 ? ' disabled' : '') +
                   ' title="Move down" aria-label="Move ' + ui.esc(row.headline) + ' down">' +
              ui.icon('down') +
            '</button>' +
          '</div>' +

          '<div class="a-rowactions">' +
            '<button class="a-iconbtn" type="button" data-bn-edit="' + ui.esc(row.id) + '"' +
                   ' title="Edit" aria-label="Edit ' + ui.esc(row.headline) + '">' +
              ui.icon('sliders') +
            '</button>' +
            '<button class="a-iconbtn a-iconbtn--danger" type="button"' +
                   ' data-bn-delete="' + ui.esc(row.id) + '"' +
                   ' title="Delete" aria-label="Delete ' + ui.esc(row.headline) + '">' +
              '<svg class="a-icon" viewBox="0 0 24 24" aria-hidden="true">' +
                '<path d="M4 7h16"/><path d="M10 11v6"/><path d="M14 11v6"/>' +
                '<path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/>' +
              '</svg>' +
            '</button>' +
          '</div>' +
        '</div>' +

      '</li>';
  }

  /**
   * Where the slide's button goes, and whether anything is there.
   *
   * A working link is shown quietly, as a link the owner can follow. A
   * broken one is not shown as a red word — it says which part of the
   * address the shop does not recognise, because "broken" tells somebody
   * they have a problem and the reason tells them how to end it.
   */
  function linkLine(row) {
    if (!row.linkOk) {
      return '' +
        '<p class="a-slide__flag a-slide__flag--bad">' +
          ui.icon('warn') +
          '<span>' +
            '<strong>' + ui.esc(row.href || 'No link') + '</strong> — ' +
            ui.esc(row.linkReason) +
          '</span>' +
        '</p>';
    }

    return '' +
      '<p class="a-slide__link">' +
        ui.icon('link') +
        '<a href="' + ui.esc(row.href) + '" data-full-load target="_blank" rel="noopener">' +
          ui.esc(row.href) +
          '<span class="visually-hidden"> — opens the storefront page in a new tab</span>' +
        '</a>' +
      '</p>';
  }

  function noMatches() {
    return '' +
      '<div class="a-blank">' +
        '<p class="a-blank__title">Nothing in that view</p>' +
        '<p class="a-blank__body">' +
          (state.view === 'broken'
            ? 'Every slide points at a page the shop actually serves.'
            : 'No slides are ' + (state.view === 'hidden' ? 'hidden' : 'live') +
              ' at the moment.') +
        '</p>' +
        '<button class="a-btn a-btn--ghost" type="button" data-clear-view>' +
          'Show every slide' +
        '</button>' +
      '</div>';
  }

  function noSlides() {
    return '' +
      '<div class="a-blank">' +
        '<p class="a-blank__title">The carousel is empty</p>' +
        '<p class="a-blank__body">' +
          'With no slides the homepage opens on the section below the hero.' +
        '</p>' +
        '<button class="a-btn a-btn--primary" type="button" data-bn-add>Add a slide</button>' +
      '</div>';
  }

  /* -----------------------------------------------------------------------
     Reordering

     One press, no dialog and no undo button: the move IS its own undo —
     the other arrow is right there and puts it straight back. A confirm in
     front of a reversible one-step change trains people to dismiss the one
     dialog that matters.
     ----------------------------------------------------------------------- */

  function moveSlide(id, delta) {
    refocus = { id: id, delta: delta };

    ZB.repo.banners.move(id, delta).then(function (result) {
      if (!result.moved) { refocus = null; return; }

      load().then(function (listed) {
        if (!listed) return;

        var row = listed.items.filter(function (item) { return item.id === id; })[0];
        var live = document.getElementById('a-bn-live');
        if (!row || !live) return;

        /* Said in terms of what a shopper gets, not of array indexes. A
           hidden slide has no position in the run, so it is described by
           where it sits in the list instead of being given one. */
        live.textContent = row.status === 'active'
          ? '“' + row.headline + '” is now slide ' + row.position + '.'
          : '“' + row.headline + '” moved. It is hidden, so it does not play.';
      });
    });
  }

  /* -----------------------------------------------------------------------
     Add and edit

     One dialog, two callers, and the fields are the same either way — a
     slide is a picture, five short pieces of copy and a destination.
     ----------------------------------------------------------------------- */

  var fields = ZB.adminFields.make('bn');

  function statusOptions() {
    return [
      { id: 'active', label: 'Live in the carousel' },
      { id: 'hidden', label: 'Hidden' }
    ];
  }

  /**
   * The fields, for both callers.
   *
   * The image is a path and not an upload, because an upload needs a
   * server to receive it and this build has none. Saying that in the help
   * text is better than a file picker that silently does nothing.
   */
  function formBody(row) {
    row = row || {};

    return '' +
      fields.text({
        name: 'image', label: 'Image',
        value: row.image || 'assets/img/hero/',
        help: 'A path inside the site. Uploading a file needs a backend, ' +
              'which this build does not have yet.'
      }) +

      '<div class="a-field">' +
        '<p class="a-field__label" aria-hidden="true">Preview</p>' +
        '<div class="a-imgcheck" data-img-check>' +
          '<img class="a-imgcheck__img" alt="" data-img-preview' +
              ' src="' + ui.esc(row.image || '') + '">' +
          '<p class="a-imgcheck__note" data-img-note role="status"></p>' +
        '</div>' +
      '</div>' +

      fields.text({
        name: 'alt', label: 'Alt text', value: row.alt || '',
        help: 'What the picture shows, for a reader who cannot see it.'
      }) +

      fields.text({
        name: 'eyebrow', label: 'Eyebrow', value: row.eyebrow || '',
        help: 'The small line above the headline. Optional.'
      }) +

      fields.text({
        name: 'headline', label: 'Headline', value: row.headline || ''
      }) +

      fields.area({
        name: 'body', label: 'Supporting line', value: row.body || '', rows: 2,
        help: 'One sentence under the headline. Optional.'
      }) +

      fields.text({
        name: 'cta', label: 'Button label', value: row.cta || '',
        help: 'What the button on the slide says — “Shop the edit”.'
      }) +

      fields.select({
        name: 'href', label: 'Button goes to',
        value: row.href || '/',
        options: ZB.repo.banners.linkOptions(row.href),
        help: 'Chosen from the pages the shop actually serves, so a slide ' +
              'cannot be pointed at an address that does not exist.'
      }) +

      fields.text({
        name: 'proof', label: 'Small print', value: row.proof || '',
        help: 'The quiet line at the bottom of the slide. Optional.'
      }) +

      fields.select({
        name: 'status', label: 'Visibility',
        options: statusOptions(), value: row.status || 'active'
      });
  }

  /**
   * Live image checking inside the dialog.
   *
   * The path is typed, so it can be wrong, and a wrong path produces a
   * slide that is a blank rectangle on the homepage. The browser already
   * knows whether the file loaded, so that answer is simply shown rather
   * than left for somebody to discover in production.
   */
  function wireImagePreview(form) {
    var input = form.querySelector('#bn-image');
    var img = form.querySelector('[data-img-preview]');
    var note = form.querySelector('[data-img-note]');
    var host = form.querySelector('[data-img-check]');
    if (!input || !img || !note || !host) return;

    function report(kind, text) {
      host.setAttribute('data-state', kind);
      note.textContent = text;
    }

    img.addEventListener('load', function () {
      report('ok', img.naturalWidth + ' × ' + img.naturalHeight);
    });

    img.addEventListener('error', function () {
      report('bad', 'Nothing loads from that path.');
    });

    var check = ZB.util.debounce(function () {
      var value = input.value.trim();
      if (!value) { img.removeAttribute('src'); report('empty', 'No image set.'); return; }
      report('waiting', 'Loading…');
      img.src = value;
    }, 350);

    input.addEventListener('input', check);

    if (!input.value.trim()) report('empty', 'No image set.');
    else if (img.complete && img.naturalWidth) {
      report('ok', img.naturalWidth + ' × ' + img.naturalHeight);
    } else {
      report('waiting', 'Loading…');
    }
  }

  /**
   * Returns { field: message } — empty when everything is fine.
   *
   * Alt text is required rather than encouraged. It is the one field on
   * this form nobody misses when it is absent, because the people it is
   * for are not the people filling the form in.
   */
  function validate(values, imageState) {
    var problems = {};

    if (!values.image) {
      problems.image = 'Give the slide a picture.';
    } else if (imageState === 'bad') {
      /* The preview beside the field has already tried to load it and
         failed. Showing that and then saving it anyway would make the
         check decorative: the slide would go out as a blank rectangle on
         the homepage, which is what the preview is there to prevent.
         Only a confirmed failure blocks — a path still loading is not
         known to be wrong, and losing the save to a race would be worse. */
      problems.image = 'Nothing loads from that path, so the slide would be ' +
                       'blank on the homepage.';
    }

    if (!values.alt) {
      problems.alt = 'Describe the picture — a slide with no alt text is ' +
                     'silent to a screen reader.';
    }

    if (!values.headline) problems.headline = 'Give the slide a headline.';
    else if (values.headline.length > 70) {
      problems.headline = 'Keep the headline under 70 characters — it is set large.';
    }

    if (values.eyebrow.length > 40) {
      problems.eyebrow = 'Keep the eyebrow under 40 characters.';
    }

    if (!values.cta) problems.cta = 'Give the button something to say.';
    else if (values.cta.length > 28) {
      problems.cta = 'Keep the button label under 28 characters.';
    }

    /* Belt and braces. The control only offers real destinations, but a
       slide already pointing somewhere odd keeps its value in the list, so
       the check still has to run. */
    var link = ZB.repo.banners.checkLink(values.href);
    if (!link.ok) problems.href = link.reason;

    return problems;
  }

  var FIELD_ORDER = ['image', 'alt', 'eyebrow', 'headline', 'body', 'cta',
                     'href', 'proof', 'status'];

  /** What the image preview beside the field found out, if anything. */
  function imageStateOf(form) {
    var host = form.querySelector('[data-img-check]');
    return host ? host.getAttribute('data-state') : null;
  }

  function readValues(form) {
    var values = {};
    FIELD_ORDER.forEach(function (name) {
      values[name] = fields.valueOf(form, name);
    });
    return values;
  }

  function openAdd() {
    ZB.adminModal.form({
      title: 'Add a slide',
      intro: 'It goes to the end of the run and can be moved from there.',
      submitLabel: 'Add slide',
      body: formBody(null),

      onSubmit: function (form, done) {
        var values = readValues(form);
        var problems = validate(values, imageStateOf(form));

        if (Object.keys(problems).length) {
          fields.showErrors(form, problems, FIELD_ORDER);
          return;
        }

        ZB.repo.banners.create(values).then(function (row) {
          done(true);
          highlightId = row.id;
          load();
          loadMetrics();
          ZB.adminToast.success('Slide added at the end of the carousel.');
        });
      }
    });

    /* The dialog mounts synchronously inside form(), so it is already in
       the document here and the preview can be wired straight away. */
    var form = document.querySelector('.a-modal--form form');
    if (form) wireImagePreview(form);
  }

  function openEdit(id) {
    ZB.repo.banners.get(id).then(function (row) {
      if (!row) {
        ZB.adminToast.error('That slide no longer exists.');
        load();
        return;
      }

      ZB.adminModal.form({
        title: 'Edit slide',
        intro: row.status === 'active'
          ? 'Slide ' + row.position + ' in the carousel.'
          : 'Hidden — it is not in the carousel at the moment.',
        submitLabel: 'Save changes',
        body: formBody(row),

        onSubmit: function (form, done) {
          var values = readValues(form);
          var problems = validate(values, imageStateOf(form));

          if (Object.keys(problems).length) {
            fields.showErrors(form, problems, FIELD_ORDER);
            return;
          }

          ZB.repo.banners.update(id, values)
            .then(function () {
              done(true);
              highlightId = id;
              load();
              loadMetrics();
              ZB.adminToast.success('Slide updated.');
            })
            .catch(function (failure) {
              done(true);
              ZB.adminToast.error(failure.message || 'That could not be saved.');
              load();
            });
        }
      });

      var form = document.querySelector('.a-modal--form form');
      if (form) wireImagePreview(form);
    });
  }

  /* -----------------------------------------------------------------------
     Delete
     ----------------------------------------------------------------------- */

  function confirmDelete(id) {
    ZB.repo.banners.get(id).then(function (row) {
      if (!row) { load(); return; }

      var body = '“' + row.headline + '” will be taken out of the carousel.';
      if (row.status === 'active') {
        body += ' The slides after it move up one.';
      }
      body += ' This build has no database, so the change lasts until reload.';

      ZB.adminModal.confirm({
        title: 'Delete this slide?',
        body: body,
        confirmLabel: 'Delete slide',
        cancelLabel: 'Keep it',
        tone: 'danger'
      }).then(function (yes) {
        if (!yes) return;

        ZB.repo.banners.remove(id).then(function (undo) {
          load();
          loadMetrics();

          ZB.adminToast.success('Slide deleted.', {
            label: 'Undo',
            onClick: function () {
              /* restore() puts the captured order back too, so an undone
                 delete returns the slide to the place it held rather than
                 to the end of the run. */
              ZB.repo.banners.restore(undo).then(function () {
                highlightId = id;
                load();
                loadMetrics();
                ZB.adminToast.info('Slide restored.');
              });
            }
          });
        });
      });
    });
  }

}(window.ZB));
