/* =========================================================================
   admin-modal.js — the confirmation dialog
   -------------------------------------------------------------------------
   Destructive actions ask first. Deleting a product on a single click, with
   nothing between the pointer and the loss, is the change nobody meant to
   make.

   The dialog is deliberately specific: it names the thing being deleted and
   labels its button with the verb ("Delete product"), rather than offering
   an anonymous "Are you sure? / OK". A reader who has stopped reading still
   gets the answer from the button.

   ACCESSIBILITY
     - role="dialog" with aria-modal, labelled by its own title.
     - Focus moves into the dialog on open and returns to whatever opened it
       on close, so the keyboard never loses its place.
     - Tab is trapped inside while it is open.
     - Escape and the backdrop both cancel. The destructive button is never
       the one focused first — Enter on arrival must not confirm.
   ========================================================================= */

window.ZB = window.ZB || {};

(function (ZB) {
  'use strict';

  var open = null;      /* only one dialog at a time */

  /**
   * Ask before doing something.
   *
   * o: { title, body, confirmLabel, cancelLabel, tone: 'danger' | 'default' }
   * Resolves true when confirmed, false when dismissed any other way.
   */
  function confirm(o) {
    return new Promise(function (resolve) {
      if (open) open.close(false);

      var opener = document.activeElement;
      var tone = o.tone === 'danger' ? 'danger' : 'default';

      var root = document.createElement('div');
      root.className = 'a-modal';
      root.innerHTML =
        '<div class="a-modal__scrim" data-modal-cancel></div>' +
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
        '</div>';

      document.body.appendChild(root);
      ZB.util.lockScroll(true);

      var box = root.querySelector('.a-modal__box');

      function focusable() {
        return Array.prototype.slice.call(
          box.querySelectorAll('button:not([disabled]), a[href], input, select, textarea')
        );
      }

      function close(answer) {
        if (open !== api) return;
        open = null;

        document.removeEventListener('keydown', onKey, true);
        ZB.util.lockScroll(false);
        if (root.parentNode) root.parentNode.removeChild(root);

        /* Put the keyboard back where it was. */
        if (opener && document.body.contains(opener)) opener.focus();
        resolve(answer);
      }

      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); close(false); return; }
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

      root.addEventListener('click', function (e) {
        if (e.target.closest('[data-modal-cancel]')) { close(false); return; }
        if (e.target.closest('[data-modal-confirm]')) { close(true); }
      });

      document.addEventListener('keydown', onKey, true);

      var api = { close: close };
      open = api;

      /* Cancel takes focus, never the destructive button: arriving and
         pressing Enter must not be how something gets deleted. */
      root.querySelector('[data-modal-cancel]:not(.a-modal__scrim)').focus();
    });
  }

  ZB.adminModal = { confirm: confirm };

}(window.ZB));
