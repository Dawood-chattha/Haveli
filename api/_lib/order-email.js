/* =========================================================================
   api/_lib/order-email.js — what a customer is told after they order
   -------------------------------------------------------------------------
   One message, written in one place, so that what it says can be read
   without opening the endpoint that sends it.

   WHAT IT IS FOR
   A shop that takes an order and says nothing is a shop the customer has to
   guess about. This is the receipt: what was bought, what it came to, where
   it is going, and the reference to quote if anything needs asking about.

   IT IS CASH ON DELIVERY AND THE MESSAGE SAYS SO
   The shop's owner chose cash on delivery and no other method, so the amount
   in this email is the amount to have ready at the door. Saying that plainly
   is the difference between a customer who has the notes counted out and one
   who sends the rider away.

   NOTHING IN IT IS SECRET
   The order reference, the items, the total and the delivery address — all
   of it is what the customer typed a moment ago, sent to the address they
   gave. There is no password, no token, no link that signs anybody in, and
   no card details because this project has never held any. An inbox is read
   on trains and left open on shared computers; a receipt is safe there, a
   credential is not.

   PLAIN TEXT IS THE REAL MESSAGE
   Both parts are sent. The HTML one is a convenience; the text one is what a
   mail client that blocks images, a screen reader, or a phone on a bad
   connection actually shows, so it has to make sense on its own rather than
   being an apology for the version next to it.
   ========================================================================= */

'use strict';

var email = require('./email');

var esc = email.esc;
var money = email.money;

/**
 * The lines of the order, as a customer reads them.
 *
 * Quantity first, because "2 x" is the thing somebody checks. The size is
 * only printed when there is one — a fragrance has no size, and "Size: —"
 * is a column pretending to be information.
 */
function itemLines(order) {
  return (order.items || []).map(function (line) {
    var name = line.title + (line.size ? ' (' + line.size + ')' : '');
    return '  ' + line.qty + ' x ' + name + '   ' + money(line.price * line.qty);
  }).join('\n');
}

function itemRows(order) {
  return (order.items || []).map(function (line) {
    return '' +
      '<tr>' +
        '<td style="padding:6px 12px 6px 0;">' +
          esc(line.qty) + ' &times; ' + esc(line.title) +
          (line.size ? ' <span style="color:#666">(' + esc(line.size) + ')</span>' : '') +
        '</td>' +
        '<td style="padding:6px 0;text-align:right;white-space:nowrap;">' +
          esc(money(line.price * line.qty)) +
        '</td>' +
      '</tr>';
  }).join('');
}

/** The address as it would be written on a parcel. */
function addressBlock(order) {
  var a = order.address || {};

  return [a.name, a.line1, a.line2, a.city, a.postcode, a.phone]
    .filter(function (part) { return part; });
}

/**
 * Build the message for one order.
 *
 * @param {object} order  The shape api/_lib/shape.js customerOrder returns.
 * @param {string} shopName
 * @returns {object} { subject, text, html }
 */
function build(order, shopName) {
  var shop = shopName || 'HAVELI';
  var lines = addressBlock(order);

  var totals = [
    ['Items', money(order.subtotal)],
    order.discount ? ['Discount' + (order.couponCode ? ' (' + order.couponCode + ')' : ''),
                      '-' + money(order.discount)] : null,
    ['Delivery', order.shipping ? money(order.shipping) : 'Free'],
    ['Total to pay on delivery', money(order.total)]
  ].filter(Boolean);

  var text =
    'Thank you — your order is placed.\n\n' +
    'Order ' + order.ref + '\n' +
    new Array(('Order ' + order.ref).length + 1).join('=') + '\n\n' +
    itemLines(order) + '\n\n' +
    totals.map(function (row) { return row[0] + ': ' + row[1]; }).join('\n') + '\n\n' +
    'PAYMENT\n' +
    'Cash on delivery. Please have ' + money(order.total) + ' ready when the ' +
    'parcel arrives.\n\n' +
    'DELIVERING TO\n' +
    lines.join('\n') + '\n\n' +
    'Quote ' + order.ref + ' if you need to ask us anything about it.\n\n' +
    shop;

  var html =
    '<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;' +
                'font-size:15px;line-height:1.55;color:#111;max-width:34rem;">' +

      '<p style="margin:0 0 18px;font-size:17px;">' +
        'Thank you — your order is placed.' +
      '</p>' +

      '<p style="margin:0 0 18px;">' +
        'Order <strong>' + esc(order.ref) + '</strong>' +
      '</p>' +

      '<table style="width:100%;border-collapse:collapse;margin:0 0 18px;">' +
        itemRows(order) +
      '</table>' +

      '<table style="width:100%;border-collapse:collapse;margin:0 0 18px;' +
                    'border-top:1px solid #ddd;padding-top:8px;">' +
        totals.map(function (row, i) {
          var last = i === totals.length - 1;
          return '<tr>' +
            '<td style="padding:4px 12px 4px 0;' +
                       (last ? 'font-weight:600;' : 'color:#555;') + '">' +
              esc(row[0]) +
            '</td>' +
            '<td style="padding:4px 0;text-align:right;white-space:nowrap;' +
                       (last ? 'font-weight:600;' : '') + '">' +
              esc(row[1]) +
            '</td>' +
          '</tr>';
        }).join('') +
      '</table>' +

      '<p style="margin:0 0 18px;padding:12px;background:#f4f2ef;">' +
        '<strong>Cash on delivery.</strong> Please have ' +
        esc(money(order.total)) + ' ready when the parcel arrives.' +
      '</p>' +

      '<p style="margin:0 0 6px;color:#555;font-size:13px;' +
                'text-transform:uppercase;letter-spacing:.04em;">Delivering to</p>' +
      '<p style="margin:0 0 18px;">' + lines.map(esc).join('<br>') + '</p>' +

      '<p style="margin:0 0 18px;color:#555;font-size:13px;">' +
        'Quote ' + esc(order.ref) + ' if you need to ask us anything about it.' +
      '</p>' +

      '<p style="margin:0;font-size:13px;color:#555;">' + esc(shop) + '</p>' +
    '</div>';

  return {
    /* The reference is in the subject on purpose: it is what somebody
       searches their inbox for six weeks later. */
    subject: 'Your ' + shop + ' order ' + order.ref,
    text: text,
    html: html
  };
}

/**
 * Send it. Never throws — see api/_lib/email.js.
 */
function send(order, to, toName, shopName) {
  var message = build(order, shopName);

  return email.send({
    to: to,
    toName: toName || (order.address && order.address.name) || undefined,
    subject: message.subject,
    text: message.text,
    html: message.html
  });
}

module.exports = {
  build: build,
  send: send
};
