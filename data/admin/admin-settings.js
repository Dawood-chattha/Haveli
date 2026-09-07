/* =========================================================================
   admin-settings.js — the store's default settings record
   -------------------------------------------------------------------------
   Data only, in the same spirit as data/admin/admin-nav.js: this file holds
   what the panel opens with, and data/admin/admin-repo.js decides what
   happens when somebody changes it.

   WHY THE ADMIN PROFILE IS NOT IN HERE
   The signed-in person's name, address and role already live in
   ZB.adminUser, and the sidebar draws them from there. Copying them into a
   second object would give the panel two answers to "who is signed in", and
   the first edit would make them disagree. Repo.settings therefore builds
   the `profile` section from ZB.adminUser and writes back to it, exactly as
   the banners screen manages the storefront's own ZB.heroSlides rather than
   a private copy.

   WHAT IS INVENTED AND WHAT IS REAL
   Every value below is placeholder shop data. The address is a plausible
   one for the city named and refers to no real premises; the mailbox and
   phone number are not routable. Nothing here is a credential, and nothing
   here may ever become one — see the security note in admin-repo.js.
   ========================================================================= */

window.ZB = window.ZB || {};

window.ZB.adminSettings = {

  /* ---------------------------------------------------------------------
     STORE

     The shop's own details, plus the one general setting that genuinely
     changes how the rest of the panel behaves.
     --------------------------------------------------------------------- */

  store: {
    name: 'HAVELI',
    tagline: 'Ready to wear, stitched in Pakistan.',
    supportEmail: 'help@haveli.example',
    phone: '+92 21 3456 7890',
    address: 'Shop 14, Ground Floor, Dolmen Mall Clifton',
    city: 'Karachi',

    /* Below this a product counts as running low rather than merely in
       stock. Three screens draw that distinction — the product list's
       stock pill, the inventory filter and the dashboard's alert — and
       they all read it from here through the repository, so changing it
       here changes all three at once. */
    lowStockAt: 10
  },

  /* ---------------------------------------------------------------------
     CURRENCY

     Not editable, and the settings page says why rather than offering a
     control that would lie. Every price in the catalogue is a number of
     rupees. Switching the code would relabel those same numbers, so a
     14,500 kurta would read as $14,500 — the figure unchanged and the
     meaning destroyed. A real currency change converts every price at a
     rate somebody has to supply, and that is a migration, not a setting.
     --------------------------------------------------------------------- */

  currency: {
    code: 'PKR',
    label: 'Pakistani Rupee',
    symbol: 'PKR'
  },

  /* ---------------------------------------------------------------------
     NOTIFICATIONS

     Which events are worth telling the owner about. These are preferences
     and nothing more in this build: delivering any of them needs a mail or
     push service, and there is none. The page states that above the
     switches rather than leaving somebody to find out by not being told
     about an order.
     --------------------------------------------------------------------- */

  notifications: {
    newOrder: true,
    orderCancelled: true,
    lowStock: true,
    newCustomer: false,
    weeklySummary: true,

    /* Where they would go once something can send them. Defaults to the
       support address rather than the owner's, because that is the mailbox
       a shop actually watches. */
    sendTo: 'help@haveli.example'
  },

  /* ---------------------------------------------------------------------
     APPEARANCE

     How this panel is drawn, and the only group that is not shop data.

     Store details, the profile and the notification choices describe the
     business: they belong to the shop, they are the same for whoever signs
     in, and they are what a database will hold. Appearance is none of
     those. It is a preference about this browser on this desk — the same
     kind of thing as the sidebar being left collapsed — so it is owned by
     admin-shell.js and kept in localStorage beside the collapse state,
     which is why it survives a reload when nothing else in the panel does.

     Nothing stored there is data about the user, and nothing sensitive may
     ever be added to it.

     These are the values a browser with no preference stored starts from.
     The sidebar is not among them: it already has a home in the shell, and
     a second copy of it here would be a second answer to the same question.
     --------------------------------------------------------------------- */

  appearance: {
    density: 'comfortable',   /* comfortable | compact */
    motion: 'system'          /* system      | reduced */
  }
};
