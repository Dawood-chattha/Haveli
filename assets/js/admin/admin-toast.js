/* =========================================================================
   admin-toast.js — brief confirmations
   -------------------------------------------------------------------------
   An action that completes silently reads as an action that failed, so
   every write in the panel says so afterwards.

   Announcing it matters as much as showing it. A success uses role="status"
   (polite: it waits for a pause), a failure uses role="alert" (assertive:
   it interrupts), and both live in a region that exists before the message
   does — a live region inserted at the same moment as its text is often
   missed entirely.

   Toasts are for confirming something that already happened. Anything the
   reader must act on belongs in the page, not in a message that leaves.
   ========================================================================= */

window.ZB = window.ZB || {};

(function (ZB) {
  'use strict';

  var HOST_ID = 'admin-toasts';
  var LIFETIME = 4200;

  function host() {
    var el = document.getElementById(HOST_ID);
    if (el) return el;

    el = document.createElement('div');
    el.id = HOST_ID;
    el.className = 'a-toasts';
    document.body.appendChild(el);
    return el;
  }

  var ICONS = {
    success: '<path d="M3.5 8.4 6.5 11.4 12.5 5"/>',
    error: '<circle cx="8" cy="8" r="6.6"/><path d="M8 4.8v3.6"/><path d="M8 11.1v.1"/>',
    info: '<circle cx="8" cy="8" r="6.6"/><path d="M8 7.4v4"/><path d="M8 4.8v.1"/>'
  };

  /**
   * Show a toast.
   *
   * o: { kind: 'success' | 'error' | 'info', text, action: { label, onClick } }
   *
   * `action` is how a destructive change offers a way back. An undo that
   * disappears with the toast is worth having anyway: it is there in the
   * seconds when the mistake is realised.
   */
  function show(o) {
    var kind = ICONS[o.kind] ? o.kind : 'info';

    var toast = document.createElement('div');
    toast.className = 'a-toast a-toast--' + kind;
    /* Errors interrupt; confirmations wait their turn. */
    toast.setAttribute('role', kind === 'error' ? 'alert' : 'status');

    toast.innerHTML =
      '<span class="a-toast__icon" aria-hidden="true">' +
        '<svg viewBox="0 0 16 16">' + ICONS[kind] + '</svg>' +
      '</span>' +
      '<span class="a-toast__text">' + ZB.ui.esc(o.text) + '</span>' +
      (o.action ? '<button class="a-toast__action" type="button">' +
                    ZB.ui.esc(o.action.label) + '</button>' : '') +
      '<button class="a-toast__close" type="button" aria-label="Dismiss">' +
        '<svg viewBox="0 0 16 16" aria-hidden="true">' +
          '<path d="M4 4l8 8M12 4l-8 8"/>' +
        '</svg>' +
      '</button>';

    var timer = null;

    function dismiss() {
      if (timer) window.clearTimeout(timer);
      toast.classList.add('is-leaving');
      /* Remove after the exit, or on the next frame if motion is off. */
      window.setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, ZB.reduceMotion ? 0 : 200);
    }

    toast.querySelector('.a-toast__close').addEventListener('click', dismiss);

    if (o.action) {
      toast.querySelector('.a-toast__action').addEventListener('click', function () {
        dismiss();
        o.action.onClick();
      });
    }

    /* Reading it should not be a race — hovering holds it open. */
    toast.addEventListener('mouseenter', function () {
      if (timer) { window.clearTimeout(timer); timer = null; }
    });
    toast.addEventListener('mouseleave', function () {
      timer = window.setTimeout(dismiss, LIFETIME);
    });

    /* Same for keyboard focus: a toast must not vanish mid-Tab. */
    toast.addEventListener('focusin', function () {
      if (timer) { window.clearTimeout(timer); timer = null; }
    });

    host().appendChild(toast);
    timer = window.setTimeout(dismiss, LIFETIME);

    return { dismiss: dismiss };
  }

  ZB.adminToast = {
    show: show,
    success: function (text, action) { return show({ kind: 'success', text: text, action: action }); },
    error: function (text) { return show({ kind: 'error', text: text }); },
    info: function (text, action) { return show({ kind: 'info', text: text, action: action }); }
  };

}(window.ZB));
