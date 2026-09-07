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
  ],

  /* ---------------------------------------------------------------------
     COUPONS

     Unlike orders and customers, these are not expanded into hundreds of
     records — a shop runs a handful of codes at a time, and a list of two
     hundred invented ones would be a worse test of the screen than
     fourteen that cover every state it has to draw.

     DATES ARE OFFSETS, NOT DATES
     `startsIn` and `endsIn` are days from today, so this file does not go
     stale. Written as fixed dates, every coupon here would read "expired"
     a few months after the file was saved, and the screen's scheduled and
     active states would become untestable without editing data.

     The set is chosen to cover all five states the list can show: running,
     scheduled, expired, used up, and switched off by hand.
     --------------------------------------------------------------------- */

  coupons: [
    { code: 'WELCOME10',  type: 'percent',  value: 10,   minSpend: 0,
      startsIn: -180, endsIn: 180, limit: 0,    used: 1462, disabled: false,
      note: 'First order, any department.' },

    { code: 'EIDSALE25',  type: 'percent',  value: 25,   minSpend: 5000,
      startsIn: -12,  endsIn: 4,   limit: 2000, used: 874,  disabled: false,
      note: 'Eid edit — womenswear and menswear.' },

    { code: 'FREESHIP',   type: 'shipping', value: 0,    minSpend: 3000,
      startsIn: -95,  endsIn: 270, limit: 0,    used: 3310, disabled: false,
      note: 'Delivery on us above PKR 3,000.' },

    { code: 'LAWN500',    type: 'fixed',    value: 500,  minSpend: 4000,
      startsIn: -40,  endsIn: 20,  limit: 1500, used: 611,  disabled: false,
      note: 'Unstitched lawn, spring drop.' },

    { code: 'KIDS15',     type: 'percent',  value: 15,   minSpend: 2500,
      startsIn: -6,   endsIn: 24,  limit: 800,  used: 129,  disabled: false,
      note: 'Kidswear only.' },

    { code: 'WINTER20',   type: 'percent',  value: 20,   minSpend: 6000,
      startsIn: 21,   endsIn: 110, limit: 2500, used: 0,    disabled: false,
      note: 'Booked for the winter launch.' },

    { code: 'BLACKFRI',   type: 'percent',  value: 30,   minSpend: 0,
      startsIn: 64,   endsIn: 71,  limit: 5000, used: 0,    disabled: false,
      note: 'One week only.' },

    { code: 'LOYAL1000',  type: 'fixed',    value: 1000, minSpend: 12000,
      startsIn: 9,    endsIn: 99,  limit: 400,  used: 0,    disabled: false,
      note: 'Repeat customers, emailed invitation.' },

    { code: 'SUMMER15',   type: 'percent',  value: 15,   minSpend: 3500,
      startsIn: -140, endsIn: -22, limit: 1200, used: 1043, disabled: false,
      note: 'Summer clearance — finished.' },

    { code: 'RAMADAN12',  type: 'percent',  value: 12,   minSpend: 4000,
      startsIn: -210, endsIn: -150, limit: 3000, used: 2288, disabled: false,
      note: 'Ramadan edit — finished.' },

    { code: 'NEWSTORE',   type: 'fixed',    value: 750,  minSpend: 5000,
      startsIn: -60,  endsIn: 60,  limit: 500,  used: 500,  disabled: false,
      note: 'Opening promotion — limit reached.' },

    { code: 'INSIDER5',   type: 'percent',  value: 5,    minSpend: 0,
      startsIn: -30,  endsIn: 300, limit: 250,  used: 250,  disabled: false,
      note: 'Newsletter code — limit reached.' },

    { code: 'STAFF40',    type: 'percent',  value: 40,   minSpend: 0,
      startsIn: -300, endsIn: 400, limit: 0,    used: 96,   disabled: true,
      note: 'Staff discount — switched off.' },

    { code: 'PRESSKIT',   type: 'shipping', value: 0,    minSpend: 0,
      startsIn: -75,  endsIn: 200, limit: 100,  used: 18,   disabled: true,
      note: 'Press and stylist sends — switched off.' }
  ]
};
