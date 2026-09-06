/* =========================================================================
   admin-seed.js — raw ingredients for the mock orders and customers
   -------------------------------------------------------------------------
   Data only, in the same shape as data/catalogue.js: this file holds the
   ingredients, and assets/js/admin/admin-mock.js expands them into records.
   Writing out a few hundred orders by hand would be unreadable and would
   drift out of step with the catalogue.

   Everything here is invented. The names are ordinary Pakistani given and
   family names combined at random; none of them refers to a real person,
   and the addresses are the well-known cities they would plausibly ship to.

   The dashboard, the orders page and the customers page all read the same
   expansion, so the totals on one always agree with the rows on another.
   ========================================================================= */

window.ZB = window.ZB || {};

window.ZB.adminSeed = {

  /* How much history exists. Ninety days is enough for the dashboard to
     offer a month, a fortnight and a week without running out of data. */
  days: 90,

  /* Roughly this many orders per day, varied per day by the generator. */
  ordersPerDay: 6,

  customers: 140,

  /* ---------------------------------------------------------------------
     ORDER STATUS

     `weight` decides how common a status is. Recent orders skew towards
     the early states and older ones towards Delivered, because that is how
     a real queue drains — see admin-mock.js.
     --------------------------------------------------------------------- */

  statuses: [
    { id: 'pending',    label: 'Pending',    weight: 3 },
    { id: 'processing', label: 'Processing', weight: 4 },
    { id: 'shipped',    label: 'Shipped',    weight: 4 },
    { id: 'delivered',  label: 'Delivered',  weight: 8 },
    { id: 'cancelled',  label: 'Cancelled',  weight: 1 }
  ],

  payments: [
    { id: 'paid',     label: 'Paid',     weight: 7 },
    { id: 'unpaid',   label: 'Unpaid',   weight: 2 },
    { id: 'refunded', label: 'Refunded', weight: 1 }
  ],

  methods: ['Card', 'Cash on delivery', 'Bank transfer', 'Wallet'],

  /* Cash on delivery is the common choice in this market, so the generator
     leans on the first entry rather than spreading evenly. */

  firstNames: [
    'Ayesha', 'Bilal', 'Fatima', 'Hamza', 'Zainab', 'Usman', 'Maryam',
    'Ahmed', 'Sana', 'Imran', 'Hira', 'Faisal', 'Nimra', 'Tariq',
    'Rabia', 'Kashif', 'Iqra', 'Adnan', 'Sadia', 'Junaid',
    'Mehwish', 'Salman', 'Amna', 'Zeeshan', 'Noor', 'Waqar'
  ],

  lastNames: [
    'Khan', 'Ahmed', 'Malik', 'Sheikh', 'Butt', 'Chaudhry', 'Qureshi',
    'Siddiqui', 'Raza', 'Farooq', 'Hussain', 'Javed', 'Aslam', 'Nawaz',
    'Iqbal', 'Rehman', 'Mahmood', 'Abbas'
  ],

  cities: [
    'Karachi', 'Lahore', 'Islamabad', 'Rawalpindi', 'Faisalabad',
    'Multan', 'Peshawar', 'Quetta', 'Sialkot', 'Hyderabad', 'Gujranwala'
  ],

  /* The mailbox half of an invented address. A real domain is never used,
     so nothing here can reach a mailbox that exists. */
  mailDomain: 'example.com',

  /* ---------------------------------------------------------------------
     ACTIVITY

     The dashboard's activity strip. Each entry is a template the generator
     fills from a real record, so the feed always refers to something the
     rest of the panel can actually show.
     --------------------------------------------------------------------- */

  activityKinds: [
    { id: 'order',    icon: 'receipt', text: 'New order {ref} from {who}' },
    { id: 'stock',    icon: 'archive', text: '{what} is out of stock' },
    { id: 'customer', icon: 'users',   text: '{who} created an account' },
    { id: 'shipped',  icon: 'box',     text: 'Order {ref} was marked shipped' }
  ]
};
