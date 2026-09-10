/* =========================================================================
   rich-text.js — the owner's typed words, as safe HTML
   -------------------------------------------------------------------------
   Loaded by both halves of the site: the storefront renders the shop's
   written pages with it, and the admin panel previews them with it. One
   copy, because two would drift and the way that shows up is a preview
   that does not match the page.

   THE ORDER OF THE TWO STEPS IS THE WHOLE SECURITY MODEL
   Every character is escaped FIRST. Only then are three rules applied to
   the already-escaped string. So the only tags in the output are the ones
   written below, and an owner who types <script> gets the seven visible
   characters they typed.

   Escaping afterwards would escape the tags this file just wrote, which
   would show them to the reader — and the tempting fix for that is to stop
   escaping, which is how a content field becomes a way to put a script on
   the shop's own pages.

   THE THREE RULES, AND WHY ONLY THREE
     blank line     starts a new paragraph
     "## " prefix   makes that line a subheading
     "- " prefix    makes the line a list item, if every line in the block is one

   A Markdown parser would be a dependency this project does not have, and a
   rich text editor would store markup — which is the thing being avoided.
   Three rules cover a returns policy, a privacy notice and a page of
   frequently asked questions, which is what these pages are.
   ========================================================================= */

window.ZB = window.ZB || {};

(function (ZB) {
  'use strict';

  /* Its own escape rather than ZB.ui.esc, because this file is loaded by
     the panel too, where ZB.ui is the storefront's and is not present. The
     five characters are the five that matter in an HTML text node and in an
     attribute. */
  function esc(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Typed text as a column of safe HTML.
   *
   * Returns '' for nothing, so a caller can test the result rather than
   * rendering an empty wrapper around it.
   */
  function richText(text) {
    var raw = String(text === null || text === undefined ? '' : text)
      .replace(/\r\n/g, '\n');

    if (!raw.trim()) return '';

    return raw.split(/\n{2,}/).map(function (block) {
      var lines = block.split('\n')
        .map(function (line) { return line.trim(); })
        .filter(function (line) { return line.length; });

      if (!lines.length) return '';

      /* A subheading, and only ever the one line. What follows it is
         whatever it is — usually a paragraph, occasionally a list, and
         guessing would reformat somebody's writing. */
      if (lines[0].indexOf('## ') === 0) {
        var heading = '<h2 class="page-copy__heading">' +
                        esc(lines[0].slice(3).trim()) +
                      '</h2>';

        var rest = lines.slice(1);

        return heading + (rest.length
          ? '<p class="page-copy__para">' +
              rest.map(esc).join('<br>') +
            '</p>'
          : '');
      }

      /* A list, when every line in the block is one. A block that is mostly
         a list with a stray sentence in it stays a paragraph. */
      var allItems = lines.every(function (line) { return line.indexOf('- ') === 0; });

      if (allItems) {
        return '<ul class="page-copy__list">' +
          lines.map(function (line) {
            return '<li>' + esc(line.slice(2).trim()) + '</li>';
          }).join('') +
        '</ul>';
      }

      /* Anything else. Single newlines inside a paragraph become line
         breaks, because somebody typing an address expects them to. */
      return '<p class="page-copy__para">' + lines.map(esc).join('<br>') + '</p>';
    }).join('');
  }

  ZB.richText = richText;

}(window.ZB));
