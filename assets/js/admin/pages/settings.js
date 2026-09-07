/* =========================================================================
   pages/settings.js — store, profile, notifications, appearance
   -------------------------------------------------------------------------
   THE SCREEN MOST LIKELY TO BECOME A DRAWER
   "Settings" is where everything that fits nowhere else gets dropped, and
   the result is a page nobody can find anything on. So this one is four
   named groups and stays four: the shop's own details, the person signed
   in, what is worth being told about, and how the panel is drawn. Anything
   that is not one of those does not belong here.

   FOUR GROUPS, FOUR SAVES, NOT ONE
   They are saved separately because they fail separately. Fixing the
   support address and preferring a denser table are not one change, and a
   single Save across the page would ship the second with the first — and
   would make one bad email address block a change to the stock threshold
   that has nothing to do with it. Each card knows whether it is dirty and
   only its own button lights up.

   THE PART THAT MATTERS MOST: SAYING WHAT ACTUALLY HAPPENS
   In a build with no server, most of a settings screen cannot do anything.
   Hiding that is the worst thing this page could do — a switch labelled
   "email me when an order arrives" that quietly sends nothing is not a
   half-built feature, it is a false statement about the shop. So every
   card carries a mark:

     In force        the change takes effect the moment it is saved
     Partly in force some fields work, and the card names which
     Recorded only   the choice is kept and shown, and nothing acts on it

   and the fields that do work say so on the field itself.

   THE THREE THINGS THIS PAGE REFUSES TO DRAW
     - A password field. There is no authentication service, so a password
       typed here would go into a variable and nowhere else. A credential
       collected by a form that cannot use it is worse than no form.
     - An editable role. Whatever a frontend writes into a field called
       "role" is a word on a screen, never a permission — permission is
       decided where the data lives, by a service that checks who is asking.
     - A currency selector. Every price in the catalogue is a number of
       rupees; changing the code would relabel the same numbers, so a
       14,500 kurta would read as $14,500. That is a migration, not a
       setting, and the field says so instead of offering it.

   Applied from the UI guidance consulted for these screens:
     - Visible labels, help text where a field is not self-evident, and the
       error under its own field tied by aria-describedby (#8, #54, #55).
     - Save is disabled until there is something to save, then busy, then
       confirms (#32, #61, #83).
     - Appearance applies immediately rather than behind a Save, because a
       density you cannot see until you commit to it is chosen blind.
   ========================================================================= */

window.ZB = window.ZB || {};
window.ZB.adminPages = window.ZB.adminPages || {};

(function (ZB) {
  'use strict';

  var ui = ZB.adminUI;

  /* One field-builder set per card. The prefix keeps the ids apart — four
     forms are on screen at once and two "name" fields would otherwise share
     an id, which points both labels at whichever the browser found first. */
  var f = {
    store: ZB.adminFields.make('set-store'),
    profile: ZB.adminFields.make('set-prof'),
    notifications: ZB.adminFields.make('set-note')
  };

  /* What each card was showing when it was last saved or loaded. Dirtiness
     is this compared against the form, not a flag set by an input handler:
     a flag stays on after somebody types a character and deletes it again,
     and then the Save button is lit for a change that is not there. */
  var saved = { store: null, profile: null, notifications: null };

  /* Deliberately permissive, and the same shape the sign-in form uses. An
     address check is a typo catcher, not a gate — the only authority on
     whether an address is real is the service that delivers to it. */
  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  /* -----------------------------------------------------------------------
     Small pieces
     ----------------------------------------------------------------------- */

  var EFFECTS = {
    live: { label: 'In force', title: 'Saving this changes what the panel does.' },
    part: { label: 'Partly in force', title: 'Some fields here take effect; the card says which.' },
    recorded: { label: 'Recorded only', title: 'Kept and shown. Nothing acts on it in this build.' }
  };

  function effectMark(kind) {
    var e = EFFECTS[kind] || EFFECTS.recorded;
    return '<span class="a-effect a-effect--' + kind + '" title="' + ui.esc(e.title) + '">' +
             ui.esc(e.label) +
           '</span>';
  }

  /**
   * A value that is shown and cannot be changed, with the reason.
   *
   * Not a disabled input. A greyed-out control invites the reader to work
   * out how to enable it; a plain row with a sentence under it answers the
   * question instead.
   */
  function readOnly(o) {
    return '' +
      '<div class="a-readonly">' +
        '<p class="a-readonly__label">' + ui.esc(o.label) + '</p>' +
        '<p class="a-readonly__value">' + ui.esc(o.value) + '</p>' +
        '<p class="a-readonly__note">' + ui.esc(o.note) + '</p>' +
      '</div>';
  }

  /**
   * An exclusive choice as real radios, each with its own explanation.
   *
   * A select would hide the notes, and the notes are the content here —
   * "Compact" means nothing until it says what it does to the rows.
   */
  function choice(o) {
    var options = o.options.map(function (item, i) {
      var id = o.name + '-' + item.id;
      return '' +
        '<label class="a-choice" for="' + id + '">' +
          '<input class="a-choice__input" type="radio" id="' + id + '"' +
                ' name="' + ui.esc(o.name) + '" value="' + ui.esc(item.id) + '"' +
                (String(item.id) === String(o.value) ? ' checked' : '') + '>' +
          '<span class="a-choice__body">' +
            '<span class="a-choice__label">' + ui.esc(item.label) + '</span>' +
            '<span class="a-choice__note">' + ui.esc(item.note || '') + '</span>' +
          '</span>' +
        '</label>';
    }).join('');

    return '' +
      '<fieldset class="a-field a-field--set">' +
        '<legend class="a-field__label">' + ui.esc(o.label) + '</legend>' +
        '<div class="a-choices">' + options + '</div>' +
      '</fieldset>';
  }

  /**
   * The frame every card shares.
   * o: { id, title, icon, effect, blurb, body, foot }
   */
  function card(o) {
    return '' +
      '<section class="a-card a-set__card" id="a-set-' + o.id + '">' +
        '<header class="a-card__head">' +
          '<h2 class="a-card__title">' +
            '<span class="a-set__icon" aria-hidden="true">' + ui.icon(o.icon) + '</span>' +
            ui.esc(o.title) +
          '</h2>' +
          '<div class="a-card__aside">' + effectMark(o.effect) + '</div>' +
        '</header>' +
        '<div class="a-card__body">' +
          '<p class="a-set__blurb">' + o.blurb + '</p>' +
          o.body +
        '</div>' +
        (o.foot || '') +
      '</section>';
  }

  /** The save row a card gets when it has something to save. */
  function saveRow(id, label) {
    return '' +
      '<footer class="a-set__foot">' +
        '<p class="a-set__state" id="a-set-' + id + '-state" role="status"></p>' +
        '<div class="a-set__actions">' +
          '<button class="a-btn a-btn--ghost" type="button" data-set-reset="' + id + '">' +
            'Undo changes' +
          '</button>' +
          '<button class="a-btn a-btn--primary" type="submit" form="a-set-' + id + '-form"' +
                 ' data-set-save="' + id + '" disabled>' +
            '<span class="a-btn__label">' + ui.esc(label) + '</span>' +
            '<span class="a-btn__spinner" aria-hidden="true"></span>' +
          '</button>' +
        '</div>' +
      '</footer>';
  }

  /* -----------------------------------------------------------------------
     The cards
     ----------------------------------------------------------------------- */

  function storeCard(record) {
    var money = ZB.repo.settings.currency();
    var s = record.store;

    var body = '' +
      '<form class="a-set__form" id="a-set-store-form" novalidate>' +
        f.store.text({ name: 'name', label: 'Store name', value: s.name }) +
        f.store.text({ name: 'tagline', label: 'Tagline', value: s.tagline,
                     help: 'One line. It sits under the name wherever the shop is introduced.' }) +

        '<div class="a-form__row">' +
          f.store.text({ name: 'supportEmail', label: 'Support email', type: 'email',
                       value: s.supportEmail,
                       help: 'Where customers reply. Nothing is sent from it in this build.' }) +
          /* Both halves of a paired row carry a help line, or neither does.
             One of the two explained leaves its input sitting a line lower
             than its partner's, and the row stops reading as a row. */
          f.store.text({ name: 'phone', label: 'Phone', value: s.phone,
                       help: 'Shown wherever customers are told how to reach the shop.' }) +
        '</div>' +

        '<div class="a-form__row">' +
          f.store.text({ name: 'address', label: 'Address', value: s.address }) +
          f.store.text({ name: 'city', label: 'City', value: s.city }) +
        '</div>' +

        '<hr class="a-set__rule">' +

        f.store.text({ name: 'lowStockAt', label: 'Low stock at', type: 'number',
                     min: 1, max: 999, step: '1', value: s.lowStockAt,
                     help: 'This one is live. A product with fewer than this many ' +
                           'left is marked as running low on the product list and ' +
                           'on the inventory screen. Products already at zero are ' +
                           'counted separately and are not affected by it.' }) +

        readOnly({
          label: 'Currency',
          value: money.label + ' (' + money.code + ')',
          note: 'Fixed. Every price in the catalogue is a number of rupees, so ' +
                'changing the code would relabel the same numbers rather than ' +
                'convert them — a 14,500 kurta would read as 14,500 of something ' +
                'else. Changing currency means converting every price at a rate ' +
                'somebody supplies, which is a migration and not a setting.'
        }) +
      '</form>';

    return card({
      id: 'store', title: 'Store', icon: 'store', effect: 'part',
      blurb: 'The shop’s own details, and the stock level that counts as low. ' +
             '<strong>Low stock at</strong> takes effect across the panel; the ' +
             'details above it are recorded and wait for a backend to use them.',
      body: body,
      foot: saveRow('store', 'Save store details')
    });
  }

  function profileCard(record) {
    var p = record.profile;

    var body = '' +
      '<form class="a-set__form" id="a-set-profile-form" novalidate>' +
        '<div class="a-form__row">' +
          f.profile.text({ name: 'name', label: 'Name', value: p.name,
                         help: 'This one is live — the sidebar redraws from it.' }) +
          f.profile.text({ name: 'email', label: 'Email address', type: 'email',
                         value: p.email,
                         help: 'The address the account would sign in with.' }) +
        '</div>' +

        readOnly({
          label: 'Role',
          value: p.role,
          note: 'Not editable here, and it never will be. A role this page could ' +
                'set would be a word on a screen rather than a permission — what ' +
                'an account may actually do has to be decided where the data ' +
                'lives, by a service that checks who is asking on every read and ' +
                'write. Visiting this address must never be what makes somebody ' +
                'an administrator.'
        }) +

        readOnly({
          label: 'Password',
          value: 'Managed by the sign-in service',
          note: 'There is no sign-in service in this build, so there is no ' +
                'password to change and no field to type one into. A password ' +
                'collected by a form that cannot use it would sit in the page ' +
                'and go nowhere, which is worse than not asking for it.'
        }) +
      '</form>';

    return card({
      id: 'profile', title: 'Profile', icon: 'users', effect: 'part',
      blurb: 'The account signed in to this panel. The name is in force; the ' +
             'two rows below it are shown so that what cannot be changed here ' +
             'is visible rather than missing.',
      body: body,
      foot: saveRow('profile', 'Save profile')
    });
  }

  function notificationsCard(record) {
    var n = record.notifications;

    var switches = ZB.repo.settings.events.map(function (event) {
      return f.notifications.toggle({
        name: event.id, label: event.label, value: !!n[event.id], help: event.help
      });
    }).join('');

    var body = '' +
      '<form class="a-set__form" id="a-set-notifications-form" novalidate>' +
        f.notifications.text({ name: 'sendTo', label: 'Send to', type: 'email',
                             value: n.sendTo,
                             help: 'The mailbox these would arrive in.' }) +

        '<hr class="a-set__rule">' +

        '<div class="a-set__switches">' + switches + '</div>' +
      '</form>';

    return card({
      id: 'notifications', title: 'Notifications', icon: 'bell', effect: 'recorded',
      blurb: 'What is worth being told about. Delivering any of these needs a ' +
             'mail or push service and there is none here, so these are choices ' +
             'kept for one to read — <strong>nothing is sent</strong>. That is ' +
             'said here rather than left to be discovered by not being told ' +
             'about an order.',
      body: body,
      foot: saveRow('notifications', 'Save notifications')
    });
  }

  /**
   * Appearance has no Save button.
   *
   * Everything in it is visible the instant it changes, and a density you
   * cannot see until you commit to it is chosen blind. A Save here would
   * add a step and take away the only thing that makes the choice
   * answerable, so each control applies itself and the card says so.
   */
  function appearanceCard() {
    var shell = ZB.adminShell;
    var look = shell.appearance || shell.readAppearance();

    /* Not `.a-set__form` — the three cards above are real forms with a
       dirty state and a Save, and the page's handlers key off that class.
       Sharing it here would have the page asking an appearance block
       whether it has unsaved changes, which it never can. */
    var body = '' +
      '<div class="a-set__look">' +
        choice({ name: 'a-set-density', label: 'Density', value: look.density,
               options: ZB.repo.settings.densities }) +

        choice({ name: 'a-set-sidebar', label: 'Sidebar',
               value: shell.collapsed ? 'collapsed' : 'expanded',
               options: ZB.repo.settings.sidebarModes }) +

        choice({ name: 'a-set-motion', label: 'Motion', value: look.motion,
               options: ZB.repo.settings.motions }) +
      '</div>' +

      '<p class="a-form__note">' +
        'These three are the only settings in the panel that survive a reload. ' +
        'They describe this browser rather than the shop, so they are kept on ' +
        'this device beside the sidebar’s open-or-closed state — no shop data ' +
        'and nothing about the account is stored with them. Everything else on ' +
        'this page is held in this tab only, because it belongs in a database ' +
        'and there is not one yet.' +
      '</p>';

    return card({
      id: 'appearance', title: 'Appearance', icon: 'sliders', effect: 'live',
      blurb: 'How this panel is drawn on this device. Each control applies as ' +
             'soon as it is chosen — there is nothing to save, because there is ' +
             'nothing here you cannot already see.',
      body: body,
      foot: '' +
        '<footer class="a-set__foot">' +
          '<p class="a-set__state" id="a-set-appearance-state" role="status"></p>' +
          '<div class="a-set__actions">' +
            '<button class="a-btn a-btn--ghost" type="button" data-set-look-reset>' +
              'Back to defaults' +
            '</button>' +
          '</div>' +
        '</footer>'
    });
  }

  /* -----------------------------------------------------------------------
     Reading the forms
     ----------------------------------------------------------------------- */

  function collect(id) {
    var form = document.getElementById('a-set-' + id + '-form');
    if (!form) return null;

    if (id === 'store') {
      return {
        name: f.store.valueOf(form, 'name'),
        tagline: f.store.valueOf(form, 'tagline'),
        supportEmail: f.store.valueOf(form, 'supportEmail'),
        phone: f.store.valueOf(form, 'phone'),
        address: f.store.valueOf(form, 'address'),
        city: f.store.valueOf(form, 'city'),
        lowStockAt: f.store.valueOf(form, 'lowStockAt')
      };
    }

    if (id === 'profile') {
      return {
        name: f.profile.valueOf(form, 'name'),
        email: f.profile.valueOf(form, 'email')
      };
    }

    var out = { sendTo: f.notifications.valueOf(form, 'sendTo') };
    ZB.repo.settings.events.forEach(function (event) {
      out[event.id] = f.notifications.valueOf(form, event.id) === true;
    });
    return out;
  }

  /** Same values, same string. Enough to answer "has anything changed". */
  function fingerprint(values) {
    if (!values) return '';
    return Object.keys(values).sort().map(function (key) {
      return key + '=' + values[key];
    }).join('|');
  }

  /* -----------------------------------------------------------------------
     Validation

     Every message names what to do rather than what went wrong: "Give the
     store a name", not "Name is required".
     ----------------------------------------------------------------------- */

  function validate(id, data) {
    var errors = {};

    if (id === 'store') {
      if (!data.name) errors.name = 'Give the store a name.';
      else if (data.name.length < 2) errors.name = 'That name is too short.';

      if (!data.supportEmail) errors.supportEmail = 'Give an address customers can reply to.';
      else if (!EMAIL.test(data.supportEmail)) {
        errors.supportEmail = 'That does not look like an email address.';
      }

      /* Optional, but a phone number that is only letters is a mistake
         somebody made, not a format this shop uses. */
      if (data.phone && !/\d/.test(data.phone)) {
        errors.phone = 'A phone number needs some digits.';
      }

      if (data.lowStockAt === '') errors.lowStockAt = 'Set the level a product counts as low at.';
      else if (!/^\d+$/.test(data.lowStockAt)) {
        errors.lowStockAt = 'Use a whole number of items.';
      } else if (Number(data.lowStockAt) < 1) {
        /* Zero would mean nothing is ever low: a product would go straight
           from fine to out of stock, and the warning that exists to give
           some notice would never appear. */
        errors.lowStockAt = 'Use at least 1 — at zero, nothing would ever be flagged before it ran out.';
      } else if (Number(data.lowStockAt) > 999) {
        errors.lowStockAt = 'That is higher than any stock level here, so everything would read as low.';
      }
    }

    if (id === 'profile') {
      if (!data.name) errors.name = 'Give the account a name.';
      else if (data.name.length < 2) errors.name = 'That name is too short.';

      if (!data.email) errors.email = 'Give the account an email address.';
      else if (!EMAIL.test(data.email)) {
        errors.email = 'That does not look like an email address.';
      }
    }

    if (id === 'notifications') {
      if (!data.sendTo) errors.sendTo = 'Give an address these would go to.';
      else if (!EMAIL.test(data.sendTo)) {
        errors.sendTo = 'That does not look like an email address.';
      }
    }

    return errors;
  }

  /* -----------------------------------------------------------------------
     State
     ----------------------------------------------------------------------- */

  function fieldsFor(id) {
    return id === 'store' ? f.store
         : id === 'profile' ? f.profile
         : f.notifications;
  }

  /** Light or dim one card's Save, and say why in its status line. */
  function refresh(id) {
    var save = document.querySelector('[data-set-save="' + id + '"]');
    var undo = document.querySelector('[data-set-reset="' + id + '"]');
    var state = document.getElementById('a-set-' + id + '-state');
    if (!save) return;

    var dirty = fingerprint(collect(id)) !== fingerprint(saved[id]);

    save.disabled = !dirty;
    if (undo) undo.disabled = !dirty;

    if (state) {
      state.textContent = dirty ? 'Unsaved changes in this section.' : '';
      state.classList.toggle('is-dirty', dirty);
    }
  }

  function setBusy(id, on, label) {
    var save = document.querySelector('[data-set-save="' + id + '"]');
    if (!save) return;
    save.disabled = on;
    save.classList.toggle('is-busy', on);
    save.setAttribute('aria-busy', String(on));
    save.querySelector('.a-btn__label').textContent = on ? 'Saving' : label;
  }

  /** Write one section's values back into its controls. */
  function fill(id, values) {
    var form = document.getElementById('a-set-' + id + '-form');
    var fields = fieldsFor(id);
    if (!form) return;

    Object.keys(values).forEach(function (key) {
      var el = document.getElementById(fields.id(key));
      if (!el) return;
      if (el.type === 'checkbox') el.checked = !!values[key];
      else el.value = values[key];
    });

    saved[id] = collect(id);
    fields.clearErrors(form);
    refresh(id);
  }

  /* -----------------------------------------------------------------------
     Saving
     ----------------------------------------------------------------------- */

  var LABELS = {
    store: 'Save store details',
    profile: 'Save profile',
    notifications: 'Save notifications'
  };

  function save(id) {
    var form = document.getElementById('a-set-' + id + '-form');
    var fields = fieldsFor(id);
    var data = collect(id);
    var errors = validate(id, data);
    var names = Object.keys(errors).filter(function (key) { return errors[key]; });

    fields.clearErrors(form);

    if (names.length) {
      fields.showErrors(form, errors, names);
      ZB.adminToast.error('Check the highlighted fields.');
      return;
    }

    setBusy(id, true, LABELS[id]);

    /* The one conversion this page does. Everything else is a string on the
       way in and a string on the way out; the threshold is a number that
       stock levels are compared against, and a string would compare as
       text — "9" < "40" is false, and every product would read as fine. */
    var payload = data;
    if (id === 'store') {
      payload = Object.keys(data).reduce(function (out, key) {
        out[key] = data[key];
        return out;
      }, {});
      payload.lowStockAt = Number(data.lowStockAt);
    }

    ZB.repo.settings.update(id, payload).then(function (result) {
      setBusy(id, false, LABELS[id]);
      saved[id] = collect(id);
      refresh(id);

      if (id === 'profile') {
        /* The sidebar is showing the old name until it is told. */
        ZB.adminShell.refreshUser();
        ZB.adminToast.success('Profile saved.');
        return;
      }

      if (id === 'store') {
        ZB.adminToast.success(
          'Store details saved. Products under ' + result.lowStockAt +
          ' now count as running low.');
        return;
      }

      ZB.adminToast.success('Notification choices saved.');
    }).catch(function (failure) {
      setBusy(id, false, LABELS[id]);
      ZB.adminToast.error((failure && failure.message) || 'That could not be saved.');
    });
  }

  /**
   * Undo the edits made since this card was last saved.
   *
   * Deliberately not "reset to defaults": somebody who typed into the wrong
   * field wants their last saved values back, not the values the panel
   * shipped with. Reaching the original defaults means saving nothing and
   * reloading, which this build does anyway.
   */
  function undo(id) {
    if (!saved[id]) return;
    fill(id, saved[id]);
    ZB.adminToast.success('Changes in that section undone.');
  }

  /* -----------------------------------------------------------------------
     Appearance
     ----------------------------------------------------------------------- */

  function sayLook(text) {
    var state = document.getElementById('a-set-appearance-state');
    if (state) state.textContent = text;
  }

  function onLookChange(e) {
    var input = e.target.closest('.a-choice__input');
    if (!input || !input.checked) return;

    if (input.name === 'a-set-density') {
      ZB.adminShell.setAppearance({ density: input.value });
      sayLook('Spacing set to ' + input.value + '.');
      return;
    }

    if (input.name === 'a-set-motion') {
      ZB.adminShell.setAppearance({ motion: input.value });
      sayLook(input.value === 'reduced'
        ? 'Animations switched off in the panel.'
        : 'Animations follow this device’s setting.');
      return;
    }

    if (input.name === 'a-set-sidebar') {
      /* The sidebar's state has one home — the shell — and this control
         drives it rather than keeping a copy. Below 990px the sidebar is a
         drawer and collapse does not apply, which is worth saying rather
         than letting the control look broken. */
      if (ZB.adminShell.isDrawerMode()) {
        sayLook('The sidebar is a drawer at this width; this applies on a wider screen.');
      } else {
        sayLook(input.value === 'collapsed' ? 'Sidebar collapsed.' : 'Sidebar expanded.');
      }
      ZB.adminShell.setCollapsed(input.value === 'collapsed');
    }
  }

  function resetLook() {
    var defaults = (ZB.adminSettings && ZB.adminSettings.appearance) || {};
    var density = defaults.density || 'comfortable';
    var motion = defaults.motion || 'system';

    ZB.adminShell.setAppearance({ density: density, motion: motion });
    ZB.adminShell.setCollapsed(false);

    var check = function (name, value) {
      var input = document.getElementById(name + '-' + value);
      if (input) input.checked = true;
    };
    check('a-set-density', density);
    check('a-set-motion', motion);
    check('a-set-sidebar', 'expanded');

    sayLook('Appearance back to defaults.');
    ZB.adminToast.success('Appearance back to defaults.');
  }

  /* -----------------------------------------------------------------------
     Wiring
     ----------------------------------------------------------------------- */

  function bind(host) {
    /* One delegated listener for the whole page rather than four per card:
       a card is never re-rendered on its own, and this cannot fall out of
       step with the markup. */
    host.addEventListener('input', function (e) {
      var form = e.target.closest('.a-set__form');
      if (!form) return;

      /* Typing is an attempt to fix it; stop showing the complaint. */
      var group = e.target.closest('.a-field');
      if (group && group.classList.contains('is-invalid')) {
        var id = form.id.replace(/^a-set-|-form$/g, '');
        fieldsFor(id).setError(form, group.getAttribute('data-field'), '');
      }

      refresh(form.id.replace(/^a-set-|-form$/g, ''));
    });

    host.addEventListener('change', function (e) {
      if (e.target.closest('.a-choice__input')) { onLookChange(e); return; }

      var form = e.target.closest('.a-set__form');
      if (form) refresh(form.id.replace(/^a-set-|-form$/g, ''));
    });

    host.addEventListener('click', function (e) {
      var reset = e.target.closest('[data-set-reset]');
      if (reset) { undo(reset.getAttribute('data-set-reset')); return; }

      if (e.target.closest('[data-set-look-reset]')) resetLook();
    });

    host.addEventListener('submit', function (e) {
      var form = e.target.closest('.a-set__form');
      if (!form) return;
      e.preventDefault();
      save(form.id.replace(/^a-set-|-form$/g, ''));
    });
  }

  /* -----------------------------------------------------------------------
     The page
     ----------------------------------------------------------------------- */

  ZB.adminPages.settings = {
    title: 'Settings',
    crumbs: [{ label: 'Settings' }],

    render: function () {
      return '' +
        ui.pageHead({
          title: 'Settings',
          sub: 'Store and account preferences.'
        }) +

        /* The vocabulary the cards are marked with, explained once, above
           them — not repeated on each card, and not left to be guessed. */
        '<div class="a-notice a-notice--quiet">' +
          ui.icon('warn') +
          '<p>' +
            'Each section says what it can actually do. ' +
            '<strong>In force</strong> means saving it changes the panel, ' +
            '<strong>partly in force</strong> means some of its fields do and the ' +
            'card names them, and <strong>recorded only</strong> means the choice ' +
            'is kept and nothing acts on it yet. There is no server in this build, ' +
            'so no address, message or preference here reaches anyone.' +
          '</p>' +
        '</div>' +

        '<div class="a-settings" id="a-set" aria-busy="true">' +
          '<div class="a-blank a-blank--loading">' +
            '<p class="a-blank__title">Loading…</p>' +
          '</div>' +
        '</div>';
    },

    mount: function () {
      var host = document.getElementById('a-set');
      if (!host) return;

      ZB.repo.settings.get().then(function (record) {
        if (!document.body.contains(host)) return;

        host.setAttribute('aria-busy', 'false');
        host.innerHTML =
          storeCard(record) +
          profileCard(record) +
          notificationsCard(record) +
          appearanceCard();

        /* The baseline every card measures itself against — taken from the
           rendered controls rather than from `record`, so a value the form
           renders differently (a number written back as a string) does not
           read as an edit the moment the page opens. */
        ['store', 'profile', 'notifications'].forEach(function (id) {
          saved[id] = collect(id);
          refresh(id);
        });

        bind(host);
      });
    }
  };

}(window.ZB));
