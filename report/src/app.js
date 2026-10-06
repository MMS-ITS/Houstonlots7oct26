/* ==========================================================================
   Lot Due-Diligence Report - rendering + pagination
   DATA is injected by scripts/08_build_report.py as window.__REPORT__
   ========================================================================== */
'use strict';

var D = window.__REPORT__;
var W = 688;                 // usable content width in px at A4 portrait

/* ------------------------------------------------------------------ utils */
function el(tag, cls, html) {
  var n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
}
function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
                  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function num(v, dp, dash) {
  if (v === null || v === undefined || v === '' || (typeof v === 'number' && !isFinite(v)))
    return dash === undefined ? '&mdash;' : dash;
  var n = Number(v);
  if (!isFinite(n)) return esc(v);
  return n.toLocaleString('en-US', { minimumFractionDigits: dp || 0,
                                     maximumFractionDigits: dp || 0 });
}
function usd(v) { return (v === null || v === undefined) ? '&mdash;' : '$' + num(v, 0); }
function cmToIn(v) { return v == null ? null : v / 2.54; }
function or(v, alt) { return (v === null || v === undefined || v === '') ? alt : v; }
/* escape a value but let the fallback through as literal HTML (e.g. an em dash) */
function escOr(v, alt) {
  return (v === null || v === undefined || v === '') ? (alt === undefined ? '&mdash;' : alt) : esc(v);
}
function tierTag(t) {
  if (!t) return '';
  var k = String(t).toUpperCase();
  if (k.indexOf('OFFICIAL') === 0 && k.indexOf('MODEL') < 0)
    return '<span class="tier tier-official">Official</span>';
  if (k.indexOf('OFFICIAL') >= 0 && k.indexOf('MODEL') >= 0)
    return '<span class="tier tier-official">Official</span> ' +
           '<span class="tier tier-model">Model-derived</span>';
  if (k.indexOf('MODEL') >= 0) return '<span class="tier tier-model">Model-derived</span>';
  return '<span class="tier tier-required">Needs confirmation</span>';
}
function svgEl(w, h, extra) {
  return '<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" ' +
         'style="height:auto;aspect-ratio:' + w + '/' + h + '" ' +
         'xmlns="http://www.w3.org/2000/svg" ' + (extra || '') + '>';
}

/* --------------------------------------------------------- projection ft */
function projector(cenLat) {
  var ftLat = 110574 * 3.280839895;
  var ftLon = 111320 * Math.cos(cenLat * Math.PI / 180) * 3.280839895;
  return {
    fx: function (lon) { return lon * ftLon; },
    fy: function (lat) { return lat * ftLat; }
  };
}

/* ======================================================================
   FIGURE 1 - true-scale site plan: boundary, contours, transect, scale bar
   ====================================================================== */
function siteMap(p, opts) {
  opts = opts || {};
  var g = p.geometry || {}, td = p.terrain_data || {};
  if (!g.ring || !g.ring.length) return null;
  var cen = g.centroid || { lat: g.ring[0][1], lon: g.ring[0][0] };
  var pr = projector(cen.lat);
  var ox = pr.fx(cen.lon), oy = pr.fy(cen.lat);
  function P(lon, lat) { return [pr.fx(lon) - ox, -(pr.fy(lat) - oy)]; }

  var ring = g.ring.map(function (c) { return P(c[0], c[1]); });
  var xs = ring.map(function (c) { return c[0]; });
  var ys = ring.map(function (c) { return c[1]; });
  var pad = 0.16;
  var minx = Math.min.apply(null, xs), maxx = Math.max.apply(null, xs);
  var miny = Math.min.apply(null, ys), maxy = Math.max.apply(null, ys);
  var spanx = (maxx - minx) || 1, spany = (maxy - miny) || 1;
  minx -= spanx * pad; maxx += spanx * pad;
  miny -= spany * pad; maxy += spany * pad;

  var VW = W, VH = Math.round(W * 0.70);
  var mL = 40, mR = 12, mT = 12, mB = 40;
  var pw = VW - mL - mR, ph = VH - mT - mB;
  var sc = Math.min(pw / (maxx - minx), ph / (maxy - miny));   // equal x/y => true scale
  var cx = (minx + maxx) / 2, cy = (miny + maxy) / 2;
  function S(pt) {
    return [mL + pw / 2 + (pt[0] - cx) * sc, mT + ph / 2 + (pt[1] - cy) * sc];
  }

  var s = svgEl(VW, VH);
  s += '<rect x="0" y="0" width="' + VW + '" height="' + VH + '" fill="#fff"/>';
  s += '<rect x="' + mL + '" y="' + mT + '" width="' + pw + '" height="' + ph +
       '" fill="#fcfdfe" stroke="#dde5ec"/>';

  // contours
  var cs = td.contours;
  if (cs && cs.levels && opts.contours !== false) {
    var lv = cs.levels, zmin = Infinity, zmax = -Infinity;
    lv.forEach(function (L) { zmin = Math.min(zmin, L.level_ft); zmax = Math.max(zmax, L.level_ft); });
    lv.forEach(function (L) {
      var t = (zmax === zmin) ? 0.5 : (L.level_ft - zmin) / (zmax - zmin);
      var col = 'rgb(' + Math.round(150 + 80 * t) + ',' + Math.round(175 - 55 * t) + ',' +
                Math.round(205 - 120 * t) + ')';
      var major = Math.abs(L.level_ft / (cs.interval_ft * 5) -
                           Math.round(L.level_ft / (cs.interval_ft * 5))) < 1e-6;
      var d = '';
      L.segments.forEach(function (sg) {
        var a = S(P(sg[0][0], sg[0][1])), b = S(P(sg[1][0], sg[1][1]));
        d += 'M' + a[0].toFixed(1) + ',' + a[1].toFixed(1) +
             'L' + b[0].toFixed(1) + ',' + b[1].toFixed(1);
      });
      s += '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="' +
           (major ? 1.25 : 0.6) + '" stroke-linecap="round"/>';
      if (major && L.segments.length) {
        var m = S(P(L.segments[0][0][0], L.segments[0][0][1]));
        s += '<text x="' + m[0].toFixed(1) + '" y="' + m[1].toFixed(1) +
             '" font-size="6.4" fill="' + col + '" font-weight="700" ' +
             'paint-order="stroke" stroke="#fff" stroke-width="2">' +
             L.level_ft.toFixed(0) + '</text>';
      }
    });
  }

  // parcel boundary
  var dd = ring.map(function (c, i) {
    var q = S(c);
    return (i ? 'L' : 'M') + q[0].toFixed(1) + ',' + q[1].toFixed(1);
  }).join('') + 'Z';
  s += '<path d="' + dd + '" fill="rgba(26,95,138,.07)" stroke="#1a5f8a" stroke-width="2.1"/>';

  // vertices
  ring.forEach(function (c) {
    var q = S(c);
    s += '<circle cx="' + q[0].toFixed(1) + '" cy="' + q[1].toFixed(1) +
         '" r="2" fill="#fff" stroke="#10405e" stroke-width="1.1"/>';
  });

  // transect A-B
  var tr = td.transect;
  if (tr && tr.start && tr.end) {
    var a = S(P(tr.start.lon, tr.start.lat)), b = S(P(tr.end.lon, tr.end.lat));
    s += '<line x1="' + a[0].toFixed(1) + '" y1="' + a[1].toFixed(1) + '" x2="' +
         b[0].toFixed(1) + '" y2="' + b[1].toFixed(1) +
         '" stroke="#c0392b" stroke-width="1.7" stroke-dasharray="6 3"/>';
    [[a, 'A'], [b, 'B']].forEach(function (q) {
      s += '<circle cx="' + q[0][0].toFixed(1) + '" cy="' + q[0][1].toFixed(1) +
           '" r="6.5" fill="#c0392b"/><text x="' + q[0][0].toFixed(1) + '" y="' +
           (q[0][1] + 2.4).toFixed(1) + '" font-size="7.4" fill="#fff" ' +
           'text-anchor="middle" font-weight="700">' + q[1] + '</text>';
    });
  }

  // high / low markers inside parcel
  if (td.grid && td.grid.z) {
    var gr = td.grid, lo = null, hi = null;
    for (var j = 0; j < gr.gy.length; j++) {
      for (var i2 = 0; i2 < gr.gx.length; i2++) {
        var z = gr.z[j][i2];
        if (z == null) continue;
        if (!pointInRing([gr.gx[i2], gr.gy[j]], g.ring)) continue;
        if (!lo || z < lo.z) lo = { z: z, lon: gr.gx[i2], lat: gr.gy[j] };
        if (!hi || z > hi.z) hi = { z: z, lon: gr.gx[i2], lat: gr.gy[j] };
      }
    }
    [[hi, '#b9472f', 'HIGH'], [lo, '#1f6f94', 'LOW']].forEach(function (m) {
      if (!m[0]) return;
      var q = S(P(m[0].lon, m[0].lat));
      s += '<path d="M' + q[0].toFixed(1) + ',' + (q[1] - 5).toFixed(1) +
           'l4.3,7.5h-8.6Z" fill="' + m[1] + '"/>';
      s += '<text x="' + (q[0] + 6).toFixed(1) + '" y="' + (q[1] + 3).toFixed(1) +
           '" font-size="6.4" font-weight="700" fill="' + m[1] +
           '" paint-order="stroke" stroke="#fff" stroke-width="2.4">' +
           m[2] + ' ' + m[0].z.toFixed(1) + ' ft</text>';
    });
  }

  // north arrow
  var nx = VW - mR - 20, ny = mT + 24;
  s += '<g><line x1="' + nx + '" y1="' + (ny + 15) + '" x2="' + nx + '" y2="' + (ny - 11) +
       '" stroke="#15202b" stroke-width="1.5"/>' +
       '<path d="M' + nx + ',' + (ny - 16) + 'l4.6,8h-9.2Z" fill="#15202b"/>' +
       '<text x="' + nx + '" y="' + (ny + 25) + '" font-size="7.2" text-anchor="middle" ' +
       'font-weight="700" fill="#15202b">N</text></g>';

  // scale bar - choose a round length
  var targetPx = pw * 0.33;
  var raw = targetPx / sc;
  var steps = [10, 20, 25, 50, 75, 100, 150, 200, 300, 400, 500, 750, 1000];
  var barFt = steps[0];
  for (var k = 0; k < steps.length; k++) if (steps[k] <= raw) barFt = steps[k];
  var barPx = barFt * sc;
  var bx = mL + 6, by = VH - mB + 17;
  s += '<g><rect x="' + bx + '" y="' + by + '" width="' + (barPx / 2).toFixed(1) +
       '" height="5" fill="#15202b"/>' +
       '<rect x="' + (bx + barPx / 2).toFixed(1) + '" y="' + by + '" width="' +
       (barPx / 2).toFixed(1) + '" height="5" fill="#fff" stroke="#15202b" stroke-width=".8"/>' +
       '<text x="' + bx + '" y="' + (by - 3) + '" font-size="6.8" fill="#15202b">0</text>' +
       '<text x="' + (bx + barPx).toFixed(1) + '" y="' + (by - 3) +
       '" font-size="6.8" fill="#15202b" text-anchor="middle">' + barFt + ' ft</text>' +
       '<text x="' + (bx + barPx + 10).toFixed(1) + '" y="' + (by + 4.6) +
       '" font-size="6.6" fill="#6b7f91">equal H/V scale &middot; approx. 1:' +
       roundRatio(1152.2 / sc) + ' at A4</text></g>';
  s += '</svg>';
  return s;
}

/* Round a map ratio to a conventional-looking figure.
   1152.2 / (px per ft) converts to a print ratio: the SVG's 688 user units are
   laid out across the 182 mm A4 text width, and 1 ft = 304.8 mm on the ground. */
function roundRatio(r) {
  if (!isFinite(r) || r <= 0) return '?';
  var steps = [100, 125, 150, 200, 250, 300, 400, 500, 600, 750, 1000, 1250,
               1500, 2000, 2500, 3000, 4000, 5000];
  for (var i = 0; i < steps.length; i++) {
    if (r <= steps[i] * 1.12) return String(steps[i]);
  }
  return String(Math.round(r / 1000) * 1000);
}

function pointInRing(pt, ring) {
  var x = pt[0], y = pt[1], inside = false, n = ring.length;
  for (var i = 0; i < n; i++) {
    var x1 = ring[i][0], y1 = ring[i][1];
    var x2 = ring[(i + 1) % n][0], y2 = ring[(i + 1) % n][1];
    if (((y1 > y) !== (y2 > y)) && (x < (x2 - x1) * (y - y1) / (y2 - y1 + 1e-18) + x1))
      inside = !inside;
  }
  return inside;
}

/* ======================================================================
   FIGURE 2 - longitudinal cross-section.
   Renders the SAME profile twice: a true 1:1 geometric panel and a
   vertically exaggerated panel, so an exaggerated curve can never be
   mistaken for the real slope. Annotates the overall rising angle and
   the steepest grade over any 50 ft run.
   ====================================================================== */
function crossSection(p, exag) {
  var td = p.terrain_data || {};
  var tr = td.transect;
  if (!tr || !tr.profile || tr.profile.length < 3) return null;

  var prof = tr.profile.filter(function (q) { return q.z != null; });
  if (prof.length < 3) return null;

  // orient so the end nearer mapped water is on the LEFT (the "lake side")
  var wd = (p.water || {}).distance_ft;
  var flip = false;
  if (wd != null && wd < 1500 && td.transect.start && td.transect.end) {
    var zs = prof[0].z, ze = prof[prof.length - 1].z;
    if (zs > ze) flip = true;             // put the low (water) end on the left
  }
  var pts = prof.map(function (q) { return { d: q.d, z: q.z }; });
  if (flip) {
    var L = pts[pts.length - 1].d;
    pts = pts.map(function (q) { return { d: L - q.d, z: q.z }; }).reverse();
  }

  var len = pts[pts.length - 1].d;
  var zmin = Math.min.apply(null, pts.map(function (q) { return q.z; }));
  var zmax = Math.max.apply(null, pts.map(function (q) { return q.z; }));
  var relief = zmax - zmin;
  var overallDeg = Math.atan2(relief, len) * 180 / Math.PI;
  var st = tr.steepest_50ft || null;

  var PW = Math.floor((W - 10) / 2), PH = 210;

  function panel(title, vx, isTrue) {
    var mL = 34, mR = 8, mT = 16, mB = 26;
    var pw = PW - mL - mR, ph = PH - mT - mB;
    var sx = pw / (len || 1);
    var sy, zLo, zHi;
    if (isTrue) {
      sy = sx;                                  // identical scale => real geometry
      var need = ph / sy;
      var mid = (zmin + zmax) / 2;
      zLo = mid - need / 2; zHi = mid + need / 2;
      if (relief > need) { zLo = zmin; zHi = zmax; sy = ph / (relief || 1); }
    } else {
      sy = sx * vx;
      var span = ph / sy;
      var pad = Math.max((span - relief) / 2, relief * 0.08 + 0.5);
      zLo = zmin - pad; zHi = zLo + Math.max(span, relief + 2 * pad);
    }
    function X(d) { return mL + d * sx; }
    function Y(z) { return mT + ph - (z - zLo) * sy; }

    var s = svgEl(PW, PH);
    s += '<rect width="' + PW + '" height="' + PH + '" fill="#fff"/>';
    s += '<text x="' + (PW / 2) + '" y="10" font-size="7.6" text-anchor="middle" ' +
         'font-weight="700" fill="#10405e">' + title + '</text>';
    s += '<rect x="' + mL + '" y="' + mT + '" width="' + pw + '" height="' + ph +
         '" fill="#fbfdfe" stroke="#dde5ec"/>';

    // y gridlines. On the 1:1 panel a near-flat lot needs a very tall vertical
    // window, so label only the band around the real ground rather than
    // printing meaningless elevations far above and below the site.
    var zr = zHi - zLo;
    var labLo = zLo, labHi = zHi;
    if (isTrue) {
      var marg = Math.max(2, relief * 1.5);
      labLo = Math.max(zLo, zmin - marg);
      labHi = Math.min(zHi, zmax + marg);
    }
    var lr = labHi - labLo;
    var stepZ = lr > 120 ? 40 : lr > 60 ? 20 : lr > 24 ? 10 : lr > 12 ? 5 : lr > 6 ? 2 : 1;
    for (var z = Math.ceil(labLo / stepZ) * stepZ; z <= labHi; z += stepZ) {
      var yy = Y(z);
      if (yy < mT - 0.5 || yy > mT + ph + 0.5) continue;
      s += '<line x1="' + mL + '" y1="' + yy.toFixed(1) + '" x2="' + (mL + pw) +
           '" y2="' + yy.toFixed(1) + '" stroke="#eaf0f5" stroke-width=".8"/>';
      s += '<text x="' + (mL - 3) + '" y="' + (yy + 2.2).toFixed(1) +
           '" font-size="6.1" text-anchor="end" fill="#6b7f91">' + z.toFixed(0) + '</text>';
    }
    // a tangible 1:1 vertical reference on the true-scale panel
    if (isTrue) {
      var refFt = relief > 40 ? 20 : relief > 12 ? 10 : 5;
      var rh2 = refFt * sy;
      if (rh2 > 4 && rh2 < ph * 0.8) {
        var rx = mL + pw - 24, ryB = mT + ph - 16;
        s += '<line x1="' + rx + '" y1="' + ryB + '" x2="' + rx + '" y2="' +
             (ryB - rh2).toFixed(1) + '" stroke="#17724a" stroke-width="1.6"/>' +
             '<line x1="' + (rx - 3) + '" y1="' + ryB + '" x2="' + (rx + 3) + '" y2="' +
             ryB + '" stroke="#17724a" stroke-width="1.6"/>' +
             '<line x1="' + (rx - 3) + '" y1="' + (ryB - rh2).toFixed(1) + '" x2="' +
             (rx + 3) + '" y2="' + (ryB - rh2).toFixed(1) +
             '" stroke="#17724a" stroke-width="1.6"/>' +
             '<text x="' + (rx - 5) + '" y="' + (ryB - rh2 / 2 + 2).toFixed(1) +
             '" font-size="6" fill="#17724a" text-anchor="end" font-weight="700">' +
             refFt + ' ft</text>';
      }
    }
    // x ticks
    var stepX = len > 800 ? 200 : len > 400 ? 100 : len > 200 ? 50 : 25;
    for (var dx = 0; dx <= len + 0.1; dx += stepX) {
      var xx = X(dx);
      s += '<line x1="' + xx.toFixed(1) + '" y1="' + (mT + ph) + '" x2="' + xx.toFixed(1) +
           '" y2="' + (mT + ph + 3) + '" stroke="#9fb3c2" stroke-width=".8"/>';
      s += '<text x="' + xx.toFixed(1) + '" y="' + (mT + ph + 11) +
           '" font-size="6.1" text-anchor="middle" fill="#6b7f91">' + dx.toFixed(0) + '</text>';
    }

    // steepest 50 ft band
    if (st && st.at_d_ft != null) {
      var d0 = flip ? (len - st.at_d_ft - (st.run_ft || 50)) : st.at_d_ft;
      var d1 = d0 + (st.run_ft || 50);
      if (d1 > 0 && d0 < len) {
        s += '<rect x="' + X(Math.max(0, d0)).toFixed(1) + '" y="' + mT + '" width="' +
             Math.max(1, (X(Math.min(len, d1)) - X(Math.max(0, d0)))).toFixed(1) +
             '" height="' + ph + '" fill="rgba(192,57,43,.09)"/>';
      }
    }

    // terrain fill + line
    var dpath = '', line = '';
    pts.forEach(function (q, i) {
      var X1 = X(q.d).toFixed(1), Y1 = Y(q.z).toFixed(1);
      line += (i ? 'L' : 'M') + X1 + ',' + Y1;
    });
    dpath = line + 'L' + X(len).toFixed(1) + ',' + (mT + ph) + 'L' + X(0).toFixed(1) +
            ',' + (mT + ph) + 'Z';
    s += '<path d="' + dpath + '" fill="url(#grd' + (isTrue ? 'T' : 'E') + ')" opacity=".85"/>';
    s += '<defs><linearGradient id="grd' + (isTrue ? 'T' : 'E') +
         '" x1="0" y1="0" x2="0" y2="1">' +
         '<stop offset="0" stop-color="#b98f5e"/><stop offset="1" stop-color="#e5d6c2"/>' +
         '</linearGradient></defs>';
    s += '<path d="' + line + '" fill="none" stroke="#6b4f2a" stroke-width="1.5"/>';

    // min / max markers
    var qmin = pts.reduce(function (a, b) { return b.z < a.z ? b : a; });
    var qmax = pts.reduce(function (a, b) { return b.z > a.z ? b : a; });
    s += '<circle cx="' + X(qmin.d).toFixed(1) + '" cy="' + Y(qmin.z).toFixed(1) +
         '" r="2.4" fill="#1f6f94"/>';
    s += '<circle cx="' + X(qmax.d).toFixed(1) + '" cy="' + Y(qmax.z).toFixed(1) +
         '" r="2.4" fill="#b9472f"/>';

    // endpoint labels
    s += '<text x="' + mL + '" y="' + (PH - 4) + '" font-size="6.4" fill="#44586b">' +
         (flip ? 'A (water side)' : 'A') + '</text>';
    s += '<text x="' + (mL + pw) + '" y="' + (PH - 4) +
         '" font-size="6.4" text-anchor="end" fill="#44586b">B</text>';
    s += '<text x="' + (mL - 26) + '" y="' + (mT + ph / 2) +
         '" font-size="6.2" fill="#6b7f91" transform="rotate(-90 ' + (mL - 26) + ',' +
         (mT + ph / 2) + ')" text-anchor="middle">elevation (ft)</text>';

    // scale annotation
    s += '<text x="' + (mL + pw) + '" y="' + (mT - 4) + '" font-size="6.2" ' +
         'text-anchor="end" fill="' + (isTrue ? '#17724a' : '#9c2b2b') + '" font-weight="700">' +
         (isTrue ? 'V:H = 1:1 (true geometry)' : 'V:H = ' + vx + ':1 (exaggerated)') + '</text>';
    s += '</svg>';
    return s;
  }

  var html = '<div style="display:flex;gap:10px;align-items:flex-start">' +
    '<div style="flex:1 1 0;min-width:0">' + panel('TRUE 1:1 SCALE', 1, true) + '</div>' +
    '<div style="flex:1 1 0;min-width:0">' +
      panel('VERTICALLY EXAGGERATED', exag || 6, false) + '</div></div>';

  var reading;
  if (overallDeg < 1.5) {
    reading = 'Over ' + num(len, 0) + ' ft the ground rises only ' + num(relief, 1) +
      ' ft, a direct angle of ' + num(overallDeg, 1) + '&deg;. At true 1:1 scale the profile is ' +
      'almost a straight line, which is the correct reading: this lot is effectively flat. ' +
      'The exaggerated panel is the same data and should not be read as slope.';
  } else if (overallDeg < 6) {
    reading = 'The ground rises ' + num(relief, 1) + ' ft over ' + num(len, 0) +
      ' ft, a direct angle of ' + num(overallDeg, 1) + '&deg; (' +
      num(relief / len * 100, 1) + '% average grade). That is a gentle, buildable fall.';
  } else {
    reading = 'The ground rises ' + num(relief, 1) + ' ft over ' + num(len, 0) +
      ' ft, a direct angle of ' + num(overallDeg, 1) + '&deg; (' +
      num(relief / len * 100, 1) + '% average), and the steepest 50 ft run reaches ' +
      (st ? num(st.grade_pct, 0) + '% (' + num(st.angle_deg, 0) + '&deg;)' : 'n/a') +
      '. This is real, visible slope that will drive access and retaining cost.';
  }

  var stTxt = st ? ('<b>' + num(st.grade_pct, 1) + '%</b> (' + num(st.angle_deg, 1) +
                    '&deg;) over a ' + num(st.run_ft, 0) + ' ft run') : '&mdash;';
  html += '<table class="tight" style="margin-top:4px"><tbody>' +
    '<tr><th>Run A&ndash;B</th><td class="num">' + num(len, 0) + ' ft</td>' +
    '<th>Lowest</th><td class="num">' + num(zmin, 1) + ' ft</td>' +
    '<th>Highest</th><td class="num">' + num(zmax, 1) + ' ft</td></tr>' +
    '<tr><th>Elevation difference</th><td class="num">' + num(relief, 1) + ' ft</td>' +
    '<th>Average grade</th><td class="num">' + num(relief / len * 100, 1) + '%</td>' +
    '<th>Direct rising angle</th><td class="num">' + num(overallDeg, 1) + '&deg;</td></tr>' +
    '<tr><th>Steepest 50 ft</th><td class="num" colspan="5">' + stTxt + '</td></tr>' +
    '</tbody></table>' +
    '<p class="tiny" style="margin-top:2px"><b>Reading:</b> ' + reading + '</p>';
  return html;
}

/* ======================================================================
   FIGURE 3 - isometric 3D terrain from the sampled DEM grid
   ====================================================================== */
function terrain3d(p) {
  var td = p.terrain_data || {}, g = p.geometry || {};
  var gr = td.grid;
  if (!gr || !gr.z) return null;
  var n = gr.n, Z = gr.z;
  var zs = [];
  for (var j = 0; j < n; j++) for (var i = 0; i < n; i++)
    if (Z[j][i] != null) zs.push(Z[j][i]);
  if (zs.length < 10) return null;
  var zmin = Math.min.apply(null, zs), zmax = Math.max.apply(null, zs);
  var relief = (zmax - zmin) || 1;

  var VW = W, VH = 300;
  var step = n > 30 ? 2 : 1;                 // decimate for legibility
  var cols = [];
  for (var c = 0; c < n; c += step) cols.push(c);
  var m = cols.length;

  var cw = VW * 0.40, chh = VH * 0.34;
  var zScale = Math.min(70, Math.max(22, 150 / relief * (relief / 30 + 0.6)));
  var cxp = VW / 2, cyp = VH * 0.62;

  function iso(ix, iy, z) {
    var u = (ix / (m - 1)) - 0.5, v = (iy / (m - 1)) - 0.5;
    var zz = ((z == null ? zmin : z) - zmin) / relief;
    return [cxp + (u - v) * cw, cyp + (u + v) * chh - zz * zScale];
  }
  function colOf(z) {
    var t = (z - zmin) / relief;
    var r = Math.round(90 + 150 * t), gg = Math.round(135 + 70 * (1 - Math.abs(t - .5) * 2));
    var b = Math.round(165 - 95 * t);
    return 'rgb(' + r + ',' + Math.max(90, gg) + ',' + Math.max(55, b) + ')';
  }

  var s = svgEl(VW, VH);
  s += '<rect width="' + VW + '" height="' + VH + '" fill="#fff"/>';
  // painter's order: far (low i+j) first
  var quads = [];
  for (var a = 0; a < m - 1; a++) {
    for (var b2 = 0; b2 < m - 1; b2++) {
      var i0 = cols[a], i1 = cols[a + 1], j0 = cols[b2], j1 = cols[b2 + 1];
      var z00 = Z[j0][i0], z10 = Z[j0][i1], z11 = Z[j1][i1], z01 = Z[j1][i0];
      if (z00 == null || z10 == null || z11 == null || z01 == null) continue;
      quads.push({ k: a + b2, a: a, b: b2, i0: i0, i1: i1, j0: j0, j1: j1,
                   z: [z00, z10, z11, z01] });
    }
  }
  quads.sort(function (x, y) { return x.k - y.k; });
  quads.forEach(function (q) {
    var p00 = iso(q.a, q.b, q.z[0]), p10 = iso(q.a + 1, q.b, q.z[1]);
    var p11 = iso(q.a + 1, q.b + 1, q.z[2]), p01 = iso(q.a, q.b + 1, q.z[3]);
    var mz = (q.z[0] + q.z[1] + q.z[2] + q.z[3]) / 4;
    // crude lambert shade from the quad's own tilt
    var dzdx = (q.z[1] - q.z[0]), dzdy = (q.z[3] - q.z[0]);
    var sh = 1 - Math.min(0.42, Math.abs(dzdx) * 0.05 + Math.abs(dzdy) * 0.028);
    s += '<path d="M' + p00[0].toFixed(1) + ',' + p00[1].toFixed(1) +
         'L' + p10[0].toFixed(1) + ',' + p10[1].toFixed(1) +
         'L' + p11[0].toFixed(1) + ',' + p11[1].toFixed(1) +
         'L' + p01[0].toFixed(1) + ',' + p01[1].toFixed(1) + 'Z" fill="' + colOf(mz) +
         '" fill-opacity="' + sh.toFixed(2) + '" stroke="rgba(255,255,255,.22)" ' +
         'stroke-width=".35"/>';
  });

  // parcel outline draped on the surface
  if (g.ring && gr.gx && gr.gy) {
    var gx = gr.gx, gy = gr.gy;
    function toIdx(lon, lat) {
      var fi = (lon - gx[0]) / (gx[1] - gx[0]);
      var fj = (lat - gy[0]) / (gy[1] - gy[0]);
      return [fi, fj];
    }
    function zAt(fi, fj) {
      var i = Math.max(0, Math.min(n - 1, Math.round(fi)));
      var j = Math.max(0, Math.min(n - 1, Math.round(fj)));
      return Z[j][i];
    }
    var d = '';
    g.ring.forEach(function (cpt, idx) {
      var t = toIdx(cpt[0], cpt[1]);
      var q = iso(t[0] / step, t[1] / step, zAt(t[0], t[1]));
      d += (idx ? 'L' : 'M') + q[0].toFixed(1) + ',' + q[1].toFixed(1);
    });
    d += 'Z';
    s += '<path d="' + d + '" fill="none" stroke="#c0392b" stroke-width="2.2" ' +
         'stroke-linejoin="round"/>';
  }

  // vertical scale key
  s += '<text x="10" y="16" font-size="7" fill="#6b7f91">Sampled window relief ' +
       num(relief, 1) + ' ft &middot; vertical scale exaggerated for legibility</text>';
  s += '<g transform="translate(' + (VW - 112) + ',' + (VH - 30) + ')">';
  for (var t2 = 0; t2 <= 10; t2++) {
    s += '<rect x="' + (t2 * 9) + '" y="0" width="9" height="7" fill="' +
         colOf(zmin + relief * t2 / 10) + '"/>';
  }
  s += '<text x="0" y="16" font-size="6.2" fill="#6b7f91">' + num(zmin, 0) + ' ft</text>' +
       '<text x="99" y="16" font-size="6.2" fill="#6b7f91" text-anchor="end">' +
       num(zmax, 0) + ' ft</text></g>';
  s += '</svg>';
  return s;
}

/* ======================================================================
   FIGURE 4 - ground elevation versus BFE and finished-floor scenarios
   ====================================================================== */
function bfeDiagram(p) {
  var f = p.flood || {};
  var gnd = f.ground || {};
  if (gnd.min_ft == null) return null;
  var bfe = f.bfe_ft;
  var sc = f.ffe_scenarios || [];

  var lo = gnd.min_ft, hi = gnd.max_ft;
  var vals = [lo, hi];
  if (bfe != null) vals.push(bfe);
  sc.forEach(function (s) { vals.push(s.min_ffe_ft); });
  var vmin = Math.min.apply(null, vals), vmax = Math.max.apply(null, vals);
  var pad = Math.max(1.2, (vmax - vmin) * 0.22);
  vmin -= pad; vmax += pad;

  var VW = W, VH = 188, mL = 118, mR = 92, mT = 16, mB = 26;
  var pw = VW - mL - mR, ph = VH - mT - mB;
  function X(v) { return mL + (v - vmin) / (vmax - vmin) * pw; }

  var s = svgEl(VW, VH);
  s += '<rect width="' + VW + '" height="' + VH + '" fill="#fff"/>';
  s += '<rect x="' + mL + '" y="' + mT + '" width="' + pw + '" height="' + ph +
       '" fill="#fbfdfe" stroke="#dde5ec"/>';

  var rows = [];
  rows.push({ lab: 'Natural ground (DEM)', kind: 'band', a: lo, b: hi, col: '#b98f5e' });
  if (bfe != null) rows.push({ lab: 'Indicative BFE', kind: 'mark', a: bfe, col: '#1f6f94' });
  sc.forEach(function (q) {
    rows.push({ lab: 'Min. FFE at BFE +' + q.freeboard_ft + ' ft', kind: 'mark',
                a: q.min_ffe_ft, col: '#9c2b2b',
                extra: (q.fill_or_elevation_above_lowest_ground_ft > 0
                  ? '+' + num(q.fill_or_elevation_above_lowest_ground_ft, 1) +
                    ' ft over low pt' : 'at/below grade') });
  });

  var rh = ph / rows.length;
  rows.forEach(function (r, i) {
    var cy = mT + rh * (i + 0.5);
    s += '<text x="' + (mL - 6) + '" y="' + (cy + 2.6).toFixed(1) +
         '" font-size="6.9" text-anchor="end" fill="#44586b">' + esc(r.lab) + '</text>';
    if (r.kind === 'band') {
      var x1 = X(r.a), x2 = X(r.b);
      s += '<rect x="' + x1.toFixed(1) + '" y="' + (cy - rh * 0.3).toFixed(1) + '" width="' +
           Math.max(2, x2 - x1).toFixed(1) + '" height="' + (rh * 0.6).toFixed(1) +
           '" fill="' + r.col + '" fill-opacity=".55" stroke="' + r.col + '"/>';
      s += '<text x="' + ((x1 + x2) / 2).toFixed(1) + '" y="' + (cy + 2.4).toFixed(1) +
           '" font-size="6.4" text-anchor="middle" fill="#3b2c16" font-weight="700">' +
           num(r.a, 1) + '&ndash;' + num(r.b, 1) + ' ft</text>';
    } else {
      var x = X(r.a);
      s += '<line x1="' + x.toFixed(1) + '" y1="' + (cy - rh * 0.36).toFixed(1) + '" x2="' +
           x.toFixed(1) + '" y2="' + (cy + rh * 0.36).toFixed(1) + '" stroke="' + r.col +
           '" stroke-width="2.4"/>';
      s += '<text x="' + (x + 4).toFixed(1) + '" y="' + (cy + 2.4).toFixed(1) +
           '" font-size="6.6" fill="' + r.col + '" font-weight="700">' + num(r.a, 1) +
           ' ft' + (r.extra ? '  (' + r.extra + ')' : '') + '</text>';
    }
  });

  // axis
  var span = vmax - vmin;
  var stp = span > 40 ? 10 : span > 16 ? 5 : span > 8 ? 2 : 1;
  for (var v = Math.ceil(vmin / stp) * stp; v <= vmax; v += stp) {
    var xx = X(v);
    s += '<line x1="' + xx.toFixed(1) + '" y1="' + (mT + ph) + '" x2="' + xx.toFixed(1) +
         '" y2="' + (mT + ph + 3) + '" stroke="#9fb3c2"/>';
    s += '<text x="' + xx.toFixed(1) + '" y="' + (mT + ph + 12) +
         '" font-size="6.2" text-anchor="middle" fill="#6b7f91">' + v.toFixed(0) + '</text>';
  }
  s += '<text x="' + (mL + pw / 2) + '" y="' + (VH - 3) +
       '" font-size="6.6" text-anchor="middle" fill="#6b7f91">elevation, ft (NAVD88 nominal)</text>';
  s += '</svg>';
  return s;
}

/* ======================================================================
   FIGURE 5 - soil horizon column for the dominant component
   ====================================================================== */
function soilColumn(p) {
  var s0 = p.soil || {};
  if (s0.status !== 'ok' || !s0.components || !s0.components.length) return null;
  var c = s0.components[0];
  var hz = (c.horizons || []).filter(function (h) { return h.top_cm != null && h.bottom_cm != null; });
  if (!hz.length) return null;
  var maxd = Math.max.apply(null, hz.map(function (h) { return h.bottom_cm; }));

  var VW = W, VH = 212, mT = 20, mB = 20;
  var colX = 44, colW = 78, ph = VH - mT - mB;
  function Y(cm) { return mT + cm / maxd * ph; }

  function texCol(h) {
    var cl = h.clay == null ? 20 : h.clay;
    var sa = h.sand == null ? 30 : h.sand;
    var r = Math.round(150 + sa * 0.55 - cl * 0.25);
    var g = Math.round(126 + sa * 0.26 - cl * 0.30);
    var b = Math.round(96 + sa * 0.10 - cl * 0.42);
    return 'rgb(' + Math.max(70, Math.min(226, r)) + ',' + Math.max(60, Math.min(200, g)) +
           ',' + Math.max(45, Math.min(175, b)) + ')';
  }

  var s = svgEl(VW, VH);
  s += '<rect width="' + VW + '" height="' + VH + '" fill="#fff"/>';
  s += '<text x="0" y="11" font-size="7.4" font-weight="700" fill="#10405e">' +
       esc(c.name) + ' &mdash; representative profile</text>';

  hz.forEach(function (h) {
    var y1 = Y(h.top_cm), y2 = Y(h.bottom_cm);
    s += '<rect x="' + colX + '" y="' + y1.toFixed(1) + '" width="' + colW + '" height="' +
         Math.max(1, y2 - y1).toFixed(1) + '" fill="' + texCol(h) +
         '" stroke="#6b5537" stroke-width=".7"/>';
    s += '<text x="' + (colX - 5) + '" y="' + (y1 + 7).toFixed(1) +
         '" font-size="6.2" text-anchor="end" fill="#44586b">' +
         num(h.top_cm, 0) + ' cm</text>';
    if (y2 - y1 > 12) {
      s += '<text x="' + (colX + colW / 2) + '" y="' + ((y1 + y2) / 2 + 2.4).toFixed(1) +
           '" font-size="6.6" text-anchor="middle" fill="#fff" font-weight="700" ' +
           'paint-order="stroke" stroke="rgba(0,0,0,.33)" stroke-width="1.8">' +
           esc(h.hzname || '') + '</text>';
    }
    // data row to the right
    var tx = colX + colW + 14, ty = (y1 + y2) / 2 + 2.4;
    if (y2 - y1 > 10) {
      s += '<text x="' + tx + '" y="' + ty.toFixed(1) + '" font-size="6.3" fill="#44586b">' +
           'clay ' + num(h.clay, 0) + '%  sand ' + num(h.sand, 0) + '%  silt ' +
           num(h.silt, 0) + '%   pH ' + num(h.ph, 1) + '   OM ' + num(h.om, 1) +
           '%   Ksat ' + num(h.ksat, 1) + ' &micro;m/s   LEP ' + num(h.lep, 1) + '%</text>';
    }
  });
  s += '<text x="' + (colX - 5) + '" y="' + (Y(maxd) + 7).toFixed(1) +
       '" font-size="6.2" text-anchor="end" fill="#44586b">' + num(maxd, 0) + ' cm</text>';
  s += '<text x="' + colX + '" y="' + (VH - 5) + '" font-size="6.2" fill="#6b7f91">' +
       'Depth to ' + num(maxd, 0) + ' cm (' + num(cmToIn(maxd), 0) +
       ' in). LEP = linear extensibility, a shrink-swell proxy.</text>';
  s += '</svg>';
  return s;
}

/* ======================================================================
   FIGURE 6 - monthly climate normals (bars = rainfall, lines = temperature)
   ====================================================================== */
function climateChart(p) {
  var c = p.climate;
  if (!c || !c.monthly) return null;
  var M = c.monthly;
  var VW = W, VH = 180, mL = 34, mR = 34, mT = 14, mB = 24;
  var pw = VW - mL - mR, ph = VH - mT - mB;
  var pmax = Math.max.apply(null, M.map(function (m) { return m.precip_mm || 0; })) || 1;
  var tvals = [];
  M.forEach(function (m) {
    if (m.tmax_c != null) tvals.push(m.tmax_c);
    if (m.tmin_c != null) tvals.push(m.tmin_c);
  });
  var tmin = Math.min.apply(null, tvals), tmax = Math.max.apply(null, tvals);
  tmin = Math.min(0, Math.floor(tmin / 5) * 5); tmax = Math.ceil(tmax / 5) * 5;

  function X(i) { return mL + (i + 0.5) / 12 * pw; }
  function YP(v) { return mT + ph - v / (pmax * 1.15) * ph; }
  function YT(v) { return mT + ph - (v - tmin) / (tmax - tmin) * ph; }

  var s = svgEl(VW, VH);
  s += '<rect width="' + VW + '" height="' + VH + '" fill="#fff"/>';
  s += '<rect x="' + mL + '" y="' + mT + '" width="' + pw + '" height="' + ph +
       '" fill="#fbfdfe" stroke="#dde5ec"/>';
  var names = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
  var bw = pw / 12 * 0.56;
  M.forEach(function (m, i) {
    if (m.precip_mm != null) {
      var y = YP(m.precip_mm);
      s += '<rect x="' + (X(i) - bw / 2).toFixed(1) + '" y="' + y.toFixed(1) + '" width="' +
           bw.toFixed(1) + '" height="' + (mT + ph - y).toFixed(1) +
           '" fill="#8fbcd6" fill-opacity=".8"/>';
    }
    s += '<text x="' + X(i).toFixed(1) + '" y="' + (mT + ph + 11) +
         '" font-size="6.4" text-anchor="middle" fill="#6b7f91">' + names[i] + '</text>';
  });
  [['tmax_c', '#c0392b'], ['tmin_c', '#1f6f94']].forEach(function (k) {
    var d = '';
    M.forEach(function (m, i) {
      if (m[k[0]] == null) return;
      d += (d ? 'L' : 'M') + X(i).toFixed(1) + ',' + YT(m[k[0]]).toFixed(1);
    });
    s += '<path d="' + d + '" fill="none" stroke="' + k[1] + '" stroke-width="1.6"/>';
    M.forEach(function (m, i) {
      if (m[k[0]] == null) return;
      s += '<circle cx="' + X(i).toFixed(1) + '" cy="' + YT(m[k[0]]).toFixed(1) +
           '" r="1.7" fill="' + k[1] + '"/>';
    });
  });
  if (tmin < 0) {
    s += '<line x1="' + mL + '" y1="' + YT(0).toFixed(1) + '" x2="' + (mL + pw) + '" y2="' +
         YT(0).toFixed(1) + '" stroke="#9fb3c2" stroke-dasharray="3 2"/>';
  }
  for (var t = tmin; t <= tmax; t += (tmax - tmin > 40 ? 10 : 5)) {
    s += '<text x="' + (mL - 4) + '" y="' + (YT(t) + 2.2).toFixed(1) +
         '" font-size="6.1" text-anchor="end" fill="#c0392b">' + t + '&deg;</text>';
  }
  for (var q = 0; q <= pmax * 1.1; q += (pmax > 200 ? 100 : pmax > 100 ? 50 : 25)) {
    s += '<text x="' + (mL + pw + 4) + '" y="' + (YP(q) + 2.2).toFixed(1) +
         '" font-size="6.1" fill="#1f6f94">' + q + '</text>';
  }
  s += '<text x="' + (mL - 4) + '" y="' + (mT - 4) + '" font-size="6.2" fill="#c0392b" ' +
       'text-anchor="end">&deg;C</text>';
  s += '<text x="' + (mL + pw + 4) + '" y="' + (mT - 4) + '" font-size="6.2" fill="#1f6f94">mm</text>';
  s += '</svg>';
  return s;
}

/* ======================================================================
   FIGURE 7 - portfolio scatter: flood exposure vs terrain
   ====================================================================== */
function portfolioScatter(props) {
  var items = props.filter(function (p) {
    return p.identification && p.identification.status === 'IDENTIFIED' &&
           p.terrain && p.terrain.slope && p.terrain.slope.mean_pct != null;
  });
  if (items.length < 2) return null;
  var VW = W, VH = 260, mL = 46, mR = 14, mT = 16, mB = 34;
  var pw = VW - mL - mR, ph = VH - mT - mB;
  var sx = Math.max.apply(null, items.map(function (p) { return p.terrain.slope.mean_pct; }));
  sx = Math.max(sx * 1.15, 4);
  var reliefs = items.map(function (p) { return (p.terrain.parcel_elevation_ft || {}).relief_ft || 0; });
  var ry = Math.max(Math.max.apply(null, reliefs) * 1.15, 6);

  function X(v) { return mL + v / sx * pw; }
  function Y(v) { return mT + ph - v / ry * ph; }

  var s = svgEl(VW, VH);
  s += '<rect width="' + VW + '" height="' + VH + '" fill="#fff"/>';
  s += '<rect x="' + mL + '" y="' + mT + '" width="' + pw + '" height="' + ph +
       '" fill="#fbfdfe" stroke="#dde5ec"/>';
  for (var gx2 = 0; gx2 <= sx; gx2 += (sx > 10 ? 2 : 1)) {
    s += '<line x1="' + X(gx2).toFixed(1) + '" y1="' + mT + '" x2="' + X(gx2).toFixed(1) +
         '" y2="' + (mT + ph) + '" stroke="#eef3f7"/>' +
         '<text x="' + X(gx2).toFixed(1) + '" y="' + (mT + ph + 11) +
         '" font-size="6.2" text-anchor="middle" fill="#6b7f91">' + gx2 + '%</text>';
  }
  for (var gy2 = 0; gy2 <= ry; gy2 += (ry > 60 ? 20 : ry > 30 ? 10 : 5)) {
    s += '<line x1="' + mL + '" y1="' + Y(gy2).toFixed(1) + '" x2="' + (mL + pw) + '" y2="' +
         Y(gy2).toFixed(1) + '" stroke="#eef3f7"/>' +
         '<text x="' + (mL - 4) + '" y="' + (Y(gy2) + 2.2).toFixed(1) +
         '" font-size="6.2" text-anchor="end" fill="#6b7f91">' + gy2 + '</text>';
  }
  items.forEach(function (p) {
    var inS = p.flood && p.flood.in_sfha;
    var und = p.flood && p.flood.coverage_verdict &&
              p.flood.coverage_verdict.indexOf('unmapped') >= 0;
    var col = inS ? '#c0392b' : (und ? '#9a6212' : '#17724a');
    var x = X(p.terrain.slope.mean_pct);
    var y = Y((p.terrain.parcel_elevation_ft || {}).relief_ft || 0);
    s += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="5.4" fill="' + col +
         '" fill-opacity=".82" stroke="#fff" stroke-width="1.1"/>';
    s += '<text x="' + (x + 7).toFixed(1) + '" y="' + (y + 2.6).toFixed(1) +
         '" font-size="6.3" fill="#15202b">' + esc(shortName(p)) + '</text>';
  });
  s += '<text x="' + (mL + pw / 2) + '" y="' + (VH - 4) +
       '" font-size="6.8" text-anchor="middle" fill="#44586b">mean DEM grade across the lot (%)</text>';
  s += '<text x="12" y="' + (mT + ph / 2) + '" font-size="6.8" fill="#44586b" ' +
       'transform="rotate(-90 12,' + (mT + ph / 2) + ')" text-anchor="middle">' +
       'elevation relief within lot (ft)</text>';
  s += '</svg>';
  return s;
}

function shortName(p) {
  var l = p.label || '';
  return l.split(',')[0];
}

/* ======================================================================
   Items that cannot be established from public geospatial data.
   Each entry names the question and the authoritative place to get it,
   so the gap is actionable rather than hidden.
   ====================================================================== */
var REQ = {
  utilities: [
    ['Water supply: municipal, water-supply-corporation, or private well; is a tap at the road?',
     'Serving water supply corporation / county; well logs via TX Water Development Board'],
    ['Sewer: is public sewer available, or is an on-site facility required? Distance to any main.',
     'County / city utility department or MUD'],
    ['Electricity: provider, whether service exists at the lot line, overhead vs underground, connection cost.',
     'Retail electric provider / local co-op (service availability letter)'],
    ['Natural gas or propane availability and existing infrastructure.',
     'Gas utility or local propane suppliers'],
    ['Internet: fibre, cable, fixed wireless, DSL or satellite, with advertised speeds.',
     'FCC National Broadband Map plus a direct serviceability check by address']
  ],
  hoa: [
    ['Whether an HOA or POA exists and is mandatory, with its name and management contact.',
     'Title commitment, recorded Declaration, seller disclosure'],
    ['Annual dues, monthly equivalent, transfer fee, and any special assessment.',
     'HOA or management company estoppel / resale certificate'],
    ['Declaration, CC&Rs, architectural guidelines, rules and all amendments.',
     'HOA or title company'],
    ['Restrictions on docks, fences, outbuildings, RVs, boats, livestock and poultry.',
     'Recorded CC&Rs and architectural guidelines'],
    ['Minimum dwelling size and any construction time limit after purchase.',
     'Recorded CC&Rs'],
    ['Amenities actually included: clubhouse, pool, courts, parks, lake and boat facilities.',
     'HOA documents and budget']
  ],
  zoning: [
    ['Zoning designation, or confirmation that the county is unzoned.',
     'County or city development services'],
    ['Minimum lot size, building coverage, setbacks, height limits, accessory-structure rules.',
     'County/city development standards or subdivision regulations'],
    ['Whether a second independent dwelling or in-law suite (ADU) is permitted, and on what terms.',
     'County/city development services plus the HOA'],
    ['Permitting path, driveway/culvert permit and any development fee.',
     'County permitting office']
  ],
  dock: [
    ['Whether a dock is permittable at this shoreline, and the governing authority.',
     'Controlling lake / river authority, plus the HOA'],
    ['Dock size limits, shoreline setbacks, shared-dock rules and permit cost.',
     'Lake authority rules and permit schedule'],
    ['Whether riparian or shoreline rights pass with the lot, or the shoreline is a common reserve.',
     'Title commitment and recorded plat'],
    ['Lake water-level regime and any shoreline-management plan.',
     'Lake/river authority or reservoir operator']
  ],
  lake: [
    ['Bathymetry: average and maximum depth, and depth near this shoreline.',
     'Lake authority survey, TPWD reservoir report, or a sonar survey'],
    ['Seasonal water-level variation and drawdown history.',
     'Reservoir operator gauge records / USGS gauges'],
    ['Boating rules: permitted craft, motor limits, wake rules, ramps and marinas.',
     'Lake authority and TPWD'],
    ['Fishery: species present, stocking, licence requirements and catch limits.',
     'Texas Parks & Wildlife reservoir survey reports']
  ],
  str: [
    ['Whether short-term rental is permitted at this location.',
     'County/city ordinance and the HOA'],
    ['Any STR permit, occupancy cap, parking or noise condition.',
     'Local ordinance'],
    ['Hotel occupancy tax registration and remittance obligations.',
     'Texas Comptroller plus local taxing authority']
  ],
  farm: [
    ['Whether chickens, ducks, rabbits, goats or bees are allowed, and in what numbers.',
     'County rules plus the recorded CC&Rs (either can prohibit)'],
    ['Any agricultural or wildlife valuation currently on the parcel, and rollback-tax exposure if use changes.',
     'County appraisal district']
  ],
  services: [
    ['Driving distance and time to the nearest hospital, emergency department and urgent care.',
     'Direct routing check from the confirmed parcel location'],
    ['Distance to grocery, major retail, pharmacy, bank, fuel and hardware.',
     'Direct routing check'],
    ['Assigned school district and campuses, with distances and current ratings.',
     'TEA school-district locator and the district attendance-zone map'],
    ['Nearest Indian / South Asian grocery, restaurants and places of worship.',
     'Direct search from the confirmed parcel location'],
    ['Nearest international airport, driving time and route.',
     'Direct routing check'],
    ['Walk / Bike / Transit scores.',
     'Walk Score for the confirmed address']
  ],
  docsSite: [
    ['Existing FEMA Elevation Certificate for the lot.',
     'Seller, county floodplain office or a surveyor'],
    ['Recent boundary, ALTA or topographic survey.',
     'Seller or a licensed Texas surveyor (RPLS)'],
    ['Geotechnical / soil boring report.',
     'Seller or a geotechnical engineer'],
    ['On-site sewage facility site evaluation and percolation test.',
     'Licensed site evaluator / county OSSF office'],
    ['Any ground-penetrating-radar or other subsurface investigation.',
     'Seller; commission if subsurface features are suspected']
  ]
};

function reqList(items, title) {
  var h = '<div class="req-only">';
  var open = '<div class="split-list">';
  if (title) h += '<h4 class="sub2">' + esc(title) + ' <span class="tier tier-required">' +
                  'Needs confirmation</span></h4>';
  h += open;
  items.forEach(function (it) {
    h += '<div class="req-item"><span class="q">' + esc(it[0]) +
         '</span><br><span class="src">Obtain from: ' + esc(it[1]) + '</span></div>';
  });
  h += '</div></div>';
  return h;
}

/* ------------------------------------------------- per-property content */
function propertyBlocks(p, idx, total) {
  var B = [];
  function push(html, glue) { B.push({ html: html, glue: !!glue }); }

  var id = p.identification || {};
  var identified = id.status === 'IDENTIFIED';
  var lowConf = identified && /LOW/i.test(id.match_confidence || '');

  /* ---- title ---- */
  var conf = id.match_confidence || 'n/a';
  var confCls = /^high/i.test(conf) ? 'ok' : /^medium/i.test(conf) ? 'warn' : 'bad';
  push('<h2 class="sec">' + esc(p.label) + '</h2>' +
       '<div style="display:flex;gap:7px;flex-wrap:wrap;align-items:center;margin-bottom:5px">' +
       '<span class="pill neutral">Lot ' + (idx + 1) + ' of ' + total + '</span>' +
       (identified ? '<span class="pill ' + confCls + '">ID confidence: ' + esc(conf) + '</span>'
                   : '<span class="pill bad">Parcel not identified</span>') +
       (id.subdivision ? '<span class="pill neutral">' + esc(id.subdivision) + '</span>' : '') +
       (id.county ? '<span class="pill neutral">' + esc(id.county) + '</span>' : '') +
       '</div>', true);

  if (!identified) {
    push('<div class="note bad"><span class="ttl">This lot could not be located in the ' +
      'statewide parcel record</span>' + esc(id.note || '') + '</div>');
    push('<p>Because the parcel boundary is unknown, no flood zone, elevation, slope or soil ' +
      'result can be attributed to this lot. Everything downstream of parcel identification is ' +
      'therefore withheld rather than estimated. Resolve identification first:</p>' +
      '<ul><li>Ask the listing agent for the county parcel ID / account number.</li>' +
      '<li>Search the county appraisal district by owner or address.</li>' +
      '<li>Obtain the recorded plat and the legal description from the title company.</li></ul>');
    push(reqList([['Parcel ID / account number and legal description for this address.',
                   'Listing agent or the county appraisal district'],
                  ['Recorded plat showing the lot within its subdivision.',
                   'County Clerk plat records']], 'Required before any analysis'));
    return B;
  }

  if (lowConf) {
    push('<div class="note bad"><span class="ttl">Read this before anything else on this lot</span>' +
      esc(id.match_confidence_note) + '</div>');
  } else if (/^medium/i.test(conf)) {
    push('<div class="note warn"><span class="ttl">Identification caveat</span>' +
      esc(id.match_confidence_note) + '</div>');
  }

  /* ---- A. identification ---- */
  push('<h3 class="sub"><span class="n">A1</span>Property identification &amp; record data ' +
    tierTag(id.tier) + '</h3>' +
    '<table class="kv split-ok"><tbody>' +
    row('Situs address of record', escOr(id.situs_address)) +
    row('Legal description', '<span class="wrapq">' + escOr(id.legal_description) + '</span>') +
    row('Subdivision', esc(or(id.subdivision, 'not stated in the record'))) +
    row('County', escOr(id.county) + (id.county_fips ? ' (FIPS ' + esc(id.county_fips) + ')' : '')) +
    row('Parcel ID / account', escOr(id.parcel_id)) +
    row('Geographic ID (APN)', escOr(id.geo_id_apn)) +
    row('Owner of record', escOr(id.owner_of_record)) +
    row('Acreage &mdash; appraisal roll (legal)', num(id.legal_acres, 2) + ' ac') +
    row('Acreage &mdash; GIS polygon', num(id.gis_acres, 3) + ' ac') +
    row('Acreage &mdash; recomputed from boundary', num(id.computed_acres, 3) + ' ac') +
    row('Appraised land value', usd(id.land_value_usd)) +
    row('Appraised improvement value', usd(id.improvement_value_usd)) +
    row('Appraised market value', usd(id.market_value_usd)) +
    row('Centroid (WGS84)', id.centroid ? num(id.centroid.lat, 6) + ', ' + num(id.centroid.lon, 6) : '&mdash;') +
    row('Longest axis / width', id.extent ? num(id.extent.length_ft, 0) + ' ft &times; ' +
        num(id.extent.width_ft, 0) + ' ft (axis bearing ' + num(id.extent.bearing_deg, 0) + '&deg;)' : '&mdash;') +
    '</tbody></table>' +
    '<small>Source: ' + esc(id.source) + '. Matched by ' + esc(id.resolved_by) + '. ' +
    'Appraisal-roll acreage and a GIS polygon rarely agree exactly; neither replaces a survey.</small>');

  /* ---- A2 listing ---- */
  push(reqList([
    ['Current asking price, days on market and listing history.',
     'Listing agent / MLS'],
    ['Listing photographs: lot frontage, shoreline, road access and surroundings.',
     'Listing agent (Zillow blocks automated retrieval, so no listing imagery is reproduced here)'],
    ['Seller disclosure notice and any known defects.',
     'Listing agent'],
    ['Recorded plat and Esri/county GIS parcel exhibit for comparison with this report.',
     'County Clerk plat records and the county GIS portal']
  ], 'A2 \u00b7 Listing and plat material not retrievable here'));

  /* ---- B. terrain ---- */
  var t = p.terrain || {};
  var par = t.parcel_elevation_ft || {};
  var sl = t.slope || {};
  var cls = t.classification || {};
  push('<h3 class="sub"><span class="n">B5</span>Terrain, contours and true-scale site plan ' +
    tierTag('MODEL') + '</h3>' +
    '<div class="grid4">' +
    stat('Lowest point', num(par.min_ft, 1), 'ft') +
    stat('Highest point', num(par.max_ft, 1), 'ft') +
    stat('Relief', num(par.relief_ft, 1), 'ft') +
    stat('Mean elevation', num(par.mean_ft, 1), 'ft') +
    '</div>', true);

  var map = siteMap(p);
  if (map) {
    push('<figure class="figbox">' + map +
      '<figcaption><b>True-scale site plan.</b> Parcel boundary from the county GIS polygon; ' +
      'contours at ' + num(t.contour_interval_ft, 1) + ' ft intervals derived from the USGS 3DEP ' +
      '1 m bare-earth DEM. A&ndash;B is the cross-section line. Horizontal and vertical map ' +
      'scales are equal, so shapes and distances are undistorted.</figcaption></figure>');
  }

  push('<div class="grid4">' +
    stat('Mean grade', num(sl.mean_pct, 2), '%') +
    stat('Median grade', num(sl.median_pct, 2), '%') +
    stat('90th pct grade', num(sl.p90_pct, 2), '%') +
    stat('Max grade', num(sl.max_pct, 2), '%') +
    '</div>' +
    '<table class="tight"><tbody>' +
    '<tr><th>Mean slope angle</th><td class="num">' + num(sl.mean_deg, 2) + '&deg;</td>' +
    '<th>90th pct angle</th><td class="num">' + num(sl.p90_deg, 2) + '&deg;</td>' +
    '<th>Max angle</th><td class="num">' + num(sl.max_deg, 2) + '&deg;</td>' +
    '<th>Grid cells</th><td class="num">' + num(sl.n_cells, 0) + '</td></tr></tbody></table>');

  push('<h4 class="sub2">B7 \u00b7 Terrain classification</h4>' +
    '<p><b class="k">' + esc(or(cls.band, 'not classified')) + '.</b> ' + esc(or(cls.note, '')) +
    '</p><p class="tiny muted">Basis: ' + esc(or(cls.basis, '')) + '</p>' +
    (cls.caveat ? '<div class="note warn">' + esc(cls.caveat) + '</div>' : '') +
    '<p><b>Grading expectation:</b> ' +
    esc((cls.grading_expectation || []).join('; ') || '&mdash;') + '</p>');

  var xs = crossSection(p, 6);
  if (xs) {
    push('<h3 class="sub"><span class="n">B6</span>Longitudinal cross-section ' +
      tierTag('MODEL') + '</h3>' +
      '<figure class="figbox">' + xs +
      '<figcaption><b>Left panel is the real geometry</b> at 1:1 vertical-to-horizontal scale. ' +
      'The right panel exaggerates the vertical axis, which is how slope is conventionally ' +
      'drawn on maps but overstates steepness. The shaded band marks the steepest 50 ft run. ' +
      'Profile sampled from the 3DEP DEM along the lot\u2019s longest axis.</figcaption></figure>');
  }

  var t3 = terrain3d(p);
  if (t3) {
    push('<h3 class="sub"><span class="n">B8</span>Three-dimensional terrain ' + tierTag('MODEL') +
      '</h3><figure class="figbox">' + t3 +
      '<figcaption>Isometric view of the sampled DEM window; the red outline is the parcel ' +
      'boundary draped on the surface. Vertical scale is exaggerated to reveal form &mdash; ' +
      'use the 1:1 cross-section above for true steepness.</figcaption></figure>');
  }
  return B.concat(propertyBlocks2(p));
}

function row(k, v) { return '<tr><th>' + k + '</th><td>' + v + '</td></tr>'; }
function stat(lab, val, uom) {
  return '<div class="stat"><div class="lab">' + lab + '</div><div class="val">' + val +
         (uom ? ' <span class="uom">' + uom + '</span>' : '') + '</div></div>';
}

/* ---- C through M -------------------------------------------------- */
function propertyBlocks2(p) {
  var B = [];
  function push(html, glue) { B.push({ html: html, glue: !!glue }); }

  /* ---- C. flood ---- */
  var f = p.flood || {};
  var zoneTxt = (f.zones && f.zones.length) ? f.zones.join(' + ') : 'no polygon on parcel';
  var inS = f.in_sfha;
  push('<h3 class="sub"><span class="n">C9</span>FEMA flood-zone determination ' +
    tierTag('OFFICIAL') + '</h3>' +
    '<div style="display:flex;gap:7px;flex-wrap:wrap;margin-bottom:4px">' +
    '<span class="pill ' + (inS ? 'bad' : 'ok') + '">Zone: ' + esc(zoneTxt) + '</span>' +
    '<span class="pill ' + (inS ? 'bad' : 'neutral') + '">' +
    (inS ? 'Inside Special Flood Hazard Area' : 'Not in a mapped SFHA') + '</span>' +
    (f.split_zone ? '<span class="pill warn">Split zone</span>' : '') +
    '</div>' +
    '<table class="kv"><tbody>' +
    row('Zones intersecting the parcel', esc(zoneTxt)) +
    row('Special Flood Hazard Area', inS ? 'Yes &mdash; mandatory flood insurance for a federally backed mortgage' : 'Not per the national layer') +
    row('FIRM panel', f.firm_panel ? esc(f.firm_panel.panel) + ' &middot; effective ' +
        esc(or(f.firm_panel.effective_date, 'n/a')) : '&mdash;') +
    row('Mapping status', escOr(f.coverage_verdict)) +
    '</tbody></table>' +
    (f.coverage_note ? '<div class="note ' + (inS ? 'bad' : 'warn') + '">' +
      esc(f.coverage_note) + '</div>' : ''), true);

  if (f.bfe_ft != null || (f.ground && f.ground.min_ft != null)) {
    push('<h3 class="sub"><span class="n">C11-13</span>Ground elevation, BFE and minimum ' +
      'finished floor ' + tierTag('OFFICIAL+MODEL') + '</h3>' +
      '<table class="kv"><tbody>' +
      row('Lowest natural ground (DEM)', num((f.ground || {}).min_ft, 2) + ' ft') +
      row('Highest natural ground (DEM)', num((f.ground || {}).max_ft, 2) + ' ft') +
      row('Mean ground', num((f.ground || {}).mean_ft, 2) + ' ft') +
      row('Indicative BFE', f.bfe_ft != null ? num(f.bfe_ft, 1) + ' ft' :
          '<span class="pill warn">not published for this location</span>') +
      (f.lowest_vs_bfe_ft != null ?
        row('Lowest ground relative to BFE', '<b style="color:' +
          (f.lowest_vs_bfe_ft < 0 ? '#9c2b2b' : '#17724a') + '">' +
          (f.lowest_vs_bfe_ft > 0 ? '+' : '') + num(f.lowest_vs_bfe_ft, 2) + ' ft</b>') : '') +
      (f.highest_vs_bfe_ft != null ?
        row('Highest ground relative to BFE', (f.highest_vs_bfe_ft > 0 ? '+' : '') +
          num(f.highest_vs_bfe_ft, 2) + ' ft') : '') +
      '</tbody></table>' +
      (f.bfe_source ? '<small><b>BFE basis:</b> ' + esc(f.bfe_source) + '</small>' : ''), true);

    var bd = bfeDiagram(p);
    if (bd) {
      push('<figure class="figbox">' + bd +
        '<figcaption><b>Freeboard scenarios.</b> The brown band is the measured spread of ' +
        'natural ground across the lot. Red ticks are the minimum finished-floor elevation at ' +
        'BFE plus 0, 1, 2 and 3 ft of freeboard. <b>The freeboard the county actually enforces ' +
        'is not established in this report</b> &mdash; the scenarios show the consequence of each, ' +
        'they do not assert a requirement.</figcaption></figure>');
    }
    if (f.ffe_scenarios) {
      var rowsH = '';
      f.ffe_scenarios.forEach(function (s) {
        rowsH += '<tr><td class="num">BFE + ' + s.freeboard_ft + ' ft</td><td class="num">' +
          num(s.min_ffe_ft, 2) + '</td><td class="num">' +
          num(s.fill_or_elevation_above_lowest_ground_ft, 2) + '</td><td class="num">' +
          num(s.fill_or_elevation_above_highest_ground_ft, 2) + '</td></tr>';
      });
      push('<table class="tight"><thead><tr><th>Scenario</th>' +
        '<th class="num">Min. finished floor (ft)</th>' +
        '<th class="num">Rise above lowest ground (ft)</th>' +
        '<th class="num">Rise above highest ground (ft)</th></tr></thead><tbody>' +
        rowsH + '</tbody></table>' +
        (f.interpretation ? '<div class="note ' + (inS ? 'bad' : '') + '">' +
          esc(f.interpretation) + '</div>' : '') +
        '<div class="note warn"><span class="ttl">Do not assume fill is permitted</span>' +
        'Raising a pad with fill inside a mapped floodplain is frequently restricted or ' +
        'requires compensatory storage and a floodplain development permit. Elevating on piers ' +
        'or a stem wall is often the permitted route instead. This must be confirmed with the ' +
        'county floodplain administrator before any design assumption is made.</div>');
    }
  }

  push(reqList([
    ['Official flood determination and the effective FIRM panel read at the parcel.',
     'County floodplain administrator or a flood certification service'],
    ['Enforced freeboard above BFE, fill rules and compensatory-storage requirements.',
     'County floodplain administrator'],
    ['First Street / third-party forward-looking flood risk and estimated flood depth.',
     'First Street Foundation (riskfactor.com) for the confirmed address'],
    ['Flood insurance quote under current NFIP pricing.',
     'Insurance agent, using an Elevation Certificate'],
    ['Site drainage: swales, culverts, outfall and upstream runoff from neighbouring lots.',
     'Civil engineer site visit; county drainage criteria']
  ], 'C \u00b7 Flood items still to confirm'));

  /* ---- D. soil ---- */
  var s0 = p.soil || {};
  if (s0.status === 'ok') {
    var mu = s0.mapunits || [];
    var muRows = mu.map(function (m) {
      return '<tr><td>' + esc(m.muname) + '</td><td class="num">' +
        (m.pct_of_lot == null ? '&mdash;' : num(m.pct_of_lot, 1) + '%') + '</td></tr>';
    }).join('');
    push('<h3 class="sub"><span class="n">D14</span>Soil characteristics ' + tierTag('MODEL') +
      '</h3>' +
      '<table class="tight"><thead><tr><th>NRCS map unit intersecting the lot</th>' +
      '<th class="num">Share of lot (sampled)</th></tr></thead><tbody>' + muRows +
      '</tbody></table>', true);

    var cRows = (s0.components || []).map(function (c) {
      return '<tr><td><b>' + esc(c.name) + '</b></td><td class="num">' + num(c.pct, 0) + '%</td>' +
        '<td>' + escOr(c.drainage) + '</td><td>' + escOr(c.hydgroup) + '</td>' +
        '<td class="num">' + num(c.lep_max_pct, 1) + '</td>' +
        '<td>' + escOr(c.shrink_swell) + '</td>' +
        '<td class="num">' + num(c.ph_surface, 1) + '</td>' +
        '<td class="num">' + num(c.clay_pct_surface, 0) + '</td>' +
        '<td>' + escOr(c.flooding_frequency) + '</td></tr>';
    }).join('');
    push('<table class="tight"><thead><tr><th>Component</th><th class="num">%</th>' +
      '<th>Drainage</th><th>Hyd.grp</th><th class="num">LEP %</th><th>Shrink-swell</th>' +
      '<th class="num">pH</th><th class="num">Clay %</th><th>Flooding</th></tr></thead><tbody>' +
      cRows + '</tbody></table>' +
      '<small>LEP = linear extensibility (shrink-swell proxy). Hydrologic group D indicates the ' +
      'slowest infiltration. Values are NRCS representative values for the map unit, not ' +
      'measurements on this lot.</small>');

    var hcol = soilColumn(p);
    if (hcol) {
      push('<figure class="figbox">' + hcol +
        '<figcaption>Representative horizon sequence for the dominant component ' +
        '(' + esc(s0.dominant_component) + ').</figcaption></figure>');
    }

    var c0 = (s0.components || [{}])[0];
    var fo = p.foundation || {};
    var fmRows = Object.keys(fo.matrix || {}).map(function (k) {
      return '<tr><th>' + esc(k) + '</th><td>' + esc(fo.matrix[k]) + '</td></tr>';
    }).join('');
    push('<h3 class="sub"><span class="n">D15</span>Foundation suitability ' + tierTag('MODEL') +
      '</h3>' +
      '<p>Dominant soil shrink-swell potential is <b class="k">' +
      esc(or(fo.shrink_swell, 'not rated')) + '</b>' +
      (c0.lep_max_pct != null ? ' (peak LEP ' + num(c0.lep_max_pct, 1) + '%)' : '') + '. ' +
      esc(or(fo.note, '')) + '</p>' +
      '<table class="kv"><tbody>' + fmRows +
      row('NRCS rating, dwellings without basements', escOr(fo.dwellings_rating)) +
      row('Geotechnical investigation advised', fo.geotech_advised ?
        '<span class="pill bad">Yes</span>' : '<span class="pill ok">Not indicated</span>') +
      '</tbody></table>' +
      '<div class="note warn">' + esc(or(fo.caveat, '')) + '</div>');

    /* septic */
    var sp = p.septic || {};
    if (sp.status === 'ok') {
      var rr = Object.keys(sp.ratings || {}).map(function (k) {
        var v = sp.ratings[k];
        var cl = v === 'Very limited' ? 'bad' : v === 'Somewhat limited' ? 'warn' : 'ok';
        return '<tr><th>' + esc(k.replace('ENG - ', '')) + '</th><td><span class="pill ' + cl +
          '">' + esc(v) + '</span></td></tr>';
      }).join('');
      push('<h3 class="sub"><span class="n">D16</span>Septic / on-site sewage suitability ' +
        tierTag('MODEL') + '</h3>' +
        '<table class="kv"><tbody>' + rr + '</tbody></table>' +
        (sp.constraints && sp.constraints.length ?
          '<h4 class="sub2">Constraints identified from the soil and terrain data</h4><ul>' +
          sp.constraints.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>'
          : '') +
        '<div class="note bad"><span class="ttl">Permitted bedroom count: ' +
        esc(sp.bedroom_capacity.status) + '</span>' + esc(sp.bedroom_capacity.why) + '</div>' +
        '<small>' + esc(or(sp.caveat, '')) + '</small>');
    }

    /* garden */
    var gd = p.garden || {};
    if (gd.status === 'ok') {
      push('<h3 class="sub"><span class="n">D17</span>Gardening suitability ' + tierTag('MODEL') +
        '</h3>' +
        '<div class="grid4">' +
        stat('Surface pH', num(gd.surface_ph, 1), '') +
        stat('Clay', num(gd.clay_pct, 0), '%') +
        stat('Sand', num(gd.sand_pct, 0), '%') +
        stat('Organic matter', num(gd.om_pct, 1), '%') +
        '</div>' +
        '<table class="kv"><tbody>' +
        row('Drainage class', escOr(gd.drainage)) +
        row('pH range through profile', gd.ph_range ? num(gd.ph_range[0], 1) + ' &ndash; ' +
          num(gd.ph_range[1], 1) : '&mdash;') +
        row('NRCS lawn / landscape rating', escOr(gd.lawn_landscape_rating)) +
        row('Raised beds advised', gd.raised_beds_advised ?
          '<span class="pill warn">Yes</span>' : '<span class="pill ok">Not necessary</span>') +
        '</tbody></table>' +
        '<p class="tiny">' + esc(or(gd.raised_beds_reason, '')) + '</p>' +
        '<h4 class="sub2">Likely amendments</h4><ul>' +
        (gd.likely_amendments || []).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') +
        '</ul><div class="note warn">' + esc(or(gd.caveat, '')) + '</div>');
    }
    push(reqList([
      ['Laboratory soil test: pH, macro and micronutrients, organic matter, texture.',
       'Texas A&M AgriLife Soil Testing Lab, from samples taken on the lot'],
      ['Plant hardiness zone confirmation and a species list matched to the tested soil.',
       'USDA hardiness map plus the county AgriLife extension office']
    ], 'D \u00b7 Soil and planting items to confirm'));
  } else {
    push('<h3 class="sub"><span class="n">D14</span>Soil characteristics</h3>' +
      '<div class="note bad">No NRCS soil data could be attributed to this parcel.</div>');
  }

  /* ---- E. utilities ---- */
  push('<h3 class="sub"><span class="n">E19-23</span>Utilities and infrastructure ' +
    tierTag('REQUIRED') + '</h3>' +
    '<p>Utility availability is not published as open geospatial data at parcel level. Nothing ' +
    'is inferred here: each item below must come from the serving utility in writing, because ' +
    'a missing water tap or a long electric extension can change the build budget materially.</p>' +
    reqList(REQ.utilities), true);

  /* ---- F. water / dock ---- */
  var w = p.water || {};
  var wd = w.distance_ft;
  var wcls = wd == null ? 'neutral' : wd <= 50 ? 'ok' : wd <= 300 ? 'warn' : 'neutral';
  push('<h3 class="sub"><span class="n">F24-25</span>Waterfront position ' + tierTag('MODEL') +
    '</h3>' +
    '<div style="display:flex;gap:7px;flex-wrap:wrap;margin-bottom:4px">' +
    '<span class="pill ' + wcls + '">' + esc(or(w.status, 'not assessed')) + '</span>' +
    (w.nearest && w.nearest.name ? '<span class="pill neutral">' + esc(w.nearest.name) +
      '</span>' : '') + '</div>' +
    '<table class="kv"><tbody>' +
    row('Nearest mapped waterbody', esc(or((w.nearest || {}).name, 'unnamed waterbody'))) +
    row('Distance from parcel boundary', wd == null ? '&mdash;' : num(wd, 0) + ' ft') +
    row('Waterbody area', (w.nearest || {}).area_sqkm != null ?
      num((w.nearest || {}).area_sqkm, 3) + ' km&sup2;' : '&mdash;') +
    '</tbody></table>' +
    '<div class="note warn">' + esc(or(w.caveat, '')) + '</div>', true);
  push(reqList(REQ.dock.concat(REQ.lake), 'F26-29 \u00b7 Dock, depth, boating and fishing'));

  /* ---- G. HOA / zoning ---- */
  push('<h3 class="sub"><span class="n">G30-33</span>HOA, covenants, zoning and a second ' +
    'dwelling ' + tierTag('REQUIRED') + '</h3>' +
    (p.identification.subdivision ?
      '<p>The parcel sits in <b class="k">' + esc(p.identification.subdivision) +
      '</b> according to the recorded legal description, so a declaration of covenants very ' +
      'likely exists. The documents themselves are not public geospatial data and were not ' +
      'retrieved, so no dues figure, restriction or amenity is asserted here.</p>' : '') +
    reqList(REQ.hoa) + reqList(REQ.zoning), true);

  /* ---- H / I ---- */
  push('<h3 class="sub"><span class="n">H34 / I35</span>Hobby farming and short-term rental ' +
    tierTag('REQUIRED') + '</h3>' + reqList(REQ.farm) + reqList(REQ.str), true);

  /* ---- J. environmental docs ---- */
  push('<h3 class="sub"><span class="n">J36-42</span>Environmental and geological due diligence ' +
    tierTag('MODEL') + '</h3>' +
    '<table class="kv"><tbody>' +
    row('Ground-penetrating radar penetration (NRCS rating)',
      escOr((s0.headline || {}).gpr_penetration) +
      '<br><small>Indicates how useful GPR would be here; clay-rich soils attenuate the signal.</small>') +
    row('Sinkhole / karst exposure', 'Not indicated by the soil map units returned for this ' +
      'parcel. No restrictive bedrock or karst feature was reported. <span class="tier ' +
      'tier-required">Confirm with TX Bureau of Economic Geology</span>') +
    row('Radon', 'EPA publishes radon zones by county, not by parcel. <span class="tier ' +
      'tier-required">Look up the county zone and test any built structure</span>') +
    '</tbody></table>' +
    reqList(REQ.docsSite), true);

  /* ---- K. construction feasibility ---- */
  var cls2 = (p.terrain || {}).classification || {};
  var fo2 = p.foundation || {};
  push('<h3 class="sub"><span class="n">K43-45</span>Residential construction feasibility ' +
    tierTag('MODEL') + '</h3>' +
    '<table class="kv"><tbody>' +
    row('Lot area available', num(p.identification.gis_acres, 3) + ' ac (' +
      num((p.identification.gis_acres || 0) * 43560, 0) + ' sq ft)') +
    row('Usable building envelope', '<span class="tier tier-required">Not computable</span> ' +
      'Setbacks, easements and any lake or drainage reserve come from the recorded plat and the ' +
      'HOA architectural guidelines, none of which were available.') +
    row('Terrain constraint', escOr(cls2.band) + ' &mdash; ' +
      esc((cls2.grading_expectation || []).join('; '))) +
    row('Foundation implication', escOr(fo2.shrink_swell) +
      ' shrink-swell. ' + esc(or(fo2.note, ''))) +
    row('Flood implication', f.in_sfha ?
      'Inside a mapped SFHA, so finished-floor elevation, flood venting and insurance all bind the design.' :
      'No mapped SFHA on the parcel per the national layer; confirm on the effective FIRM.') +
    '</tbody></table>' +
    '<div class="note warn"><span class="ttl">Construction cost</span>No build cost is ' +
    'estimated in this report. A defensible figure for a four-bedroom house depends on the ' +
    'HOA\u2019s minimum size and material rules, the finished-floor elevation forced by the flood ' +
    'zone, the foundation type the soil requires, and whether water and sewer must be created ' +
    'on site. Three of those four inputs are still unconfirmed for this lot, so any number ' +
    'quoted now would be arbitrary. Price it from a builder bid once the plat, CC&amp;Rs, ' +
    'floodplain requirement and soil report are in hand.</div>', true);

  /* ---- L. climate ---- */
  var cl = p.climate;
  if (cl) {
    push('<h3 class="sub"><span class="n">L46</span>Climate ' + tierTag('MODEL') + '</h3>' +
      '<div class="grid4">' +
      stat('Mean annual temp', num(cl.mean_annual_temp_c, 1), '&deg;C') +
      stat('Mean summer high', num(cl.mean_summer_high_c, 1), '&deg;C') +
      stat('Mean winter low', num(cl.mean_winter_low_c, 1), '&deg;C') +
      stat('Annual rainfall', num(cl.mean_annual_precip_mm, 0), 'mm') +
      '</div>' +
      '<table class="tight"><tbody>' +
      '<tr><th>Record high</th><td class="num">' + num(cl.record_high_c, 1) + ' &deg;C</td>' +
      '<th>Record low</th><td class="num">' + num(cl.record_low_c, 1) + ' &deg;C</td>' +
      '<th>Rainfall</th><td class="num">' + num(cl.mean_annual_precip_in, 1) + ' in</td></tr>' +
      '<tr><th>Growing season</th><td class="num">~' + num(cl.mean_growing_season_days, 0) +
      ' days</td><th>Days at or below 0 &deg;C</th><td class="num">' +
      num(cl.mean_days_at_or_below_0c_per_year, 1) + ' /yr</td>' +
      '<th>Period</th><td>' + esc(cl.period) + '</td></tr></tbody></table>', true);
    var cc = climateChart(p);
    if (cc) {
      push('<figure class="figbox">' + cc +
        '<figcaption>Monthly normals, ' + esc(cl.period) + '. Bars are mean monthly rainfall ' +
        '(mm, right axis); lines are mean daily maximum and minimum temperature ' +
        '(&deg;C, left axis). Source: ' + esc(cl.source) + '.</figcaption></figure>');
    }
  }

  /* ---- L47 hazards ---- */
  push('<h3 class="sub"><span class="n">L47</span>Natural hazards</h3>' +
    '<table class="kv"><tbody>' +
    row('Flood', f.in_sfha ? '<span class="pill bad">Mapped Special Flood Hazard Area</span>' :
      '<span class="pill ok">No mapped SFHA on the parcel</span>') +
    row('Other perils', 'Hurricane and tropical wind, tornado, hail, severe convective storm, ' +
      'lightning, extreme heat, drought and wildfire all vary by location within Texas. ' +
      '<span class="tier tier-required">Quantify from FEMA National Risk Index for the ' +
      'confirmed county and from an insurance quote</span>') +
    '</tbody></table>');

  /* ---- L48-55 ---- */
  var dem = p.demographics || {};
  push('<h3 class="sub"><span class="n">L48-55</span>Community, schools, healthcare, shopping ' +
    'and access ' + tierTag('REQUIRED') + '</h3>' +
    (dem.status === 'not_retrieved' ?
      '<div class="note warn"><span class="ttl">Demographics not retrieved</span>' +
      esc(dem.reason || '') + ' ' + esc(dem.how_to_obtain || '') + '</div>' : '') +
    reqList(REQ.services), true);

  /* ---- M. summary ---- */
  B = B.concat(summaryBlocks(p));
  return B;
}

/* ---- M56-60: strengths, risks, feasibility, key measurements -------- */
function summaryBlocks(p) {
  var B = [];
  function push(html, glue) { B.push({ html: html, glue: !!glue }); }

  var id = p.identification || {}, f = p.flood || {}, t = p.terrain || {};
  var sl = t.slope || {}, par = t.parcel_elevation_ft || {};
  var fo = p.foundation || {}, sp = p.septic || {}, w = p.water || {}, cl = p.climate || {};
  var s0 = p.soil || {};

  /* strengths */
  var pros = [];
  if (id.gis_acres >= 1) pros.push('Lot of ' + num(id.gis_acres, 2) + ' acres, which is generous ' +
    'for a single dwelling and leaves room for outbuildings and a garden.');
  if (w.distance_ft != null && w.distance_ft <= 60)
    pros.push('Abuts mapped water at roughly ' + num(w.distance_ft, 0) + ' ft' +
      ((w.nearest || {}).name ? ' (' + esc(w.nearest.name) + ')' : '') +
      ', consistent with genuine water frontage subject to title confirmation.');
  else if (w.distance_ft != null && w.distance_ft <= 700)
    pros.push('Close to ' + esc(or((w.nearest || {}).name, 'mapped water')) + ' at about ' +
      num(w.distance_ft, 0) + ' ft, so lake amenity is nearby without shoreline exposure.');
  if (sl.mean_pct != null && sl.mean_pct < 3)
    pros.push('Gentle mean grade of ' + num(sl.mean_pct, 2) + '%, so routine grading should suffice.');
  if (!f.in_sfha && f.coverage_verdict && f.coverage_verdict.indexOf('Zone X') >= 0)
    pros.push('No Special Flood Hazard Area maps onto the parcel, which avoids mandatory flood ' +
      'insurance and floodplain construction rules.');
  if (fo.shrink_swell === 'Low')
    pros.push('Low soil shrink-swell, the most forgiving case for a conventional slab.');
  if (cl.mean_growing_season_days >= 300)
    pros.push('Long growing season of roughly ' + num(cl.mean_growing_season_days, 0) +
      ' frost-free days supports year-round production.');
  if ((s0.headline || {}).septic_absorption === 'Somewhat limited')
    pros.push('Septic absorption is rated only "somewhat limited" rather than "very limited", ' +
      'which is the better of the two common outcomes here.');
  if (!pros.length) pros.push('No clear advantage emerged from the datasets that could be ' +
    'verified for this lot.');

  /* risks */
  var cons = [];
  if (/LOW/i.test(id.match_confidence || ''))
    cons.push('<b>Parcel identity is not established.</b> ' + esc(id.match_confidence_note));
  else if (/^medium/i.test(id.match_confidence || ''))
    cons.push('Parcel identification is probable but not certain: ' + esc(id.match_confidence_note));
  if (f.in_sfha) {
    cons.push('<b>Inside a FEMA Special Flood Hazard Area (' + esc((f.zones || []).join('+')) +
      ').</b> This forces an elevated finished floor, triggers floodplain permitting, and makes ' +
      'flood insurance mandatory with a federally backed mortgage.');
    if (f.lowest_vs_bfe_ft != null && f.lowest_vs_bfe_ft < 0)
      cons.push('Lowest natural ground sits about ' + num(Math.abs(f.lowest_vs_bfe_ft), 1) +
        ' ft below the indicative BFE, so the pad must be raised or the house elevated.');
  }
  if (f.split_zone) cons.push('The lot straddles more than one flood zone, so the building ' +
    'position materially changes the flood obligation.');
  if (f.coverage_verdict && f.coverage_verdict.indexOf('unmapped') >= 0)
    cons.push('FEMA has no effective digital flood mapping here, so flood risk is formally ' +
      'undetermined rather than low. Lenders and insurers may treat it conservatively.');
  if (sl.p90_pct != null && sl.p90_pct > 20)
    cons.push('Steep sub-areas: the 90th-percentile grade reaches ' + num(sl.p90_pct, 1) +
      '%, so siting, driveway grade and retaining structures need care.');
  var st = (t.transect || {}).steepest_50ft;
  if (st && st.grade_pct > 25)
    cons.push('A 50 ft run reaches ' + num(st.grade_pct, 0) + '% (' + num(st.angle_deg, 0) +
      '&deg;), which is steep enough to drive retaining-wall and access cost.');
  if (fo.shrink_swell === 'High' || fo.shrink_swell === 'Very high')
    cons.push('<b>' + esc(fo.shrink_swell) + ' soil shrink-swell.</b> Expansive clay is the ' +
      'leading cause of foundation distress in this region; an engineered foundation and a ' +
      'geotechnical report should be assumed.');
  if (sp.overall === 'Very limited')
    cons.push('Septic absorption is rated "very limited" for the dominant soil, so a ' +
      'conventional drainfield may not be permittable and an engineered or aerobic system may ' +
      'be required at higher cost.');
  (sp.constraints || []).forEach(function (c) {
    if (/water table|flooding/i.test(c)) cons.push(c);
  });
  if (id.market_value_usd === 0 || id.gis_acres === 0)
    cons.push('The appraisal record carries a zero value or zero area, which signals a ' +
      'questionable or superseded parcel record.');
  cons.push('HOA covenants, zoning, utility availability, dock rights and short-term-rental ' +
    'rules are all unconfirmed. Any of them can independently prevent the intended use.');

  push('<h3 class="sub"><span class="n">M56</span>Documented strengths</h3><ul>' +
    pros.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>', true);
  push('<h3 class="sub"><span class="n">M57</span>Limitations and risks</h3><ul>' +
    cons.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>');

  /* feasibility */
  function verdict(ok, txt) {
    var cls = ok === 1 ? 'ok' : ok === 0 ? 'warn' : 'bad';
    var lab = ok === 1 ? 'Likely' : ok === 0 ? 'Conditional' : 'Unresolved';
    return '<span class="pill ' + cls + '">' + lab + '</span> ' + txt;
  }
  var feas = [
    ['Main house', verdict(1, 'The lot is large enough and the terrain is workable. Finished-floor ' +
      'elevation and foundation type are the governing variables, not land area.')],
    ['Second in-law suite / ADU', verdict(-1, 'Depends entirely on county rules and the HOA ' +
      'declaration; neither was available. Do not assume a second dwelling is permitted.')],
    ['Garage', verdict(1, 'No physical constraint identified, subject to setbacks and ' +
      'architectural guidelines.')],
    ['Septic system', verdict(sp.overall === 'Very limited' ? -1 : 0,
      sp.overall === 'Very limited'
        ? 'Soil ratings are unfavourable; permittability and bedroom count require a site evaluation.'
        : 'Plausible but unproven. A percolation test and site evaluation decide it.')],
    ['Garden', verdict(p.garden && p.garden.raised_beds_advised ? 0 : 1,
      p.garden && p.garden.raised_beds_advised
        ? 'Workable with raised beds and imported loam; native surface soil is restrictive.'
        : 'Native surface soil is workable with normal organic amendment.')],
    ['Hobby farming / poultry', verdict(-1, 'Governed by county rules and CC&Rs; unconfirmed.')],
    ['Dock', verdict(w.distance_ft != null && w.distance_ft <= 60 ? -1 : -1,
      w.distance_ft != null && w.distance_ft <= 60
        ? 'The lot adjoins water, but dock rights are a title and permitting question that was not resolved.'
        : 'The lot does not adjoin mapped water, so a private dock is unlikely; shared access may exist.')],
    ['Short-term rental', verdict(-1, 'Governed by local ordinance and CC&Rs; unconfirmed.')],
    ['Pool / outdoor recreation', verdict(0, 'Space is available; flood-zone and soil-movement ' +
      'considerations affect pool design where applicable.')]
  ];
  push('<h3 class="sub"><span class="n">M59</span>Construction feasibility conclusion</h3>' +
    '<table class="tight split-ok"><tbody>' + feas.map(function (r) {
      return '<tr><th style="width:27%">' + r[0] + '</th><td>' + r[1] + '</td></tr>';
    }).join('') + '</tbody></table>');

  /* key measurements - item 60 */
  var km = [
    ['Lot size', num(id.gis_acres, 3) + ' ac (' + num((id.gis_acres || 0) * 43560, 0) + ' sq ft)'],
    ['Lot dimensions (long axis &times; width)', id.extent ?
      num(id.extent.length_ft, 0) + ' ft &times; ' + num(id.extent.width_ft, 0) + ' ft' : '&mdash;'],
    ['Lowest elevation', num(par.min_ft, 2) + ' ft'],
    ['Highest elevation', num(par.max_ft, 2) + ' ft'],
    ['Elevation difference', num(par.relief_ft, 2) + ' ft'],
    ['Average slope', num(sl.mean_pct, 2) + '% (' + num(sl.mean_deg, 2) + '&deg;)'],
    ['Maximum slope', num(sl.max_pct, 2) + '% (' + num(sl.max_deg, 2) + '&deg;)'],
    ['Steepest 50 ft run', st ? num(st.grade_pct, 1) + '% (' + num(st.angle_deg, 1) + '&deg;)' : '&mdash;'],
    ['FEMA zone', (f.zones && f.zones.length) ? f.zones.join(' + ') :
      '<span class="pill warn">' + esc(or(f.coverage_verdict, 'not mapped')) + '</span>'],
    ['BFE', f.bfe_ft != null ? num(f.bfe_ft, 1) + ' ft (indicative)' : 'not published'],
    ['Minimum finished-floor elevation', f.bfe_ft != null ?
      num(f.bfe_ft + 1, 1) + ' ft at +1 ft / ' + num(f.bfe_ft + 2, 1) +
      ' ft at +2 ft freeboard <span class="tier tier-required">county figure unconfirmed</span>'
      : '<span class="tier tier-required">Needs confirmation</span>'],
    ['Fill or elevation required?', (f.lowest_vs_bfe_ft != null && f.lowest_vs_bfe_ft < 0) ?
      'Yes &mdash; lowest ground is ' + num(Math.abs(f.lowest_vs_bfe_ft), 1) + ' ft below BFE' :
      (f.in_sfha ? 'Probably, confirm against the governing BFE' : 'Not indicated')],
    ['Sewer', '<span class="tier tier-required">Needs confirmation</span>'],
    ['Water', '<span class="tier tier-required">Needs confirmation</span>'],
    ['Electricity', '<span class="tier tier-required">Needs confirmation</span>'],
    ['Gas', '<span class="tier tier-required">Needs confirmation</span>'],
    ['Internet', '<span class="tier tier-required">Needs confirmation</span>'],
    ['Septic required?', '<span class="tier tier-required">Needs confirmation</span> &mdash; soil ' +
      'absorption rated ' + esc(or(sp.overall, 'n/a'))],
    ['Soil', escOr(s0.dominant_component) + ' &mdash; ' +
      esc(or((s0.headline || {}).drainage, '')) + ', hydrologic group ' +
      esc(or((s0.headline || {}).hydgroup, '?')) + ', ' +
      esc(or(fo.shrink_swell, '?')) + ' shrink-swell'],
    ['HOA', (id.subdivision ? 'Platted subdivision (' + esc(id.subdivision) + '), so covenants ' +
      'are likely. ' : '') + '<span class="tier tier-required">Needs confirmation</span>'],
    ['HOA fee', '<span class="tier tier-required">Needs confirmation</span>'],
    ['Zoning', '<span class="tier tier-required">Needs confirmation</span>'],
    ['Dock possible?', '<span class="tier tier-required">Needs confirmation</span>'],
    ['Lake depth', '<span class="tier tier-required">Needs confirmation</span>'],
    ['Boating', '<span class="tier tier-required">Needs confirmation</span>'],
    ['Fishing', '<span class="tier tier-required">Needs confirmation</span>'],
    ['Hobby farming', '<span class="tier tier-required">Needs confirmation</span>'],
    ['Second in-law suite', '<span class="tier tier-required">Needs confirmation</span>'],
    ['Short-term rental', '<span class="tier tier-required">Needs confirmation</span>'],
    ['Nearest hospital', '<span class="tier tier-required">Needs confirmation</span>'],
    ['Nearest international airport', '<span class="tier tier-required">Needs confirmation</span>'],
    ['Distance to nearest mapped water', w.distance_ft == null ? '&mdash;' :
      num(w.distance_ft, 0) + ' ft to ' + esc(or((w.nearest || {}).name, 'unnamed waterbody'))],
    ['Mean annual temperature', cl.mean_annual_temp_c != null ?
      num(cl.mean_annual_temp_c, 1) + ' &deg;C' : '&mdash;'],
    ['Mean annual rainfall', cl.mean_annual_precip_mm != null ?
      num(cl.mean_annual_precip_mm, 0) + ' mm (' + num(cl.mean_annual_precip_in, 1) + ' in)' : '&mdash;'],
    ['Appraised market value', usd(id.market_value_usd)]
  ];
  push('<h3 class="sub"><span class="n">M60</span>Key measurements summary</h3>' +
    '<table class="tight split-ok"><thead><tr><th style="width:34%">Parameter</th><th>Finding</th>' +
    '</tr></thead><tbody>' + km.map(function (r) {
      return '<tr><th>' + r[0] + '</th><td>' + r[1] + '</td></tr>';
    }).join('') + '</tbody></table>');
  return B;
}

/* ====================================================================
   Front matter and portfolio comparison
   ==================================================================== */
function frontBlocks(props) {
  var B = [];
  function push(html, glue) { B.push({ html: html, glue: !!glue }); }

  var idd = props.filter(function (p) { return p.identification.status === 'IDENTIFIED'; });
  var sfha = idd.filter(function (p) { return p.flood && p.flood.in_sfha; });
  var unmapped = idd.filter(function (p) {
    return p.flood && p.flood.coverage_verdict && p.flood.coverage_verdict.indexOf('unmapped') >= 0;
  });
  var swell = idd.filter(function (p) {
    return ['High', 'Very high'].indexOf((p.foundation || {}).shrink_swell) >= 0;
  });
  var waterfront = idd.filter(function (p) {
    return p.water && p.water.distance_ft != null && p.water.distance_ft <= 60;
  });

  push('<h2 class="sec">How to read this report</h2>' +
    '<p>Every factual line in this report is labelled with where it came from, because the ' +
    'difference between a published flood zone and a computed contour matters when money is at ' +
    'stake. Three labels are used throughout:</p>' +
    '<table class="tight"><tbody>' +
    '<tr><th style="width:20%">' + tierTag('OFFICIAL') + '</th><td>Published by the agency of ' +
    'record and reproduced unchanged: FEMA flood zones and FIRM panels, county appraisal-roll ' +
    'parcel data, recorded legal descriptions.</td></tr>' +
    '<tr><th>' + tierTag('MODEL') + '</th><td>Computed here from authoritative inputs. ' +
    'Elevations, contours, slopes and cross-sections come from the USGS 3DEP 1 m bare-earth ' +
    'DEM; soil properties come from USDA NRCS map units. These are good engineering estimates ' +
    'and they are <b>not survey grade</b>.</td></tr>' +
    '<tr><th>' + tierTag('REQUIRED') + '</th><td>Cannot be established remotely at all. HOA ' +
    'covenants, zoning, utility availability, dock rights, lake depth, school assignment and ' +
    'short-term-rental rules sit here. The report names the question and the office that holds ' +
    'the answer rather than guessing.</td></tr>' +
    '</tbody></table>' +
    '<div class="note bad"><span class="ttl">What this report is not</span>It is not a survey, ' +
    'a geotechnical report, an elevation certificate, a flood determination, a title opinion or ' +
    'an appraisal. DEM-derived contours and elevations carry roughly a foot of vertical ' +
    'uncertainty and must never be used to size a finished floor against a Base Flood ' +
    'Elevation. For that you need a licensed surveyor\u2019s Elevation Certificate.</div>', true);

  push('<h3 class="sub">Where the numbers come from</h3>' +
    '<table class="tight"><thead><tr><th>Dataset</th><th>Publisher</th><th>Used for</th>' +
    '</tr></thead><tbody>' +
    '<tr><td>StratMap statewide land parcels</td><td>Texas Geographic Information Office, ' +
    'rolled up from county appraisal districts</td><td>Parcel boundary, legal description, ' +
    'acreage, APN, owner, appraised value</td></tr>' +
    '<tr><td>National Flood Hazard Layer</td><td>FEMA</td><td>Flood zone, SFHA status, FIRM ' +
    'panel and effective date, Base Flood Elevation lines</td></tr>' +
    '<tr><td>3DEP bare-earth DEM (1 m)</td><td>USGS</td><td>Elevations, relief, slope ' +
    'statistics, contours, cross-sections, 3D terrain</td></tr>' +
    '<tr><td>Soil Survey Geographic Database</td><td>USDA NRCS</td><td>Soil series, texture, ' +
    'drainage, shrink-swell, pH, septic and dwelling ratings</td></tr>' +
    '<tr><td>National Hydrography Dataset</td><td>USGS</td><td>Waterbody position and distance ' +
    'from the parcel boundary</td></tr>' +
    '<tr><td>ERA5 daily reanalysis</td><td>ECMWF, via the Open-Meteo archive</td><td>30-year ' +
    'climate normals, growing season, freeze frequency</td></tr>' +
    '<tr><td>Geocoder and geographies</td><td>US Census Bureau</td><td>County and tract ' +
    'identification</td></tr>' +
    '</tbody></table>' +
    '<p class="tiny muted">Listing imagery, prices and listing history are not reproduced: ' +
    'Zillow blocks automated access, so none was retrieved. Request photographs and price ' +
    'history from the listing agent.</p>');

  /* executive summary */
  push('<h2 class="sec">Executive summary</h2>' +
    '<p>Twelve lots were submitted. ' + idd.length + ' were matched to a parcel in the Texas ' +
    'statewide appraisal-roll layer and analysed; ' + (props.length - idd.length) +
    ' could not be identified from the address alone. The findings that most affect value are ' +
    'these:</p>' +
    '<div class="grid4" style="margin:6px 0">' +
    stat('Lots analysed', idd.length + ' / ' + props.length, '') +
    stat('In a FEMA SFHA', String(sfha.length), 'lots') +
    stat('High shrink-swell soil', String(swell.length), 'lots') +
    stat('Abut mapped water', String(waterfront.length), 'lots') +
    '</div>', true);

  var bullets = [];
  if (sfha.length) {
    bullets.push('<b>' + sfha.length + ' lots sit inside a FEMA Special Flood Hazard Area</b> ' +
      '(' + sfha.map(function (p) { return esc(shortName(p)); }).join(', ') + '). For the Bar X ' +
      'Ranch lots in Angleton the measured ground surface lies <i>below</i> the indicative Base ' +
      'Flood Elevation, which means an elevated finished floor, floodplain permitting and ' +
      'mandatory flood insurance. This is the single largest cost and feasibility factor in the ' +
      'portfolio.');
  }
  if (unmapped.length) {
    bullets.push('<b>' + unmapped.length + ' lots have no effective FEMA digital flood mapping</b> ' +
      '(' + unmapped.map(function (p) { return esc(shortName(p)); }).join(', ') + '). That is ' +
      'not the same as low risk: the zone is formally undetermined and lenders may treat it ' +
      'conservatively.');
  }
  if (swell.length) {
    bullets.push('<b>' + swell.length + ' lots carry high or very high soil shrink-swell</b> ' +
      '(' + swell.map(function (p) { return esc(shortName(p)); }).join(', ') + '). Expansive ' +
      'clay drives foundation cost and is the usual cause of structural distress in these ' +
      'regions. Assume an engineered foundation and a geotechnical report.');
  }
  bullets.push('<b>Terrain varies enormously across the portfolio.</b> The Angleton lots are ' +
    'nearly flat with 2&ndash;6 ft of relief, whereas the Oak Canyon lot at Lake Alan Henry ' +
    'falls about 78 ft across the parcel and reaches roughly 60% grade over a 50 ft run. Those ' +
    'two extremes imply completely different build budgets.');
  bullets.push('<b>Nothing about HOA covenants, zoning, utilities, dock rights or rental rules ' +
    'could be verified.</b> Those documents are not open data. Each is capable on its own of ' +
    'blocking a second dwelling, a dock, poultry or short-term letting, so they should be ' +
    'obtained before any offer becomes unconditional.');
  push('<ul>' + bullets.map(function (b) { return '<li>' + b + '</li>'; }).join('') + '</ul>');

  /* comparison matrix */
  var hdr = '<tr><th>Lot</th><th>County</th><th class="num">Acres</th><th>FEMA zone</th>' +
    '<th class="num">Relief ft</th><th class="num">Mean grade</th><th>Shrink-swell</th>' +
    '<th>Septic rating</th><th class="num">Water ft</th></tr>';
  var body = props.map(function (p) {
    var id = p.identification || {};
    if (id.status !== 'IDENTIFIED') {
      return '<tr><td>' + esc(shortName(p)) + '</td><td colspan="8" class="muted">' +
        'not identified &mdash; no analysis attributed</td></tr>';
    }
    var f = p.flood || {}, sl = (p.terrain || {}).slope || {};
    var par = (p.terrain || {}).parcel_elevation_ft || {};
    var z = (f.zones && f.zones.length) ? f.zones.join('+') :
      (f.coverage_verdict && f.coverage_verdict.indexOf('unmapped') >= 0 ? 'not mapped' : 'X (likely)');
    var zc = f.in_sfha ? 'style="color:#9c2b2b;font-weight:700"' :
      (z === 'not mapped' ? 'style="color:#9a6212;font-weight:700"' : '');
    var sw = (p.foundation || {}).shrink_swell;
    var swc = (sw === 'High' || sw === 'Very high') ? 'style="color:#9c2b2b;font-weight:700"' : '';
    var sep = (p.septic || {}).overall;
    var sepc = sep === 'Very limited' ? 'style="color:#9c2b2b"' : '';
    return '<tr><td><b>' + esc(shortName(p)) + '</b></td><td>' +
      escOr(id.county).replace(' County', '') + '</td>' +
      '<td class="num">' + num(id.gis_acres, 2) + '</td>' +
      '<td ' + zc + '>' + esc(z) + '</td>' +
      '<td class="num">' + num(par.relief_ft, 1) + '</td>' +
      '<td class="num">' + num(sl.mean_pct, 2) + '%</td>' +
      '<td ' + swc + '>' + escOr(sw) + '</td>' +
      '<td ' + sepc + '>' + escOr(sep) + '</td>' +
      '<td class="num">' + (p.water && p.water.distance_ft != null ?
        num(p.water.distance_ft, 0) : '&mdash;') + '</td></tr>';
  }).join('');
  push('<h2 class="sec">Portfolio comparison</h2>' +
    '<table class="tight split-ok"><thead>' + hdr + '</thead><tbody>' + body + '</tbody></table>' +
    '<div class="legend"><span><span class="sw" style="background:#9c2b2b"></span>' +
    'elevated risk</span><span><span class="sw" style="background:#9a6212"></span>' +
    'undetermined</span><span>Water ft = distance from the parcel boundary to the nearest ' +
    'mapped waterbody</span></div>', true);

  var sc = portfolioScatter(props);
  if (sc) {
    push('<figure class="figbox">' + sc +
      '<figcaption>Terrain difficulty against flood exposure. Horizontal axis is the mean DEM ' +
      'grade across the lot, vertical axis is the elevation relief within the lot. ' +
      '<span style="color:#c0392b">Red</span> = inside a mapped SFHA, ' +
      '<span style="color:#9a6212">amber</span> = no effective FEMA mapping, ' +
      '<span style="color:#17724a">green</span> = no SFHA on the parcel. Lots toward the ' +
      'upper right are the most expensive to build on.</figcaption></figure>');
  }
  return B;
}

function backBlocks(props) {
  var B = [];
  function push(html, glue) { B.push({ html: html, glue: !!glue }); }
  push('<h2 class="sec">Documents to obtain before committing</h2>' +
    '<p>This list applies to every lot. It is ordered roughly by how often it changes a ' +
    'purchase decision.</p>' +
    '<table class="tight split-ok"><thead><tr><th style="width:27%">Document</th>' +
    '<th style="width:25%">Source</th><th>Why it matters</th></tr></thead><tbody>' +
    (D.missing_documents || []).map(function (d) {
      return '<tr><td><b>' + esc(d.document) + '</b></td><td>' + esc(d.source) + '</td><td>' +
        esc(d.why) + '</td></tr>';
    }).join('') + '</tbody></table>', true);

  push('<h2 class="sec">Limitations of this report</h2>' +
    '<ul>' +
    '<li><b>Boundaries are not surveyed.</b> Parcel polygons come from county appraisal GIS, ' +
    'which is maintained for taxation and routinely differs from the recorded plat by several ' +
    'feet. Acreage shown from three sources (legal, GIS, recomputed) will not agree exactly.</li>' +
    '<li><b>Elevations are model values.</b> The 3DEP 1 m DEM is lidar-derived bare earth with ' +
    'vertical accuracy typically within about a foot, worse under dense canopy or where the ' +
    'ground was wet at acquisition. Contours here are interpolated from a sampled grid, not ' +
    'surveyed.</li>' +
    '<li><b>Base Flood Elevations are indicative.</b> Where the flood polygon carried no static ' +
    'BFE, the nearest published BFE line was used. The governing BFE must be read at the ' +
    'structure location from the FIRM and Flood Insurance Study profile.</li>' +
    '<li><b>Soil data describes map units, not lots.</b> NRCS polygons are generalised at ' +
    'roughly 1:24,000 and a single lot often spans more than one unit. Published values are ' +
    'representative, not measured.</li>' +
    '<li><b>No county, HOA or utility document was obtained.</b> Everything in that category is ' +
    'marked as needing confirmation rather than estimated.</li>' +
    '<li><b>No listing data.</b> Prices, photographs and listing history were not retrieved ' +
    'because the source blocks automated access.</li>' +
    '<li><b>Demographics were not retrieved</b> because the Census API now requires a key. The ' +
    'report states where to get the figures rather than substituting an estimate.</li>' +
    '<li><b>Nothing here is professional advice.</b> Flood, foundation, septic and land-use ' +
    'conclusions require a licensed surveyor, engineer, site evaluator or attorney as ' +
    'applicable.</li>' +
    '</ul>');
  return B;
}

/* ====================================================================
   Paginator - flows blocks into fixed A4 sheets so page numbers are real
   ==================================================================== */
var SHEETS = [];

function makeSheet(chapterTitle) {
  var sh = el('div', 'sheet');
  var head = el('div', 'sheet-head');
  head.innerHTML = '<span class="hl">' + esc(D.meta.title) + '</span><span>' +
    esc(chapterTitle || '') + '</span>';
  var body = el('div', 'sheet-body');
  var foot = el('div', 'sheet-foot');
  foot.innerHTML = '<span>' + esc(D.meta.subtitle) + '</span><span class="pg"></span>';
  sh.appendChild(head); sh.appendChild(body); sh.appendChild(foot);
  return { root: sh, body: body, foot: foot };
}

/* Flow a block whose bulk is one long table (or one long list of items) across
   a page break, repeating the table header with a "continued" marker.
   Returns true if it handled placement. `already` means the node is already in
   the current sheet and merely overflows. */
function flowSplittable(node, ctx, already) {
  var table = node.querySelector('table.split-ok');
  var list = node.querySelector('.split-list');
  if (!table && !list) return false;

  var items, host, isTable;
  if (table) {
    if (!table.tBodies.length) return false;
    host = table.tBodies[0];
    items = Array.prototype.slice.call(host.rows);
    isTable = true;
  } else {
    host = list;
    items = Array.prototype.slice.call(host.children);
    isTable = false;
  }
  if (items.length < 3) return false;
  items.forEach(function (r) { host.removeChild(r); });

  if (!already) ctx.cur.body.appendChild(node);
  if (ctx.over()) {                    // even the empty shell will not fit
    ctx.cur.body.removeChild(node);
    ctx.newSheet();
    ctx.cur.body.appendChild(node);
  }

  var curHost = host;
  for (var i = 0; i < items.length; i++) {
    curHost.appendChild(items[i]);
    if (!ctx.over()) continue;
    curHost.removeChild(items[i]);
    // continue on a fresh sheet
    ctx.newSheet();
    var shell;
    if (isTable) {
      var t2 = table.cloneNode(false);
      if (table.tHead) t2.appendChild(table.tHead.cloneNode(true));
      var tb = document.createElement('tbody');
      t2.appendChild(tb);
      shell = el('div', 'blk');
      shell.appendChild(el('p', 'tiny muted', '&hellip; continued'));
      shell.appendChild(t2);
      curHost = tb;
    } else {
      var l2 = list.cloneNode(false);
      shell = el('div', 'blk');
      shell.appendChild(el('p', 'tiny muted', '&hellip; continued'));
      shell.appendChild(l2);
      curHost = l2;
    }
    ctx.cur.body.appendChild(shell);
    curHost.appendChild(items[i]);
  }
  return true;
}

function paginate(chapters) {
  var wrap = document.getElementById('pagewrap');
  wrap.innerHTML = '';
  SHEETS = [];

  // cover
  var cov = el('div', 'sheet cover');
  cov.innerHTML = D.coverHtml;
  wrap.appendChild(cov);
  SHEETS.push({ root: cov, cover: true, chapter: 'Cover' });

  chapters.forEach(function (ch) {
    var ctx = { title: ch.title, wrap: wrap, cur: null };
    ctx.newSheet = function (anchor) {
      var s = makeSheet(ctx.title);
      wrap.appendChild(s.root);
      SHEETS.push({ root: s.root, body: s.body, foot: s.foot, chapter: ctx.title,
                    anchor: anchor });
      ctx.cur = s;
      return s;
    };
    ctx.over = function () {
      return ctx.cur.body.scrollHeight > ctx.cur.body.clientHeight + 1;
    };
    ctx.newSheet(ch.id);
    var pending = null;

    ch.blocks.forEach(function (blk) {
      var node = el('div', 'blk');
      node.innerHTML = blk.html;
      ctx.cur.body.appendChild(node);
      if (!ctx.over()) {
        pending = { node: node, glue: blk.glue };
        return;
      }
      ctx.cur.body.removeChild(node);

      // carry a glued heading forward so it is not orphaned at a page foot
      var carry = null;
      if (pending && pending.glue && ctx.cur.body.lastChild === pending.node &&
          ctx.cur.body.childNodes.length > 1) {
        carry = pending.node;
        ctx.cur.body.removeChild(carry);
      }

      // try flowing the block's long table / list across the page break first
      if (!carry && flowSplittable(node, ctx)) {
        pending = { node: null, glue: false };
        return;
      }

      ctx.newSheet();
      if (carry) ctx.cur.body.appendChild(carry);
      ctx.cur.body.appendChild(node);
      if (ctx.over()) flowSplittable(node, ctx, true);
      pending = { node: node, glue: blk.glue };
    });
  });

  // number the pages
  var total = SHEETS.length;
  SHEETS.forEach(function (s, i) {
    if (s.cover) return;
    var pg = s.foot.querySelector('.pg');
    if (pg) pg.textContent = 'Page ' + (i + 1) + ' of ' + total;
  });
  return SHEETS;
}

/* ------------------------------------------------------------ build all */
function chapterList() {
  var order = D.generated_order || Object.keys(D.properties);
  var props = order.map(function (k) { return D.properties[k]; })
                   .filter(function (p) { return !!p; });
  var chapters = [];
  chapters.push({ id: 'front', title: 'Method and summary', blocks: frontBlocks(props) });
  props.forEach(function (p, i) {
    // Flag a doubtful identification in the running header so the caveat is
    // visible on every page of that lot, not only on its first page.
    var idn = p.identification || {};
    var flag = '';
    if (idn.status !== 'IDENTIFIED') flag = '  \u2014 PARCEL NOT IDENTIFIED';
    else if (/LOW/i.test(idn.match_confidence || '')) flag = '  \u2014 IDENTITY UNRESOLVED';
    else if (/^medium/i.test(idn.match_confidence || '')) flag = '  \u2014 identity probable';
    chapters.push({ id: 'lot-' + p.key,
                    title: 'Lot ' + (i + 1) + ' \u00b7 ' + shortName(p) + flag,
                    blocks: propertyBlocks(p, i, props.length) });
  });
  chapters.push({ id: 'back', title: 'Documents and limitations', blocks: backBlocks(props) });
  return { chapters: chapters, props: props };
}

function buildNav(props) {
  var sel = document.getElementById('jump');
  if (!sel) return;
  sel.innerHTML = '<option value="front">Method and summary</option>' +
    props.map(function (p, i) {
      return '<option value="lot-' + p.key + '">Lot ' + (i + 1) + ' \u2014 ' +
        esc(shortName(p)) + '</option>';
    }).join('') +
    '<option value="back">Documents and limitations</option>';
  sel.onchange = function () {
    var target = SHEETS.filter(function (s) { return s.anchor === sel.value; })[0];
    if (target) target.root.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
}

function render() {
  var r = chapterList();
  paginate(r.chapters);
  buildNav(r.props);
  var n = document.getElementById('pgcount');
  if (n) n.textContent = SHEETS.length + ' pages';
}

document.addEventListener('DOMContentLoaded', function () {
  render();
  var tgl = document.getElementById('toggleReq');
  if (tgl) {
    tgl.onchange = function () {
      document.body.classList.toggle('hide-req', !tgl.checked);
      render();
      if (!tgl.checked) document.body.classList.add('hide-req');
    };
  }
  var btn = document.getElementById('printBtn');
  if (btn) btn.onclick = function () { window.print(); };
});
