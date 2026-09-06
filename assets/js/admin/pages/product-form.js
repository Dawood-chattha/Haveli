/* =========================================================================
   pages/product-form.js — add and edit a product
   -------------------------------------------------------------------------
   One module serves both routes. Adding and editing differ only in whether
   the form starts empty or starts loaded, and keeping them as one file is
   what stops the two drifting apart — a field added to one and forgotten in
   the other is the classic way these screens rot.

   IMAGES ARE NEVER UPLOADED
   There is no server to upload to, so a chosen file is read in the browser
   and shown as a local preview. Nothing leaves the machine. The form says
   so, because a file picker that looks like it uploads and does not is
   worse than one that explains itself.

   Applied from the UI guidance consulted for these screens:
     - Visible labels on every field, never a placeholder standing in for
       one, with each error under its own field and tied to it by
       aria-describedby (#54, #55, high).
     - Helper text where a field is not self-evident, rather than a
       validation message after the fact (#8).
     - Save disables itself while in flight, then confirms (#32, #61, #83).
     - Deleting asks first and names the product (#35, high).
     - A field that fails validation takes focus, so the fix starts where
       the problem is.
   ========================================================================= */

window.ZB = window.ZB || {};
window.ZB.adminPages = window.ZB.adminPages || {};

(function (ZB) {
  'use strict';

  var ui = ZB.adminUI;

  var STATUSES = [
    { id: 'active', label: 'Active — visible in the store' },
    { id: 'draft', label: 'Draft — hidden from the store' },
    { id: 'out-of-stock', label: 'Out of stock' }
  ];

  /* Working copy of the product being edited. Held here rather than read
     back out of the DOM, so the images list survives a re-render. */
  var draft = null;
  var editingId = null;

  /* -----------------------------------------------------------------------
     Field builders
     ----------------------------------------------------------------------- */

  function fieldWrap(name, label, control, help) {
    var id = 'pf-' + name;
    return '' +
      '<div class="a-field" data-field="' + name + '">' +
        '<label class="a-field__label" for="' + id + '">' + ui.esc(label) + '</label>' +
        (help ? '<p class="a-field__help" id="' + id + '-help">' + ui.esc(help) + '</p>' : '') +
        control +
        '<p class="a-field__error" id="' + id + '-error" hidden></p>' +
      '</div>';
  }

  function textField(o) {
    var id = 'pf-' + o.name;
    var describedBy = id + '-error' + (o.help ? ' ' + id + '-help' : '');

    var control = '<input class="a-input" id="' + id + '" name="' + o.name + '"' +
      ' type="' + (o.type || 'text') + '"' +
      (o.value !== undefined && o.value !== null ? ' value="' + ui.esc(o.value) + '"' : '') +
      (o.min !== undefined ? ' min="' + o.min + '"' : '') +
      (o.step ? ' step="' + o.step + '"' : '') +
      (o.prefix ? '' : '') +
      ' autocomplete="off" aria-describedby="' + describedBy + '">';

    if (o.prefix) {
      control = '<span class="a-input__group"><span class="a-input__prefix">' +
                ui.esc(o.prefix) + '</span>' + control + '</span>';
    }

    return fieldWrap(o.name, o.label, control, o.help);
  }

  function textArea(o) {
    var id = 'pf-' + o.name;
    var describedBy = id + '-error' + (o.help ? ' ' + id + '-help' : '');

    return fieldWrap(o.name, o.label,
      '<textarea class="a-input a-input--area" id="' + id + '" name="' + o.name + '"' +
                ' rows="5" aria-describedby="' + describedBy + '">' +
        ui.esc(o.value || '') +
      '</textarea>', o.help);
  }

  function selectField(o) {
    var id = 'pf-' + o.name;
    var options = o.options.map(function (item) {
      return '<option value="' + ui.esc(item.id) + '"' +
             (String(item.id) === String(o.value) ? ' selected' : '') + '>' +
             ui.esc(item.label) + '</option>';
    }).join('');

    return fieldWrap(o.name, o.label,
      '<span class="a-select a-select--block">' +
        '<select class="a-select__input" id="' + id + '" name="' + o.name + '"' +
                ' aria-describedby="' + id + '-error">' + options + '</select>' +
        '<span class="a-select__arrow" aria-hidden="true">' + ui.icon('chevron') + '</span>' +
      '</span>', o.help);
  }

  /**
   * A set of chips backed by real checkboxes.
   *
   * The input stays in the accessibility tree and keeps every keyboard
   * behaviour a checkbox has; only its appearance is replaced.
   */
  function chipSet(o) {
    var boxes = o.options.map(function (value, i) {
      var id = 'pf-' + o.name + '-' + i;
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
        '<p class="a-field__error" id="pf-' + o.name + '-error" hidden></p>' +
      '</fieldset>';
  }

  function toggleField(o) {
    return '' +
      '<div class="a-field a-field--inline">' +
        '<label class="a-switch">' +
          '<input type="checkbox" id="pf-' + o.name + '" name="' + o.name + '"' +
                (o.value ? ' checked' : '') + '>' +
          '<span class="a-switch__track" aria-hidden="true"><span class="a-switch__knob"></span></span>' +
          '<span class="a-switch__text">' +
            '<span class="a-switch__label">' + ui.esc(o.label) + '</span>' +
            (o.help ? '<span class="a-switch__help">' + ui.esc(o.help) + '</span>' : '') +
          '</span>' +
        '</label>' +
      '</div>';
  }

  /* -----------------------------------------------------------------------
     Options drawn from the catalogue's own seed
     ----------------------------------------------------------------------- */

  function departments() {
    return Object.keys(ZB.catalogueSeed.departments).map(function (id) {
      return { id: id, label: id.charAt(0).toUpperCase() + id.slice(1) };
    });
  }

  function sizesFor(dept) {
    var config = ZB.catalogueSeed.departments[dept];
    return config ? config.sizes : [];
  }

  function coloursFor(dept) {
    var config = ZB.catalogueSeed.departments[dept];
    return config ? config.colours : [];
  }

  /* -----------------------------------------------------------------------
     The page
     ----------------------------------------------------------------------- */

  function blankDraft() {
    return {
      title: '', description: '', price: '', compareAt: '',
      dept: 'women', category: '', sizes: [], colour: '',
      stock: '', sku: '', status: 'draft', featured: false,
      images: []
    };
  }

  function renderForm(isEdit) {
    var d = draft;

    return '' +
      '<form class="a-form" id="pf-form" novalidate>' +

        '<div class="a-form__grid">' +

          '<section class="a-card a-form__main">' +
            '<div class="a-card__body">' +
              textField({ name: 'title', label: 'Product name', value: d.title }) +
              textArea({ name: 'description', label: 'Description', value: d.description,
                         help: 'Shown on the product page in the store.' }) +

              '<div class="a-form__row">' +
                textField({ name: 'price', label: 'Price', type: 'number', min: 0,
                            step: '1', prefix: 'PKR', value: d.price }) +
                textField({ name: 'compareAt', label: 'Sale price', type: 'number', min: 0,
                            step: '1', prefix: 'PKR', value: d.compareAt,
                            help: 'Leave empty if the product is not reduced.' }) +
              '</div>' +

              '<div class="a-form__row">' +
                textField({ name: 'stock', label: 'Stock', type: 'number', min: 0,
                            step: '1', value: d.stock }) +
                textField({ name: 'sku', label: 'SKU', value: d.sku,
                            help: 'Left empty, one is generated.' }) +
              '</div>' +
            '</div>' +
          '</section>' +

          '<section class="a-card a-form__side">' +
            '<div class="a-card__body">' +
              selectField({ name: 'dept', label: 'Department', value: d.dept,
                            options: departments() }) +
              textField({ name: 'category', label: 'Category', value: d.category,
                          help: 'For example Ready To Wear, Polo, Fragrance.' }) +
              selectField({ name: 'status', label: 'Status', value: d.status,
                            options: STATUSES }) +
              toggleField({ name: 'featured', label: 'Featured product', value: d.featured,
                            help: 'Featured products are promoted on the homepage.' }) +
            '</div>' +
          '</section>' +

          '<section class="a-card a-form__media">' +
            '<header class="a-card__head"><h2 class="a-card__title">Images</h2></header>' +
            '<div class="a-card__body">' +
              '<div class="a-images" id="pf-images"></div>' +
              '<label class="a-filepick">' +
                '<input type="file" id="pf-file" accept="image/*" multiple>' +
                '<span class="a-filepick__face">' + ui.icon('image') + ' Choose images</span>' +
              '</label>' +
              '<p class="a-field__help">' +
                'Nothing is uploaded. There is no server in this build, so a chosen ' +
                'file is read in the browser and shown here only.' +
              '</p>' +
            '</div>' +
          '</section>' +

          '<section class="a-card a-form__variants">' +
            '<div class="a-card__body">' +
              '<div id="pf-sizes">' +
                chipSet({ name: 'sizes', label: 'Sizes', options: sizesFor(d.dept),
                          value: d.sizes }) +
              '</div>' +
              '<div id="pf-colours">' +
                selectField({ name: 'colour', label: 'Colour', value: d.colour,
                              options: [{ id: '', label: 'No colour' }].concat(
                                coloursFor(d.dept).map(function (c) {
                                  return { id: c, label: c };
                                })) }) +
              '</div>' +
            '</div>' +
          '</section>' +

        '</div>' +

        '<div class="a-form__bar">' +
          '<div class="a-form__bar-left">' +
            (isEdit
              ? '<button class="a-btn a-btn--danger-ghost" type="button" data-delete-product>' +
                  'Delete product' +
                '</button>'
              : '') +
          '</div>' +
          '<div class="a-form__bar-right">' +
            '<a class="a-btn a-btn--ghost" href="' + ui.href('/admin/products') + '">Cancel</a>' +
            '<button class="a-btn a-btn--primary" type="submit" data-save>' +
              '<span class="a-btn__label">' + (isEdit ? 'Save changes' : 'Create product') + '</span>' +
              '<span class="a-btn__spinner" aria-hidden="true"></span>' +
            '</button>' +
          '</div>' +
        '</div>' +

        '<p class="a-form__note">' +
          'There is no database in this build. A saved product is held in this ' +
          'tab only and is lost when the page reloads.' +
        '</p>' +

      '</form>';
  }

  /* -----------------------------------------------------------------------
     Shared behaviour
     ----------------------------------------------------------------------- */

  function paintImages() {
    var host = document.getElementById('pf-images');
    if (!host) return;

    if (!draft.images.length) {
      host.innerHTML = '<p class="a-images__empty">No images yet.</p>';
      return;
    }

    host.innerHTML = draft.images.map(function (src, i) {
      return '' +
        '<figure class="a-images__item">' +
          '<img src="' + ui.esc(src) + '" alt="" loading="lazy" decoding="async">' +
          '<button class="a-images__remove" type="button" data-remove-image="' + i + '"' +
                 ' aria-label="Remove image ' + (i + 1) + '">' +
            '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>' +
          '</button>' +
        '</figure>';
    }).join('');
  }

  function setError(name, message) {
    var group = document.querySelector('[data-field="' + name + '"]');
    if (!group) return;

    var input = group.querySelector('.a-input, .a-select__input');
    var slot = group.querySelector('.a-field__error');

    group.classList.toggle('is-invalid', !!message);
    if (input) input.setAttribute('aria-invalid', message ? 'true' : 'false');
    if (slot) { slot.textContent = message || ''; slot.hidden = !message; }
  }

  function clearErrors() {
    Array.prototype.forEach.call(
      document.querySelectorAll('.a-field'),
      function (group) { setError(group.getAttribute('data-field'), ''); }
    );
  }

  function collect() {
    var value = function (id) {
      var el = document.getElementById(id);
      return el ? el.value.trim() : '';
    };

    var sizes = Array.prototype.map.call(
      document.querySelectorAll('input[name="sizes"]:checked'),
      function (box) { return box.value; }
    );

    return {
      title: value('pf-title'),
      description: value('pf-description'),
      price: value('pf-price'),
      compareAt: value('pf-compareAt'),
      stock: value('pf-stock'),
      sku: value('pf-sku'),
      dept: value('pf-dept'),
      category: value('pf-category'),
      status: value('pf-status'),
      colour: value('pf-colour'),
      featured: document.getElementById('pf-featured').checked,
      sizes: sizes,
      images: draft.images.slice()
    };
  }

  /** Field checks. Returns a map of field name to message. */
  function validate(data) {
    var errors = {};

    if (!data.title) errors.title = 'Give the product a name.';
    else if (data.title.length < 3) errors.title = 'That name is too short.';

    if (data.price === '') errors.price = 'Set a price.';
    else if (!(Number(data.price) > 0)) errors.price = 'The price must be more than zero.';

    if (data.compareAt !== '') {
      if (!(Number(data.compareAt) > 0)) {
        errors.compareAt = 'Leave this empty, or set a number above zero.';
      } else if (Number(data.compareAt) <= Number(data.price)) {
        /* The struck-through price is the one it used to be, so it has to
           be the higher number or the card reads as a price rise. */
        errors.compareAt = 'The sale price should be higher than the price it is reduced from.';
      }
    }

    if (data.stock === '') errors.stock = 'Set a stock quantity, or 0.';
    else if (Number(data.stock) < 0) errors.stock = 'Stock cannot be negative.';

    if (!data.category) errors.category = 'Give the product a category.';

    return errors;
  }

  function setBusy(on, label) {
    var save = document.querySelector('[data-save]');
    if (!save) return;
    save.disabled = on;
    save.classList.toggle('is-busy', on);
    save.setAttribute('aria-busy', String(on));
    save.querySelector('.a-btn__label').textContent = on ? 'Saving' : label;
  }

  /** Wire a rendered form. `isEdit` decides which repo call saving makes. */
  function bind(isEdit, saveLabel) {
    var form = document.getElementById('pf-form');
    if (!form) return;

    paintImages();

    form.addEventListener('click', function (e) {
      var remove = e.target.closest('[data-remove-image]');
      if (remove) {
        draft.images.splice(Number(remove.getAttribute('data-remove-image')), 1);
        paintImages();
        return;
      }

      if (e.target.closest('[data-delete-product]')) {
        ZB.adminModal.confirm({
          title: 'Delete this product?',
          body: '“' + (draft.title || 'This product') + '” will be removed from the ' +
                'list. This build has no database, so the change lasts until the ' +
                'page is reloaded.',
          confirmLabel: 'Delete product',
          cancelLabel: 'Keep it',
          tone: 'danger'
        }).then(function (yes) {
          if (!yes) return;
          ZB.repo.products.remove(editingId).then(function () {
            ZB.adminToast.success('“' + draft.title + '” deleted.');
            ZB.router.navigate('/admin/products');
          });
        });
      }
    });

    /* Changing department changes which sizes and colours exist. */
    var dept = document.getElementById('pf-dept');
    if (dept) {
      dept.addEventListener('change', function () {
        var sizesHost = document.getElementById('pf-sizes');
        var coloursHost = document.getElementById('pf-colours');

        sizesHost.innerHTML = chipSet({
          name: 'sizes', label: 'Sizes', options: sizesFor(dept.value), value: []
        });
        coloursHost.innerHTML = selectField({
          name: 'colour', label: 'Colour', value: '',
          options: [{ id: '', label: 'No colour' }].concat(
            coloursFor(dept.value).map(function (c) { return { id: c, label: c }; }))
        });
      });
    }

    /* Read locally and previewed; nothing is sent anywhere. */
    var file = document.getElementById('pf-file');
    if (file) {
      file.addEventListener('change', function () {
        Array.prototype.forEach.call(file.files || [], function (chosen) {
          var reader = new FileReader();
          reader.onload = function () {
            draft.images.push(reader.result);
            paintImages();
          };
          reader.readAsDataURL(chosen);
        });
        file.value = '';
      });
    }

    /* Typing is an attempt to fix it; stop showing the complaint. */
    form.addEventListener('input', function (e) {
      var group = e.target.closest('.a-field');
      if (group && group.classList.contains('is-invalid')) {
        setError(group.getAttribute('data-field'), '');
      }
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      clearErrors();

      var data = collect();
      var errors = validate(data);
      var names = Object.keys(errors);

      if (names.length) {
        names.forEach(function (name) { setError(name, errors[name]); });
        var first = document.getElementById('pf-' + names[0]);
        if (first) first.focus();
        ZB.adminToast.error('Check the highlighted fields.');
        return;
      }

      setBusy(true, saveLabel);

      var payload = {
        title: data.title,
        description: data.description,
        price: Number(data.price),
        compareAt: data.compareAt === '' ? null : Number(data.compareAt),
        stock: Number(data.stock),
        inStock: Number(data.stock) > 0,
        sku: data.sku || undefined,
        dept: data.dept,
        deptLabel: data.dept.charAt(0).toUpperCase() + data.dept.slice(1),
        category: ZB.ui.slug(data.category),
        categoryLabel: data.category,
        status: data.status,
        colour: data.colour || null,
        sizes: data.sizes,
        featured: data.featured,
        images: data.images
      };

      var work = isEdit
        ? ZB.repo.products.update(editingId, payload)
        : ZB.repo.products.create(payload);

      work.then(function () {
        ZB.adminToast.success(isEdit
          ? '“' + payload.title + '” saved.'
          : '“' + payload.title + '” created.');
        ZB.router.navigate('/admin/products');
      }).catch(function (failure) {
        setBusy(false, saveLabel);
        ZB.adminToast.error((failure && failure.message) || 'That could not be saved.');
      });
    });
  }

  /* -----------------------------------------------------------------------
     Routes
     ----------------------------------------------------------------------- */

  ZB.adminPages.productNew = {
    title: 'New product',
    crumbs: [{ label: 'Products', path: '/admin/products' }, { label: 'New' }],

    render: function () {
      draft = blankDraft();
      editingId = null;

      return ui.pageHead({
        title: 'New product',
        sub: 'Add a product to the store.'
      }) + renderForm(false);
    },

    mount: function () {
      bind(false, 'Create product');
      var title = document.getElementById('pf-title');
      if (title) title.focus();
    }
  };

  ZB.adminPages.productEdit = {
    title: 'Edit product',

    crumbs: function () {
      return [
        { label: 'Products', path: '/admin/products' },
        { label: draft && draft.title ? draft.title : 'Edit' }
      ];
    },

    render: function () {
      /* The product has to be fetched before the form can be drawn, so the
         first paint is the wait rather than an empty form that fills in. */
      return ui.pageHead({ title: 'Edit product' }) +
        '<div id="pf-host" aria-busy="true">' +
          '<div class="a-blank a-blank--loading">' +
            '<p class="a-blank__title">Loading…</p>' +
          '</div>' +
        '</div>';
    },

    mount: function (params) {
      var host = document.getElementById('pf-host');
      if (!host) return;

      editingId = params.id;

      ZB.repo.products.get(params.id).then(function (row) {
        if (!document.body.contains(host)) return;
        host.setAttribute('aria-busy', 'false');

        if (!row) {
          host.innerHTML =
            '<div class="a-blank">' +
              '<p class="a-blank__title">That product was not found</p>' +
              '<p class="a-blank__body">' +
                'It may have been deleted, or the address may be wrong.' +
              '</p>' +
              '<a class="a-btn a-btn--primary" href="' + ui.href('/admin/products') + '">' +
                'Back to products' +
              '</a>' +
            '</div>';
          return;
        }

        draft = {
          title: row.title || '',
          description: row.description || '',
          price: row.price || '',
          compareAt: row.compareAt || '',
          dept: row.dept || 'women',
          category: row.categoryLabel || '',
          sizes: row.sizes || [],
          colour: row.colour || '',
          stock: row.stock === undefined ? '' : row.stock,
          sku: row.sku || '',
          status: row.status || 'draft',
          featured: !!row.featured,
          images: row.image ? [row.image] : []
        };

        host.innerHTML = renderForm(true);
        bind(true, 'Save changes');

        /* The trail said "Edit" while the product was loading; now it can
           say which product. */
        if (ZB.adminShell) ZB.adminShell.setCrumbs('/admin/products/' + params.id + '/edit', params);
      });
    }
  };

}(window.ZB));
