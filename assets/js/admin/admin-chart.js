/* =========================================================================
   admin-chart.js — the dashboard's charts, drawn by hand in SVG
   -------------------------------------------------------------------------
   No charting library. The project has no dependencies and adds none, and
   an area chart with one series is a few dozen lines of geometry.

   TWO FORMS, CHOSEN BY WHAT THE DATA HAS TO DO

     area()      trend over time, one series. A line with a wash beneath it.
     sparkline() the 12-point trend inside a stat tile.

   The headline numbers are NOT charts. Four figures with a change against
   last period are a row of stat tiles; drawing them as bars would be a
   one-bar bar chart four times over.

   MARK SPECS
     line          2px, round join and cap
     area fill     the series colour at 10% — a wash, never a block
     end marker    r=4 (8px), with a 2px ring in the surface colour so it
                   stays legible where it sits on the line
     gridlines     1px solid, one step off the surface, never dashed
     labels        the endpoint only. A number on every point is chaos and
                   goes unread; the axis and the tooltip carry the rest.
     text          never wears the series colour — values and axis text use
                   the ordinary ink tokens, and the coloured mark beside
                   them carries the identity.

   COLOUR
   One series, so there is no categorical palette here and nothing for a
   colourblind-separation check to compare: the checks that matter for
   multi-series palettes are about telling adjacent hues apart. The single
   hue is the brand ink on white, which is about 19:1 — far above the 4.5:1
   floor. Status colours elsewhere in the panel always ship with a word as
   well as a colour.

   ACCESSIBILITY
   The chart is reachable by keyboard: arrow keys walk the points and show
   exactly what hovering shows. A tooltip is never the only way to read a
   value — every chart here has a table view holding the same numbers.
   ========================================================================= */

window.ZB = window.ZB || {};

(function (ZB) {
  'use strict';

  var PAD = { top: 16, right: 20, bottom: 30, left: 58 };

  /* -----------------------------------------------------------------------
     Formatting
     ----------------------------------------------------------------------- */

  /** 1_240_000 -> '1.2M', 45_800 -> '46k', 900 -> '900' */
  function compact(n) {
    var abs = Math.abs(n);
    if (abs >= 1e6) return (n / 1e6).toFixed(abs >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
    if (abs >= 1e3) return Math.round(n / 1e3) + 'k';
    return String(Math.round(n));
  }

  function full(n) {
    return Number(Math.round(n)).toLocaleString('en-PK');
  }

  function dayLabel(date) {
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }

  /**
   * A round number at or above the highest value, and a step that divides
   * it evenly. Axis ticks that read 0 / 50k / 100k are worth the arithmetic;
   * ticks that read 0 / 47,318 / 94,636 are not.
   */
  function niceScale(max, targetTicks) {
    if (max <= 0) return { max: 1, step: 1 };

    var rough = max / (targetTicks || 4);
    var magnitude = Math.pow(10, Math.floor(Math.log(rough) / Math.LN10));
    var candidates = [1, 2, 2.5, 5, 10];
    var step = magnitude * candidates[candidates.length - 1];

    for (var i = 0; i < candidates.length; i++) {
      if (candidates[i] * magnitude >= rough) { step = candidates[i] * magnitude; break; }
    }

    return { max: Math.ceil(max / step) * step, step: step };
  }

  function esc(v) { return ZB.ui.esc(v); }

  /* -----------------------------------------------------------------------
     Area chart
     ----------------------------------------------------------------------- */

  /**
   * Draw a single-series area chart into `root`.
   *
   * config: {
   *   series: [{ date, value, orders }],
   *   height: px for the plot plus its axis band,
   *   valueLabel: what one value means, used in the tooltip and the table
   * }
   *
   * Returns a controller with destroy(). The chart re-renders on resize,
   * because the geometry is in real pixels — an SVG scaled by the browser
   * would stretch its 2px line and its type along with it.
   */
  function area(root, config) {
    if (!root) return null;

    var series = config.series || [];
    var height = config.height || 260;
    var tooltip = null;
    var activeIndex = -1;
    var geometry = null;

    function measure() {
      var width = root.clientWidth;
      if (!width) return null;

      var plotW = width - PAD.left - PAD.right;
      var plotH = height - PAD.top - PAD.bottom;
      if (plotW <= 0 || plotH <= 0) return null;

      var max = 0;
      series.forEach(function (point) { if (point.value > max) max = point.value; });
      var scale = niceScale(max, 4);

      /* One point would divide by zero; sit it in the middle instead. */
      var stepX = series.length > 1 ? plotW / (series.length - 1) : 0;

      return {
        width: width, plotW: plotW, plotH: plotH, scale: scale, stepX: stepX,
        x: function (i) {
          return series.length > 1 ? PAD.left + i * stepX : PAD.left + plotW / 2;
        },
        y: function (value) {
          return PAD.top + plotH - (value / scale.max) * plotH;
        }
      };
    }

    function render() {
      var g = measure();
      if (!g) return;
      geometry = g;

      var linePoints = series.map(function (point, i) {
        return g.x(i).toFixed(1) + ' ' + g.y(point.value).toFixed(1);
      });

      var linePath = 'M' + linePoints.join(' L');
      var baseline = (PAD.top + g.plotH).toFixed(1);
      var areaPath = linePath +
        ' L' + g.x(series.length - 1).toFixed(1) + ' ' + baseline +
        ' L' + g.x(0).toFixed(1) + ' ' + baseline + ' Z';

      /* ---- gridlines and y labels ---- */
      var grid = '';
      for (var v = 0; v <= g.scale.max + 0.001; v += g.scale.step) {
        var y = g.y(v).toFixed(1);
        grid +=
          '<line class="a-chart__grid" x1="' + PAD.left + '" y1="' + y +
                '" x2="' + (PAD.left + g.plotW) + '" y2="' + y + '"/>' +
          '<text class="a-chart__tick a-chart__tick--y" x="' + (PAD.left - 10) +
                '" y="' + y + '" text-anchor="end" dominant-baseline="middle">' +
            esc(compact(v)) +
          '</text>';
      }

      /* ---- x labels: about six, never one per day ---- */
      var every = Math.max(1, Math.ceil(series.length / 6));
      var xLabels = '';
      series.forEach(function (point, i) {
        var isLast = i === series.length - 1;
        if (i % every !== 0 && !isLast) return;
        /* Skip a label that would collide with the last one. */
        if (!isLast && (series.length - 1 - i) < every * 0.6) return;

        xLabels +=
          '<text class="a-chart__tick" x="' + g.x(i).toFixed(1) +
                '" y="' + (PAD.top + g.plotH + 18) + '" text-anchor="' +
                (isLast ? 'end' : 'middle') + '">' +
            esc(dayLabel(point.date)) +
          '</text>';
      });

      /* ---- the one direct label: the endpoint ---- */
      var last = series[series.length - 1];
      var lastX = g.x(series.length - 1);
      var lastY = g.y(last.value);

      /* ---- hover targets: one band per point, full plot height ---- */
      var bandW = Math.max(g.stepX, 1);
      var bands = series.map(function (point, i) {
        return '<rect class="a-chart__band" data-index="' + i + '"' +
                    ' x="' + (g.x(i) - bandW / 2).toFixed(1) + '" y="' + PAD.top +
                    '" width="' + bandW.toFixed(1) + '" height="' + g.plotH + '"/>';
      }).join('');

      root.innerHTML =
        '<svg class="a-chart__svg" width="' + g.width + '" height="' + height + '"' +
             ' viewBox="0 0 ' + g.width + ' ' + height + '"' +
             ' tabindex="0" role="img"' +
             ' aria-label="' + esc(config.summary || 'Sales over time') + '">' +

          grid +
          '<path class="a-chart__area" d="' + areaPath + '"/>' +
          '<path class="a-chart__line" d="' + linePath + '"/>' +

          /* Crosshair and read-out dot, moved by hover and by arrow keys. */
          '<line class="a-chart__crosshair" id="a-chart-crosshair"' +
                ' y1="' + PAD.top + '" y2="' + (PAD.top + g.plotH) + '" hidden/>' +
          '<circle class="a-chart__cursor" id="a-chart-cursor" r="4.5" hidden/>' +

          /* The end marker: 8px across, ringed in the surface colour. */
          '<circle class="a-chart__end" cx="' + lastX.toFixed(1) + '" cy="' +
                  lastY.toFixed(1) + '" r="4"/>' +

          xLabels +

          '<text class="a-chart__endlabel" x="' + (lastX - 8).toFixed(1) +
                '" y="' + Math.max(PAD.top + 10, lastY - 12).toFixed(1) +
                '" text-anchor="end">' + esc(compact(last.value)) + '</text>' +

          bands +
        '</svg>' +

        '<div class="a-chart__tip" id="a-chart-tip" role="status" hidden></div>';

      tooltip = root.querySelector('#a-chart-tip');
      if (activeIndex > -1) show(activeIndex);
    }

    /* ---- read-out ---- */

    function show(i) {
      if (!geometry || i < 0 || i >= series.length) return;
      activeIndex = i;

      var point = series[i];
      var x = geometry.x(i);
      var y = geometry.y(point.value);

      var crosshair = root.querySelector('#a-chart-crosshair');
      var cursor = root.querySelector('#a-chart-cursor');
      if (!crosshair || !cursor || !tooltip) return;

      crosshair.setAttribute('x1', x.toFixed(1));
      crosshair.setAttribute('x2', x.toFixed(1));
      crosshair.hidden = false;

      cursor.setAttribute('cx', x.toFixed(1));
      cursor.setAttribute('cy', y.toFixed(1));
      cursor.hidden = false;

      tooltip.innerHTML =
        '<span class="a-chart__tip-date">' + esc(dayLabel(point.date)) + '</span>' +
        '<span class="a-chart__tip-value">PKR ' + esc(full(point.value)) + '</span>' +
        '<span class="a-chart__tip-meta">' + point.orders +
          (point.orders === 1 ? ' order' : ' orders') + '</span>';
      tooltip.hidden = false;

      /* Keep the tip inside the card rather than letting it hang off. */
      var tipW = tooltip.offsetWidth;
      var left = Math.min(Math.max(x - tipW / 2, 4), geometry.width - tipW - 4);
      tooltip.style.left = left + 'px';
      tooltip.style.top = Math.max(y - tooltip.offsetHeight - 14, 4) + 'px';
    }

    function hide() {
      activeIndex = -1;
      var crosshair = root.querySelector('#a-chart-crosshair');
      var cursor = root.querySelector('#a-chart-cursor');
      if (crosshair) crosshair.hidden = true;
      if (cursor) cursor.hidden = true;
      if (tooltip) tooltip.hidden = true;
    }

    /* ---- wiring ---- */

    root.addEventListener('mouseover', function (e) {
      var band = e.target.closest('.a-chart__band');
      if (band) show(Number(band.getAttribute('data-index')));
    });

    root.addEventListener('mouseleave', hide);

    /* Arrow keys give a keyboard user the same read-out hovering gives. */
    root.addEventListener('keydown', function (e) {
      if (!e.target.classList.contains('a-chart__svg')) return;

      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        var from = activeIndex === -1 ? (e.key === 'ArrowRight' ? -1 : series.length) : activeIndex;
        show(Math.max(0, Math.min(series.length - 1, from + (e.key === 'ArrowRight' ? 1 : -1))));
      } else if (e.key === 'Home') {
        e.preventDefault(); show(0);
      } else if (e.key === 'End') {
        e.preventDefault(); show(series.length - 1);
      } else if (e.key === 'Escape') {
        hide();
      }
    });

    root.addEventListener('focusout', function (e) {
      if (!root.contains(e.relatedTarget)) hide();
    });

    var onResize = ZB.util.debounce(function () {
      /* The chart outlives no route: when its markup is replaced, stop. */
      if (!document.body.contains(root)) {
        window.removeEventListener('resize', onResize);
        return;
      }
      render();
    }, 150);

    window.addEventListener('resize', onResize);
    render();

    return {
      render: render,
      destroy: function () { window.removeEventListener('resize', onResize); }
    };
  }

  /* -----------------------------------------------------------------------
     Sparkline

     The trend line inside a stat tile. Drawn in the de-emphasis grey with
     the most recent point in the ink, so the eye lands on where the number
     is now rather than on the whole run.
     ----------------------------------------------------------------------- */

  function sparkline(values, options) {
    options = options || {};
    var w = options.width || 96;
    var h = options.height || 28;

    if (!values || values.length < 2) return '';

    var max = Math.max.apply(null, values);
    var min = Math.min.apply(null, values);
    var span = (max - min) || 1;
    var stepX = w / (values.length - 1);

    /* Inset by the stroke so the line is not clipped at the edges. */
    var pad = 2;
    var points = values.map(function (value, i) {
      var x = i * stepX;
      var y = pad + (h - pad * 2) - ((value - min) / span) * (h - pad * 2);
      return x.toFixed(1) + ' ' + y.toFixed(1);
    });

    var lastX = (values.length - 1) * stepX;
    var lastY = pad + (h - pad * 2) - ((values[values.length - 1] - min) / span) * (h - pad * 2);

    return '' +
      '<svg class="a-spark" width="' + w + '" height="' + h + '"' +
           ' viewBox="0 0 ' + w + ' ' + h + '" aria-hidden="true" focusable="false">' +
        '<path class="a-spark__line" d="M' + points.join(' L') + '"/>' +
        '<circle class="a-spark__end" cx="' + lastX.toFixed(1) + '" cy="' +
                lastY.toFixed(1) + '" r="2.5"/>' +
      '</svg>';
  }

  /* -----------------------------------------------------------------------
     Table view

     Every chart has one. A tooltip may enhance a chart but must never be
     the only way to reach a value, and a line cannot be read at all by
     someone using a screen reader.
     ----------------------------------------------------------------------- */

  function seriesTable(series) {
    var rows = series.map(function (point) {
      return '<tr>' +
               '<th scope="row">' + esc(dayLabel(point.date)) + '</th>' +
               '<td>PKR ' + esc(full(point.value)) + '</td>' +
               '<td>' + point.orders + '</td>' +
             '</tr>';
    }).join('');

    return '' +
      '<table class="a-table a-table--compact">' +
        '<caption class="visually-hidden">Sales by day</caption>' +
        '<thead><tr><th scope="col">Day</th><th scope="col">Sales</th>' +
        '<th scope="col">Orders</th></tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>';
  }

  ZB.adminChart = {
    area: area,
    sparkline: sparkline,
    seriesTable: seriesTable,
    compact: compact,
    full: full
  };

}(window.ZB));
