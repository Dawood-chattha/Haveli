/* =========================================================================
   pages/login.js — the owner sign-in screen
   -------------------------------------------------------------------------
   Renders without the panel chrome: admin-shell.js hides the sidebar and
   topbar on this route, because showing the panel behind the screen that is
   supposed to guard it makes no sense.

   The form talks only to ZB.adminAuth. It knows nothing about how anyone is
   verified, which is what lets a real service be connected there without
   this file changing.

   NOTHING HERE SIGNS ANYONE IN, and the screen says so. See admin-auth.js.

   THE STATES THIS SCREEN HAS TO GET RIGHT
     idle       both fields empty, submit available
     invalid    per-field message under the field that caused it
     loading    submit disabled and labelled, fields locked, no double send
     failed     a form-level message the screen reader is told about
     succeeded  moves to the dashboard

   Applied from the UI guidance consulted for this screen, highest severity
   first:
     - Every input has a visible label, never a placeholder standing in for
       one, and every error sits under its own field and is tied to it with
       aria-describedby.
     - The form-level message is role="alert" so it is announced rather than
       only seen.
     - Errors carry an icon and words, never colour alone.
     - Submit disables itself while in flight, so a slow answer cannot be
       sent twice.
     - Focus is always visible, tab order follows the page, and the whole
       form works without a pointer.
     - Motion is transform and opacity only, and stops entirely under
       prefers-reduced-motion.
   ========================================================================= */

window.ZB = window.ZB || {};
window.ZB.adminPages = window.ZB.adminPages || {};

(function (ZB) {
  'use strict';

  var ui = ZB.adminUI;

  /* Which field each control belongs to, so one handler serves both. */
  var FIELDS = ['email', 'password'];

  /**
   * One labelled field with its own error slot.
   *
   * o: { name, label, type, autocomplete, hint, trailing }
   */
  function field(o) {
    var id = 'admin-' + o.name;
    var errorId = id + '-error';

    return '' +
      '<div class="auth__field" data-field="' + o.name + '">' +
        '<label class="auth__label" for="' + id + '">' + ui.esc(o.label) + '</label>' +

        '<div class="auth__control">' +
          '<input class="auth__input" id="' + id + '" name="' + o.name + '"' +
                ' type="' + o.type + '"' +
                ' autocomplete="' + o.autocomplete + '"' +
                ' spellcheck="false"' +
                ' required' +
                /* Points at the error slot from the start: the browser reads
                   it when the message appears, and an empty slot says
                   nothing, so there is no need to add and remove it. */
                ' aria-describedby="' + errorId + '">' +
          (o.trailing || '') +
        '</div>' +

        '<p class="auth__error" id="' + errorId + '" hidden>' +
          '<span class="auth__error-icon" aria-hidden="true">' +
            '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.6"/>' +
            '<path d="M8 4.8v3.6"/><path d="M8 11.1v.1"/></svg>' +
          '</span>' +
          '<span class="auth__error-text"></span>' +
        '</p>' +
      '</div>';
  }

  ZB.adminPages.login = {

    title: 'Sign in',
    crumbs: [],

    render: function () {
      var showHide =
        '<button class="auth__reveal" type="button" data-reveal' +
               ' aria-pressed="false" aria-controls="admin-password">' +
          '<span class="auth__reveal-label">Show</span>' +
        '</button>';

      return '' +
      '<div class="auth">' +

        /* ---- brand side ---- */
        '<aside class="auth__brand" aria-hidden="true">' +
          '<div class="auth__brand-inner">' +
            '<span class="auth__mark">H</span>' +
            '<p class="auth__wordmark">HAVELI</p>' +
            '<p class="auth__tagline">Store management</p>' +
          '</div>' +
          '<p class="auth__brand-foot">Real fashion, real prices.</p>' +
        '</aside>' +

        /* ---- form side ---- */
        '<main class="auth__panel">' +
          '<form class="auth__form" id="admin-login" novalidate>' +

            /* Repeats the mark for small screens, where the brand side is
               not rendered at all. */
            '<span class="auth__mark auth__mark--compact" aria-hidden="true">H</span>' +

            '<h1 class="auth__title">Sign in</h1>' +
            '<p class="auth__sub">Manage products, orders and customers.</p>' +

            /* Form-level failures. role="alert" means it is announced the
               moment it is filled in, without moving focus. */
            '<div class="auth__alert" id="admin-login-alert" role="alert" hidden>' +
              '<span class="auth__alert-icon" aria-hidden="true">' +
                '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.6"/>' +
                '<path d="M8 4.8v3.6"/><path d="M8 11.1v.1"/></svg>' +
              '</span>' +
              '<span class="auth__alert-text"></span>' +
            '</div>' +

            field({
              name: 'email',
              label: 'Email address',
              type: 'email',
              autocomplete: 'username'
            }) +

            field({
              name: 'password',
              label: 'Password',
              type: 'password',
              autocomplete: 'current-password',
              trailing: showHide
            }) +

            /* Warns rather than fails: the commonest reason a correct
               password is rejected. Announced politely so it does not
               interrupt typing. */
            '<p class="auth__caps" id="admin-caps" role="status" hidden>' +
              'Caps Lock is on.' +
            '</p>' +

            '<div class="auth__row">' +
              '<label class="auth__check">' +
                '<input type="checkbox" id="admin-remember" name="remember">' +
                '<span class="auth__check-box" aria-hidden="true">' +
                  '<svg viewBox="0 0 16 16"><path d="m3.5 8.4 3 3 6-6.4"/></svg>' +
                '</span>' +
                '<span>Keep me signed in</span>' +
              '</label>' +

              '<button class="auth__forgot" type="button" data-forgot' +
                     ' aria-expanded="false" aria-controls="admin-forgot">' +
                'Forgot password?' +
              '</button>' +
            '</div>' +

            '<p class="auth__forgot-note" id="admin-forgot" hidden>' +
              'Password recovery needs an authentication service, and none is ' +
              'connected in this build. Once one is, this is where the reset ' +
              'email would be requested.' +
            '</p>' +

            '<button class="auth__submit" type="submit" data-submit>' +
              '<span class="auth__submit-label">Sign in</span>' +
              '<span class="auth__spinner" aria-hidden="true"></span>' +
            '</button>' +

            '<p class="auth__note">' +
              '<strong>This form does not sign anyone in.</strong> There is no ' +
              'authentication in this build and the panel is not protected — ' +
              'anyone with the address can open it. No password is checked, ' +
              'sent or stored.' +
            '</p>' +

            '<a class="auth__back" href="/" data-full-load>Back to the store</a>' +

          '</form>' +
        '</main>' +

      '</div>';
    },

    /* -----------------------------------------------------------------
       Behaviour
       ----------------------------------------------------------------- */

    mount: function () {
      var form = document.getElementById('admin-login');
      if (!form) return;

      var email = document.getElementById('admin-email');
      var password = document.getElementById('admin-password');
      var submit = form.querySelector('[data-submit]');
      var alertBox = document.getElementById('admin-login-alert');
      var caps = document.getElementById('admin-caps');
      var busy = false;

      /* ---- error plumbing ---- */

      function setFieldError(name, message) {
        var group = form.querySelector('[data-field="' + name + '"]');
        if (!group) return;

        var input = group.querySelector('.auth__input');
        var slot = group.querySelector('.auth__error');

        group.classList.toggle('is-invalid', !!message);
        input.setAttribute('aria-invalid', message ? 'true' : 'false');

        slot.querySelector('.auth__error-text').textContent = message || '';
        slot.hidden = !message;
      }

      function clearErrors() {
        FIELDS.forEach(function (name) { setFieldError(name, ''); });
        alertBox.hidden = true;
        alertBox.querySelector('.auth__alert-text').textContent = '';
      }

      function showAlert(message) {
        /* Emptying first makes the alert a fresh insertion, so it is
           announced again when the same message repeats. */
        alertBox.querySelector('.auth__alert-text').textContent = '';
        alertBox.hidden = false;
        alertBox.querySelector('.auth__alert-text').textContent = message;
      }

      /* ---- validation ---- */

      /** Check one field on blur, but never scold an untouched empty one. */
      function checkOnBlur(name, input) {
        if (!input.value) { setFieldError(name, ''); return; }

        var errors = ZB.adminAuth.validate(
          name === 'email' ? input.value : email.value,
          name === 'password' ? input.value : password.value
        );
        setFieldError(name, errors[name] || '');
      }

      FIELDS.forEach(function (name) {
        var input = document.getElementById('admin-' + name);

        input.addEventListener('blur', function () { checkOnBlur(name, input); });

        /* Typing is an attempt to fix it; stop showing the complaint. */
        input.addEventListener('input', function () {
          if (form.querySelector('[data-field="' + name + '"]').classList.contains('is-invalid')) {
            setFieldError(name, '');
          }
          if (!alertBox.hidden) alertBox.hidden = true;
        });
      });

      /* ---- caps lock ---- */

      function updateCaps(e) {
        if (typeof e.getModifierState !== 'function') return;
        caps.hidden = !e.getModifierState('CapsLock');
      }

      password.addEventListener('keydown', updateCaps);
      password.addEventListener('keyup', updateCaps);
      password.addEventListener('blur', function () { caps.hidden = true; });

      /* ---- show / hide password ---- */

      var reveal = form.querySelector('[data-reveal]');
      reveal.addEventListener('click', function () {
        var shown = password.type === 'text';
        password.type = shown ? 'password' : 'text';
        reveal.setAttribute('aria-pressed', String(!shown));
        reveal.querySelector('.auth__reveal-label').textContent = shown ? 'Show' : 'Hide';

        /* Returning the caret keeps the keyboard flow unbroken. */
        password.focus();
        var end = password.value.length;
        try { password.setSelectionRange(end, end); } catch (err) { /* not all types allow it */ }
      });

      /* ---- forgot password ---- */

      var forgot = form.querySelector('[data-forgot]');
      var forgotNote = document.getElementById('admin-forgot');
      forgot.addEventListener('click', function () {
        var open = forgotNote.hidden;
        forgotNote.hidden = !open;
        forgot.setAttribute('aria-expanded', String(open));
      });

      /* ---- submit ---- */

      function setBusy(on) {
        busy = on;
        submit.disabled = on;
        submit.classList.toggle('is-busy', on);
        submit.querySelector('.auth__submit-label').textContent = on ? 'Signing in' : 'Sign in';
        /* Announces the wait to a screen reader, which cannot see a spinner. */
        submit.setAttribute('aria-busy', String(on));
        email.readOnly = on;
        password.readOnly = on;
      }

      form.addEventListener('submit', function (e) {
        e.preventDefault();
        if (busy) return;                      /* no double send */

        clearErrors();

        var errors = ZB.adminAuth.validate(email.value, password.value);
        var names = Object.keys(errors);

        if (names.length) {
          names.forEach(function (name) { setFieldError(name, errors[name]); });
          /* Send focus to the first thing that needs fixing. */
          document.getElementById('admin-' + names[0]).focus();
          return;
        }

        setBusy(true);

        ZB.adminAuth
          .signIn(email.value, password.value, document.getElementById('admin-remember').checked)
          .then(function () {
            /* Left busy on purpose: the route change is the confirmation,
               and re-enabling the button first would flash it live for a
               frame. */
            ZB.router.navigate('/admin');
          })
          .catch(function (failure) {
            setBusy(false);

            if (failure && failure.fields) {
              Object.keys(failure.fields).forEach(function (name) {
                setFieldError(name, failure.fields[name]);
              });
            }

            showAlert((failure && failure.message) || 'Something went wrong. Try again.');
          });
      });

      /* Nothing is filled in, so start where the work starts. */
      email.focus();
    }
  };

}(window.ZB));
