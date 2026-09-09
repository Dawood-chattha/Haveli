/* =========================================================================
   admin-fields.js — the form controls every admin form is built from
   -------------------------------------------------------------------------
   The product form grew its own set of field builders while it was the only
   form in the panel. Categories is the second, and banners, coupons and
   settings are still to come; five private copies of "a label, a control,
   a help line and an error line" would drift apart, and the first thing to
   drift is always the accessibility wiring nobody re-reads.

   So the builders live here once and every form asks for its own set:

     var f = ZB.adminFields.make('cat');     // ids become cat-name, cat-slug
     f.text({ name: 'title', label: 'Title', value: row.title });

   The prefix is the only thing that differs between forms, and it exists
   because two forms can be in the document at the same time — the category
   dialog opens over the category list — and duplicate ids would point every
   label at whichever control the browser found first.

   WHAT EVERY FIELD GUARANTEES
     - A real <label>, visible, tied to the control by `for`. Never a
       placeholder standing in for a label.
     - An error line that exists in the markup before it has anything to
       say, and is referenced by aria-describedby from the start. A live
       region added at the same moment as its text is routinely missed.
     - Help text, where given, is also in aria-describedby, so the reason
       for a rule is read out with the field rather than after it.

   ESCAPING
     Same rule as the rest of the panel: everything rendered here goes
     through esc(). These builders take values from data and from the URL.
   ========================================================================= */

window.ZB = window.ZB || {};

(function (ZB) {
  'use strict';

  var ui = ZB.adminUI;

  /**
   * A set of builders that all prefix their ids with `prefix`.
   */
  function make(prefix) {

    function idFor(name) { return prefix + '-' + name; }

    /** error id first: it is the one that changes, so it is read last. */
    function describedBy(name, help) {
      return idFor(name) + '-error' + (help ? ' ' + idFor(name) + '-help' : '');
    }

    /**
     * The shell around any single control: label, help, control, error.
     * `data-field` is how setError finds the group again.
     */
    function wrap(name, label, control, help) {
      var id = idFor(name);
      return '' +
        '<div class="a-field" data-field="' + name + '">' +
          '<label class="a-field__label" for="' + id + '">' + ui.esc(label) + '</label>' +
          (help ? '<p class="a-field__help" id="' + id + '-help">' + ui.esc(help) + '</p>' : '') +
          control +
          '<p class="a-field__error" id="' + id + '-error" hidden></p>' +
        '</div>';
    }

    /**
     * o: { name, label, value, type, help, min, step, prefix, placeholder }
     * `prefix` here is a unit shown inside the control (Rs, %), not the id
     * prefix — it renders as a fixed affix rather than as placeholder text.
     */
    function text(o) {
      var id = idFor(o.name);

      var control = '<input class="a-input" id="' + id + '" name="' + o.name + '"' +
        ' type="' + (o.type || 'text') + '"' +
        (o.value !== undefined && o.value !== null ? ' value="' + ui.esc(o.value) + '"' : '') +
        (o.min !== undefined ? ' min="' + ui.esc(o.min) + '"' : '') +
        (o.max !== undefined ? ' max="' + ui.esc(o.max) + '"' : '') +
        (o.step ? ' step="' + ui.esc(o.step) + '"' : '') +
        (o.placeholder ? ' placeholder="' + ui.esc(o.placeholder) + '"' : '') +
        /* readonly rather than disabled: a disabled input is skipped by the
           keyboard and not read out, and this is a value worth reading. */
        (o.readonly ? ' readonly' : '') +
        ' autocomplete="off" aria-describedby="' + describedBy(o.name, o.help) + '">';

      if (o.prefix) {
        control = '<span class="a-input__group">' +
                    '<span class="a-input__prefix">' + ui.esc(o.prefix) + '</span>' +
                    control +
                  '</span>';
      }

      return wrap(o.name, o.label, control, o.help);
    }

    /** o: { name, label, value, help, rows } */
    function area(o) {
      var id = idFor(o.name);

      return wrap(o.name, o.label,
        '<textarea class="a-input a-input--area" id="' + id + '" name="' + o.name + '"' +
                  ' rows="' + (o.rows || 4) + '"' +
                  ' aria-describedby="' + describedBy(o.name, o.help) + '">' +
          ui.esc(o.value || '') +
        '</textarea>', o.help);
    }

    /** o: { name, label, value, options: [{id,label}], help } */
    function select(o) {
      var id = idFor(o.name);

      var options = o.options.map(function (item) {
        return '<option value="' + ui.esc(item.id) + '"' +
               (String(item.id) === String(o.value) ? ' selected' : '') + '>' +
               ui.esc(item.label) + '</option>';
      }).join('');

      return wrap(o.name, o.label,
        '<span class="a-select a-select--block">' +
          '<select class="a-select__input" id="' + id + '" name="' + o.name + '"' +
                  ' aria-describedby="' + describedBy(o.name, o.help) + '">' + options + '</select>' +
          '<span class="a-select__arrow" aria-hidden="true">' + ui.icon('chevron') + '</span>' +
        '</span>', o.help);
    }

    /**
     * A set of chips backed by real checkboxes.
     *
     * The input keeps every keyboard behaviour a checkbox has and stays in
     * the accessibility tree; only its appearance is replaced. A fieldset
     * with a legend, so the group has a name of its own.
     *
     * o: { name, label, options: [string], value: [string], help }
     */
    function chips(o) {
      var boxes = o.options.map(function (value, i) {
        var id = idFor(o.name) + '-' + i;
        var on = (o.value || []).indexOf(value) > -1;

        return '' +
          '<label class="a-chipbox">' +
            '<input type="checkbox" id="' + id + '" name="' + o.name + '"' +
                  ' value="' + ui.esc(value) + '"' + (on ? ' checked' : '') + '>' +
            '<span class="a-chipbox__face">' + ui.esc(value) + '</span>' +
          '</label>';
      }).join('');

      return '' +
        '<fieldset class="a-field a-field--set" data-field="' + o.name + '">' +
          '<legend class="a-field__label">' + ui.esc(o.label) + '</legend>' +
          (o.help ? '<p class="a-field__help">' + ui.esc(o.help) + '</p>' : '') +
          '<div class="a-chipset">' + boxes + '</div>' +
          '<p class="a-field__error" id="' + idFor(o.name) + '-error" hidden></p>' +
        '</fieldset>';
    }

    /** o: { name, label, value, help } — a checkbox drawn as a switch. */
    function toggle(o) {
      return '' +
        '<div class="a-field a-field--inline" data-field="' + o.name + '">' +
          '<label class="a-switch">' +
            '<input type="checkbox" id="' + idFor(o.name) + '" name="' + o.name + '"' +
                  (o.value ? ' checked' : '') + '>' +
            '<span class="a-switch__track" aria-hidden="true">' +
              '<span class="a-switch__knob"></span>' +
            '</span>' +
            '<span class="a-switch__text">' +
              '<span class="a-switch__label">' + ui.esc(o.label) + '</span>' +
              (o.help ? '<span class="a-switch__help">' + ui.esc(o.help) + '</span>' : '') +
            '</span>' +
          '</label>' +
        '</div>';
    }

    /* -------------------------------------------------------------------
       Errors

       Shown against the field they belong to, not gathered at the top of
       the form. A summary at the top makes the reader match a message to a
       control themselves, and on a long form they scroll away from it to
       do so.
       ------------------------------------------------------------------- */

    /** Set or clear one field's error. An empty message clears it. */
    function setError(root, name, message) {
      if (!root) return;

      var group = root.querySelector('[data-field="' + name + '"]');
      var line = root.querySelector('#' + idFor(name) + '-error');
      var control = root.querySelector('#' + idFor(name));

      if (group) group.classList.toggle('is-invalid', !!message);
      if (line) {
        line.textContent = message || '';
        line.hidden = !message;
      }
      /* aria-invalid is what a screen reader announces on entering the
         field; the visible line alone would not reach it. */
      if (control) {
        if (message) control.setAttribute('aria-invalid', 'true');
        else control.removeAttribute('aria-invalid');
      }
    }

    function clearErrors(root) {
      if (!root) return;
      ZB.util.all('[data-field]', root).forEach(function (group) {
        setError(root, group.getAttribute('data-field'), '');
      });
    }

    /**
     * Show a set of errors and put the cursor in the first one.
     * `errors` is { fieldName: message }; `order` fixes which is "first",
     * because object key order is not the order on screen.
     */
    function showErrors(root, errors, order) {
      clearErrors(root);

      var names = order || Object.keys(errors);
      names.forEach(function (name) {
        if (errors[name]) setError(root, name, errors[name]);
      });

      var firstBad = names.filter(function (name) { return errors[name]; })[0];
      if (!firstBad) return;

      var control = root.querySelector('#' + idFor(firstBad)) ||
                    root.querySelector('[data-field="' + firstBad + '"] input');
      if (control) control.focus();
    }

    /** Trimmed string value of one control. */
    function valueOf(root, name) {
      var el = root && root.querySelector('#' + idFor(name));
      if (!el) return '';
      return el.type === 'checkbox' ? el.checked : String(el.value).trim();
    }

    /** Every checked value in a chip set. */
    function checkedValues(root, name) {
      return ZB.util.all('[name="' + name + '"]:checked', root).map(function (box) {
        return box.value;
      });
    }

    return {
      id: idFor,
      wrap: wrap,
      text: text,
      area: area,
      select: select,
      chips: chips,
      toggle: toggle,
      setError: setError,
      clearErrors: clearErrors,
      showErrors: showErrors,
      valueOf: valueOf,
      checkedValues: checkedValues
    };
  }

  ZB.adminFields = { make: make };

}(window.ZB));
