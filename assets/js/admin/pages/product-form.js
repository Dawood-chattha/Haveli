/* =========================================================================
   pages/product-form.js — add and edit a product
   -------------------------------------------------------------------------
   One module serves both routes. Adding and editing differ only in whether
   the form starts empty or starts loaded, and keeping them as one file is
   what stops the two drifting apart — a field added to one and forgotten in
   the other is the classic way these screens rot.

   IMAGES ARE UPLOADED, AND THE SERVER DECIDES WHAT THEY ARE
   A chosen file goes to /api/admin/uploads, which reads its first bytes to
   decide whether it really is a JPEG, PNG or WebP, names it itself, and
   puts it in the shop's picture store. The URL that comes back is what is
   saved on the product.

   This note used to say the opposite — that nothing left the machine —
   because for a while nothing did: the file was turned into a data URI and
   stored in a column capped at a thousand characters, which kept the first
   thousand characters of the picture and said nothing about the rest.

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

  /* THERE IS NO "OUT OF STOCK" STATUS, AND THERE WAS NEVER MEANT TO BE
   *
   * It was offered here while the catalogue was generated and status was
   * whatever this file said it was. In the database a product is active,
   * draft or archived, and whether it is out of stock is answered by its
   * stock being zero — one fact, in one place, that cannot contradict
   * itself. Choosing it here would have been a 400 from the server.
   *
   * The product list still filters by "Out of stock", which is the question
   * that was really being asked, and the endpoint answers it with stock = 0.
   * Archived is not offered either: a product gets there by being deleted,
   * and comes back the same way. */
  /* What the API accepts on one product. Stated here so the form can say so
     before somebody chooses nine files and is refused by the server. */
  var MAX_IMAGES = 12;

  var STATUSES = [
    { id: 'active', label: 'Active — visible in the store' },
    { id: 'draft', label: 'Draft — hidden from the store' }
  ];

  /* Working copy of the product being edited. Held here rather than read
     back out of the DOM, so the images list survives a re-render. */
  var draft = null;
  var editingId = null;

  /* -----------------------------------------------------------------------
     Field builders

     Shared with every other form in the panel — this file used to carry its
     own copies, and once the category dialog needed the same label / help /
     error wiring, two copies was one too many. The prefix keeps this form's
     ids ('pf-title') distinct from any other form on screen.
     ----------------------------------------------------------------------- */

  var fields = ZB.adminFields.make('pf');

  /* Thin wrappers: everything below already calls setError by field name,
     and the shared helper wants the root to search as well. */
  function setError(name, message) { fields.setError(document, name, message); }
  function clearErrors() { fields.clearErrors(document); }


  /* -----------------------------------------------------------------------
     The options the form offers

     The departments and categories come from the menu — the real one, read
     from the database by assets/js/bootstrap.js — so a category the owner
     added a moment ago is in this list. Sizes and colours are still
     suggestion lists from the catalogue seed; they are not a table yet.
     ----------------------------------------------------------------------- */

  function departments() {
    var live = (ZB.navigation || []).map(function (dept) {
      return { id: dept.id, label: dept.label };
    });

    if (live.length) return live;

    /* Only reached if the menu could not be loaded at all. */
    return Object.keys(ZB.catalogueSeed.departments).map(function (id) {
      return { id: id, label: id.charAt(0).toUpperCase() + id.slice(1) };
    });
  }

  /**
   * Every category in a department, as options keyed by slug.
   *
   * This was a free text field, which a database cannot honour: a typed
   * name that matches nothing is a product with nowhere to go, and the
   * owner would only find out when the save failed. A product has to be
   * filed under a category that exists, so the form offers the ones that
   * do.
   *
   * A sub-category is labelled with its parent - "Eastern Wear / Kurta" -
   * because "Kurta" alone appears in more than one department and the two
   * are different categories.
   */
  function categoriesFor(dept) {
    var found = (ZB.navigation || []).filter(function (d) { return d.id === dept; })[0];
    if (!found) return [];

    var out = [];

    found.items.forEach(function (item) {
      out.push({ id: ZB.ui.slug(item.label), label: item.label });

      (item.children || []).forEach(function (child) {
        out.push({
          id: ZB.ui.slug(child.label),
          label: item.label + ' \u2192 ' + child.label
        });
      });
    });

    return out;
  }

  /** What to call a category slug, for a message about it. */
  function labelOfCategory(dept, slug) {
    var hit = categoriesFor(dept).filter(function (o) { return o.id === slug; })[0];
    return hit ? hit.label : slug;
  }

  function categoryField(dept, value) {
    return fields.select({
      name: 'category', label: 'Category', value: value,
      options: [{ id: '', label: 'Choose a category' }].concat(categoriesFor(dept)),
      help: 'Where it appears in the shop\u2019s menu. New ones are added under Categories.'
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
              fields.text({ name: 'title', label: 'Product name', value: d.title }) +
              fields.area({ name: 'description', label: 'Description', value: d.description, rows: 5,
                         help: 'Shown on the product page in the store.' }) +

              '<div class="a-form__row">' +
                fields.text({ name: 'price', label: 'Price', type: 'number', min: 0,
                            step: '1', prefix: 'PKR', value: d.price }) +
                fields.text({ name: 'compareAt', label: 'Sale price', type: 'number', min: 0,
                            step: '1', prefix: 'PKR', value: d.compareAt,
                            help: 'Leave empty if the product is not reduced.' }) +
              '</div>' +

              '<div class="a-form__row">' +
                fields.text({ name: 'stock', label: 'Stock', type: 'number', min: 0,
                            step: '1', value: d.stock }) +
                /* Shown, not editable. The server derives the SKU from the
                   product's name, because a typed one can collide with a
                   SKU already in use and nothing here could tell. */
                fields.text({ name: 'sku', label: 'SKU', value: d.sku, readonly: true,
                            help: 'Set from the product name when it is saved.' }) +
              '</div>' +
            '</div>' +
          '</section>' +

          '<section class="a-card a-form__side">' +
            '<div class="a-card__body">' +
              fields.select({ name: 'dept', label: 'Department', value: d.dept,
                            options: departments() }) +
              '<div id="pf-category-host">' + categoryField(d.dept, d.category) + '</div>' +
              fields.select({ name: 'status', label: 'Status', value: d.status,
                            options: STATUSES }) +
              fields.toggle({ name: 'featured', label: 'Featured product', value: d.featured,
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
                'JPEG, PNG or WebP, up to 4 MB each. A picture is uploaded as ' +
                'soon as it is chosen; the product itself is saved separately.' +
              '</p>' +
            '</div>' +
          '</section>' +

          '<section class="a-card a-form__variants">' +
            '<div class="a-card__body">' +
              '<div id="pf-sizes">' +
                fields.chips({ name: 'sizes', label: 'Sizes', options: sizesFor(d.dept),
                          value: d.sizes }) +
              '</div>' +
              '<div id="pf-colours">' +
                fields.select({ name: 'colour', label: 'Colour', value: d.colour,
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
          'Saving writes to the shop\u2019s database. An active product is in the ' +
          'shop as soon as it is saved; a draft is not shown until it is.' +
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
          body: '“' + (draft.title || 'This product') + '” leaves the shop straight ' +
                'away. It is archived rather than erased, because past orders point ' +
                'at it, so it can be put back from the product list.',
          confirmLabel: 'Delete product',
          cancelLabel: 'Keep it',
          tone: 'danger'
        }).then(function (yes) {
          if (!yes) return;
          ZB.repo.products.remove(editingId).then(function () {
            ZB.adminToast.success('“' + draft.title + '” deleted.');
            ZB.router.navigate('/admin/products');
          }).catch(function (failure) {
            ZB.adminToast.error((failure && failure.message) || 'That could not be deleted.');
          });
        });
      }
    });

    /* Changing department changes which categories, sizes and colours
       exist. The category especially: every one of them belongs to exactly
       one department, so leaving the old value selected would file the
       product somewhere it cannot go. */
    var dept = document.getElementById('pf-dept');
    if (dept) {
      dept.addEventListener('change', function () {
        var categoryHost = document.getElementById('pf-category-host');
        var sizesHost = document.getElementById('pf-sizes');
        var coloursHost = document.getElementById('pf-colours');

        if (categoryHost) categoryHost.innerHTML = categoryField(dept.value, '');

        sizesHost.innerHTML = fields.chips({
          name: 'sizes', label: 'Sizes', options: sizesFor(dept.value), value: []
        });
        coloursHost.innerHTML = fields.select({
          name: 'colour', label: 'Colour', value: '',
          options: [{ id: '', label: 'No colour' }].concat(
            coloursFor(dept.value).map(function (c) { return { id: c, label: c }; }))
        });
      });
    }

    /* THE PICTURE IS UPLOADED, NOT READ INTO THE PAGE
     *
     * It used to be read with FileReader and kept as a data: URL — two
     * million characters of base64 in the form's draft. That was harmless
     * while nothing was saved. Once products began saving, the API stored
     * it in a column capped at a thousand characters, so an owner attached
     * a photograph, pressed save, and got a broken image with no warning
     * anywhere.
     *
     * Now each file goes to /api/admin/uploads, which checks what it
     * actually is and where it lands, and what the form keeps is the URL. */
    var file = document.getElementById('pf-file');
    if (file) {
      file.addEventListener('change', function () {
        var chosen = Array.prototype.slice.call(file.files || []);
        file.value = '';

        if (!chosen.length) return;

        if (draft.images.length + chosen.length > MAX_IMAGES) {
          ZB.adminToast.error('A product can have up to ' + MAX_IMAGES + ' pictures.');
          return;
        }

        var host = document.getElementById('pf-images');
        if (host) host.setAttribute('aria-busy', 'true');

        /* One after another rather than all at once: a slow connection
           uploading six photographs in parallel is six requests competing
           for the same pipe, and the first one to arrive is what the owner
           is waiting to see. */
        var next = function (i) {
          if (i >= chosen.length) {
            if (host) host.setAttribute('aria-busy', 'false');
            return;
          }

          return ZB.repo.uploadImage(chosen[i], 'products').then(function (result) {
            draft.images.push(result.url);
            paintImages();
            return next(i + 1);
          }).catch(function (failure) {
            if (host) host.setAttribute('aria-busy', 'false');
            ZB.adminToast.error((failure && failure.message) ||
                                'That picture could not be saved.');
          });
        };

        next(0);
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
        /* Already a slug: the control's values are slugs, not labels. */
        category: data.category,
        categoryLabel: labelOfCategory(data.dept, data.category),
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
          /* The slug, because the category control's values are slugs. */
          category: row.category || '',
          sizes: row.sizes || [],
          colour: row.colour || '',
          stock: row.stock === undefined ? '' : row.stock,
          sku: row.sku || '',
          status: row.status || 'draft',
          featured: !!row.featured,
          images: (row.images || []).slice()
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
