/* =========================================================================
   api/_routes/index.js — every endpoint, listed once
   -------------------------------------------------------------------------
   WHY THIS FILE EXISTS AND IS NOT GENERATED

   The endpoints used to sit directly under api/, one file per route, and
   Vercel turned each of them into its own serverless function. That is the
   arrangement the platform is built around and it is a good one — right up
   until the count matters. This shop has thirty-seven endpoints and the plan
   it is deployed on allows twelve, so the deployment was refused outright.

   Thirty-seven is not really thirty-seven programs. It is one API answering
   on thirty-seven paths, and the split was never anything but a file layout.
   So the layout moved: the endpoints live under _routes, which Vercel ignores
   because of the underscore, and one function in front of them dispatches.

   THE LIST IS WRITTEN OUT, NOT DISCOVERED

   Reading the directory at startup would be shorter and would not survive
   deployment. Vercel bundles a function by TRACING the requires it can see in
   the source; a require whose path is computed at runtime is invisible to
   that, so a route resolved by scanning a folder would work perfectly on this
   machine and be missing from the bundle in production — which is the worst
   kind of difference between the two.

   Every line below is a literal require. The tracer sees all of them, and so
   does anybody reading the file.

   AND IT IS CHECKED, BECAUSE A LIST BY HAND GOES STALE

   scripts/check-syntax.mjs compares this table against the files actually
   present under _routes and fails if they disagree. An endpoint added without
   a line here would 404 in a way nothing else would explain; one left here
   after its file went would crash on the first request. Neither can now reach
   a deployment.

   THE KEYS ARE THE PATHS, MINUS /api

     'auth/login'            ->  /api/auth/login
     'admin/products'        ->  /api/admin/products
     'admin/products/[id]'   ->  /api/admin/products/<anything>

   A bracket names the parameter the handler will read out of req.query, which
   is exactly what the file name meant when Vercel was doing the routing. The
   dispatcher in api/[...route].js matches a literal key first, so a real
   endpoint is never swallowed by a bracket beside it.
   ========================================================================= */

'use strict';

module.exports = {
  'account/addresses/[id]':    require('./account/addresses/[id]'),
  'account/addresses':         require('./account/addresses/index'),
  'account/cart':              require('./account/cart'),
  'account/orders':            require('./account/orders'),
  'account/wishlist':          require('./account/wishlist'),
  'admin/banners/[id]':        require('./admin/banners/[id]'),
  'admin/banners':             require('./admin/banners/index'),
  'admin/categories/[id]':     require('./admin/categories/[id]'),
  'admin/categories':          require('./admin/categories/index'),
  'admin/coupons/[id]':        require('./admin/coupons/[id]'),
  'admin/coupons':             require('./admin/coupons/index'),
  'admin/customers/[id]':      require('./admin/customers/[id]'),
  'admin/customers':           require('./admin/customers/index'),
  'admin/customers/summary':   require('./admin/customers/summary'),
  'admin/metrics':             require('./admin/metrics'),
  'admin/orders/[id]':         require('./admin/orders/[id]'),
  'admin/orders':              require('./admin/orders/index'),
  'admin/orders/summary':      require('./admin/orders/summary'),
  'admin/pages/[slug]':        require('./admin/pages/[slug]'),
  'admin/pages':               require('./admin/pages/index'),
  'admin/products/[id]':       require('./admin/products/[id]'),
  'admin/products':            require('./admin/products/index'),
  'admin/settings':            require('./admin/settings'),
  'admin/uploads':             require('./admin/uploads'),
  'auth/forgot':               require('./auth/forgot'),
  'auth/login':                require('./auth/login'),
  'auth/logout':               require('./auth/logout'),
  'auth/me':                   require('./auth/me'),
  'auth/reset':                require('./auth/reset'),
  'auth/signup':               require('./auth/signup'),
  'banners':                   require('./banners'),
  'catalogue':                 require('./catalogue'),
  'categories':                require('./categories'),
  'checkout':                  require('./checkout'),
  'health':                    require('./health'),
  'pages':                     require('./pages'),
  'shop':                      require('./shop')
};
