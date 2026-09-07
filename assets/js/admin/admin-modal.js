/* =========================================================================
   admin-modal.js — the dialogs: confirm, and a form in a box
   -------------------------------------------------------------------------
   Destructive actions ask first. Deleting something on a single click, with
   nothing between the pointer and the loss, is the change nobody meant to
   make.

   The confirm dialog is deliberately specific: it names the thing being
   deleted and labels its button with the verb ("Delete product"), rather
   than offering an anonymous "Are you sure? / OK". A reader who has stopped
   reading still gets the answer from the button.

   The form dialog is the same box with a <form> in it. Categories, banners
   and coupons are all small enough that a whole route for "add one" would
   lose the list the reader is working against; the dialog keeps the list
   behind it and returns them to exactly the row they were looking at.

   ACCESSIBILITY — the same for both, because it is the same box
     - role="dialog" with aria-modal, labelled by its own title.
     - Focus moves into the dialog on open and returns to whatever opened it
       on close, so the keyboard never loses its place.
     - Tab is trapped inside while it is open.
     - Escape and the backdrop both cancel.

   WHERE THE TWO DIFFER, AND WHY
     A confirm focuses Cancel: arriving and pressing Enter must never be how
     something gets deleted. A form focuses its first field, because that is
     the next thing the reader has to do, and its submit button is not
     destructive. Backdrop-to-cancel is also switched off for a form — a
     stray click outside must not throw away a half-typed row.
   ========================================================================= */

window.ZB = window.ZB || {};

(function (ZB) {
  'use strict';

  var open = null;      /* only one dialog at a time */

  /* -----------------------------------------------------------------------
     The shared box

     o: { className, html, dismissOnScrim, initialFocus(box), onClose(answer) }
     Returns { root, box, close }.
     ----------------------------------------------------------------------- */

  function mount(o) {
    if (open) open.close(null);

    var opener = document.activeElement;

    var root = document.createElement('div');
    root.className = 'a-modal' + (o.className ? ' ' + o.className : '');
    root.innerHTML =
      '<div class="a-modal__scrim" data-modal-scrim></div>' + o.html;

    document.body.appendChild(root);
    ZB.util.lockScroll(true);

    var box = root.querySelector('.a-modal__box');

    function focusable() {
      return Array.prototype.slice.call(box.querySelectorAll(
        'button:not([disabled]), a[href], input:not([disabled]), ' +
        'select:not([disabled]), textarea:not([disabled])'
      )).filter(function (el) { return el.offsetParent !== null || el === document.activeElement; });
    }

    function close(answer) {
      if (open !== api) return;
      open = null;

      document.removeEventListener('keydown', onKey, true);
      ZB.util.lockScroll(false);
      if (root.parentNode) root.parentNode.removeChild(root);

      /* Put the keyboard back where it was. */
      if (opener && document.body.contains(opener)) opener.focus();
      if (o.onClose) o.onClose(answer);
    }

    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); close(null); return; }
      if (e.key !== 'Tab') return;

      var items = focusable();
      if (!items.length) return;

      var first = items[0];
      var last = items[items.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      } else if (!box.contains(document.activeElement)) {
        /* Focus escaped some other way; bring it back. */
        e.preventDefault(); first.focus();
      }
    }

    root.addEventListener('mousedown', function (e) {
      if (!o.dismissOnScrim) return;
      if (e.target.hasAttribute('data-modal-scrim')) close(null);
    });

    document.addEventListener('keydown', onKey, true);

    var api = { root: root, box: box, close: close };
    open = api;

    if (o.initialFocus) o.initialFocus(box);
    return api;
  }

  /* -----------------------------------------------------------------------
     Confirm
     ----------------------------------------------------------------------- */

  /**
   * Ask before doing something.
   *
   * o: { title, body, confirmLabel, cancelLabel, tone: 'danger' | 'default' }
   * Resolves true when confirmed, false when dismissed any other way.
   */
  function confirm(o) {
    return new Promise(function (resolve) {
      var tone = o.tone === 'danger' ? 'danger' : 'default';

      var dialog = mount({
        dismissOnScrim: true,

        html:
          '<div class="a-modal__box" role="dialog" aria-modal="true"' +
               ' aria-labelledby="a-modal-title" aria-describedby="a-modal-body">' +
            '<h2 class="a-modal__title" id="a-modal-title">' + ZB.ui.esc(o.title) + '</h2>' +
            '<p class="a-modal__body" id="a-modal-body">' + ZB.ui.esc(o.body) + '</p>' +
            '<div class="a-modal__actions">' +
              '<button class="a-btn a-btn--ghost" type="button" data-modal-cancel>' +
                ZB.ui.esc(o.cancelLabel || 'Cancel') +
              '</button>' +
              '<button class="a-btn a-btn--' + tone + '" type="button" data-modal-confirm>' +
                ZB.ui.esc(o.confirmLabel || 'Confirm') +
              '</button>' +
            '</div>' +
          '</div>',

        /* Cancel takes focus, never the destructive button. */
        initialFocus: function (box) { box.querySelector('[data-modal-cancel]').focus(); },

        onClose: function (answer) { resolve(answer === true); }
      });

      dialog.root.addEventListener('click', function (e) {
        if (e.target.closest('[data-modal-cancel]')) { dialog.close(false); return; }
        if (e.target.closest('[data-modal-confirm]')) { dialog.close(true); }
      });
    });
  }

  /* -----------------------------------------------------------------------
     Form
     ----------------------------------------------------------------------- */

  /**
   * A form inside a dialog.
   *
   * o: {
   *   title,
   *   intro,                      optional line under the title
   *   body,                       the fields, as HTML
   *   submitLabel, cancelLabel,
   *   onSubmit(form, done)        called on submit; call done(true) to close
   * }
   *
   * `onSubmit` owns validation. It keeps the dialog open by simply not
   * calling done — which is what has to happen when a field is wrong, since
   * closing would throw away what was typed along with the error explaining
   * why. Resolves true if it closed via done(true), false otherwise.
   */
  function form(o) {
    return new Promise(function (resolve) {

      var dialog = mount({
        className: 'a-modal--form',
        /* A stray click outside must not discard a half-typed row. */
        dismissOnScrim: false,

        html:
          '<div class="a-modal__box a-modal__box--wide" role="dialog" aria-modal="true"' +
               ' aria-labelledby="a-modal-title">' +
            '<h2 class="a-modal__title" id="a-modal-title">' + ZB.ui.esc(o.title) + '</h2>' +
            (o.intro
              ? '<p class="a-modal__body" id="a-modal-body">' + ZB.ui.esc(o.intro) + '</p>'
              : '') +
            '<form class="a-modal__form" novalidate>' +
              '<div class="a-modal__fields">' + (o.body || '') + '</div>' +
              '<div class="a-modal__actions">' +
                '<button class="a-btn a-btn--ghost" type="button" data-modal-cancel>' +
                  ZB.ui.esc(o.cancelLabel || 'Cancel') +
                '</button>' +
                '<button class="a-btn a-btn--primary" type="submit">' +
                  '<span class="a-btn__spinner" aria-hidden="true"></span>' +
                  ZB.ui.esc(o.submitLabel || 'Save') +
                '</button>' +
              '</div>' +
            '</form>' +
          '</div>',

        /* The first field, because that is the next thing to do. */
        initialFocus: function (box) {
          var first = box.querySelector('.a-modal__fields input, .a-modal__fields select, ' +
                                        '.a-modal__fields textarea');
          if (first) first.focus();
          else box.querySelector('[type="submit"]').focus();
        },

        onClose: function (answer) { resolve(answer === true); }
      });

      var formEl = dialog.box.querySelector('form');

      dialog.root.addEventListener('click', function (e) {
        if (e.target.closest('[data-modal-cancel]')) dialog.close(false);
      });

      formEl.addEventListener('submit', function (e) {
        e.preventDefault();
        if (!o.onSubmit) { dialog.close(true); return; }

        o.onSubmit(formEl, function (ok) {
          if (ok) dialog.close(true);
        });
      });
    });
  }

  ZB.adminModal = { confirm: confirm, form: form };

}(window.ZB));
