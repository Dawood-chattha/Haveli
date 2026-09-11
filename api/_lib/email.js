/* =========================================================================
   api/_lib/email.js — the one place this project sends mail from
   -------------------------------------------------------------------------
   USAGE

     var email = require('./_lib/email');

     await email.send({
       to: 'someone@example.com',
       toName: 'Someone',
       subject: 'Your order',
       text: 'Plain words.',
       html: '<p>The same words.</p>'
     });

   Resolves with { sent: true } or { sent: false, reason: '...' }. IT NEVER
   THROWS, and that is the most important line in this file — see below.

   SENDING MAIL MUST NEVER LOSE AN ORDER
   The only thing this is used for is telling somebody what they just did. If
   the mail service is down, or the key has expired, or the account has hit
   its daily limit, the right outcome is a customer with an order and no
   email — not a customer whose order was refused because a third party was
   having an afternoon. So every failure is caught here, logged, and returned
   as a value the caller is free to ignore.

   THERE IS NO SMTP LIBRARY HERE, AND NO NEW DEPENDENCY
   The obvious way to send mail from Node is nodemailer over SMTP. It is a
   good library and this does not use it: the provider has an HTTP API, an
   HTTP request is one fetch, and a dependency that exists to speak a protocol
   we do not otherwise need is a larger surface than the problem. The same
   reasoning as api/_lib/validate.js having no schema library.

   SUPABASE'S OWN EMAILS DO NOT COME THROUGH HERE
   The password-reset link is sent by the auth service, which has its own SMTP
   settings in the Supabase dashboard. That is not a duplication to be tidied
   away: those messages are sent at moments this API never sees — a reset
   requested from a device, a confirmation re-sent from the dashboard — and
   routing them through here would mean reimplementing the tokens. Both ends
   should be pointed at the same provider account, which is configuration
   rather than code.

   NOTHING SECRET GOES IN AN EMAIL
   No password, no token, no session, no card details — there are none of the
   last in this project at all. An order confirmation contains what the
   customer already knows because they just typed it, sent to the address they
   gave. An inbox is not a private place: it is read on trains, forwarded, and
   left open on shared computers.
   ========================================================================= */

'use strict';

var Env = require('./env');
var log = require('./log');

/* Brevo's transactional endpoint. The provider is named in one place so that
   changing it later is one constant and one body shape, not a search. */
var ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

/* Shorter than the database timeout on purpose. This is the least important
   thing any request does, and a customer should not wait on it. */
var TIMEOUT_MS = 8000;

/**
 * Whether mail can be sent at all.
 *
 * Unconfigured is a normal state, not a fault: the project runs perfectly
 * well on a developer's machine with no mail account, and saying so once at
 * the point of sending is better than a stack trace in a log nobody reads.
 */
function configured() {
  return !!(Env.emailKey() && Env.emailFrom());
}

/**
 * Send one message. Never throws.
 *
 * @param {object} message  { to, toName?, subject, text, html? }
 */
async function send(message) {
  if (!configured()) {
    /* Said at info, not error. Nothing is broken — nothing is set up. */
    log.info('email not sent: no mail account is configured',
             { subject: message && message.subject });
    return { sent: false, reason: 'not configured' };
  }

  if (!message || !message.to || !message.subject || !message.text) {
    log.error('email not sent: the message was incomplete', null,
              { has: Object.keys(message || {}).join(',') });
    return { sent: false, reason: 'incomplete' };
  }

  try {
    var res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'api-key': Env.emailKey(),
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({
        sender: { email: Env.emailFrom(), name: Env.emailFromName() },
        to: [{ email: message.to, name: message.toName || undefined }],
        subject: message.subject,
        textContent: message.text,
        htmlContent: message.html || undefined
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });

    if (res.status >= 200 && res.status < 300) return { sent: true };

    /* The provider's own words go to the log and nowhere else. They are
       written for whoever holds the account, not for a customer. */
    var body = await res.text();

    log.error('the mail service refused a message', null, {
      status: res.status,
      /* Trimmed: an error body can be long, and none of it is worth more
         than a line in a log. */
      reason: body.slice(0, 200)
    });

    return { sent: false, reason: 'refused ' + res.status };
  } catch (e) {
    log.error('the mail service could not be reached', e);
    return { sent: false, reason: 'unreachable' };
  }
}

/* -------------------------------------------------------------------------
   Writing a message

   ESCAPE THEN FORMAT, THE SAME RULE THE PAGES FOLLOW
   A customer's name and their address are typed by them. In the plain-text
   part they are text and need nothing; in the HTML part they are markup
   unless they are escaped first, and an order confirmation is an unusually
   good place to put a script tag — it is generated by a server, sent to an
   inbox, and rendered by a mail client that may be a browser.
   ------------------------------------------------------------------------- */

function esc(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Whole rupees, the way the shop writes them everywhere else. */
function money(n) {
  return 'PKR ' + Number(n || 0).toLocaleString('en-PK');
}

module.exports = {
  send: send,
  configured: configured,
  esc: esc,
  money: money
};
