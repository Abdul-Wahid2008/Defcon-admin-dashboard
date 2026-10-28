// Evaluated in the browser by scripts/qa-layout.ts (read as text, not imported). Returns { cards, wraps, rows, contrast }.
(() => {
  const out = { cards: [], wraps: [], rows: [], contrast: [], sizes: [], icons: [] };
  const css = (el) => {
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && parts.length < 4; n = n.parentElement) {
      let s = n.tagName.toLowerCase();
      if (n.id) s += '#' + n.id;
      else if (typeof n.className === 'string' && n.className.trim()) s += '.' + n.className.trim().split(/\s+/).slice(0, 2).join('.');
      parts.unshift(s);
    }
    return parts.join(' > ');
  };
  const visible = (el) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return cs.visibility !== 'hidden' && cs.display !== 'none' && r.width > 1 && r.height > 1;
  };

  // (e) cards that share a row: same height, same heading offset.
  for (const parent of new Set([...document.querySelectorAll('[data-slot=card]')].map(c => c.parentElement))) {
    const kids = [...parent.children].filter(c => c.matches('[data-slot=card]') && visible(c));
    if (kids.length < 2) continue;
    const rows = new Map();
    for (const k of kids) { const t = Math.round(k.getBoundingClientRect().top); rows.set(t, [...(rows.get(t) || []), k]); }
    for (const [, row] of rows) {
      if (row.length < 2) continue;
      const hs = row.map(k => Math.round(k.getBoundingClientRect().height));
      if (Math.max(...hs) - Math.min(...hs) > 1) out.cards.push({ path: css(parent), detail: 'card heights differ in one row: ' + hs.join(' / ') });
      const offs = row.map(k => { const t = k.querySelector('[data-slot=card-title]'); return t ? Math.round(t.getBoundingClientRect().top - k.getBoundingClientRect().top) : null; }).filter(v => v !== null);
      if (offs.length > 1 && Math.max(...offs) - Math.min(...offs) > 1) out.cards.push({ path: css(parent), detail: 'card headings not aligned: ' + offs.join(' / ') });
    }
  }

  // (f) controls and header cells must not wrap (orphan words in buttons / column headers).
  for (const el of document.querySelectorAll('button, [role=button], th, [data-slot=badge], [role=tab], aside p, aside span, header span, header p')) {
    if (!visible(el) || el.hasAttribute('data-allow-wrap')) continue;
    const tops = new Set();
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      if (!t.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(t);
      for (const r of range.getClientRects()) if (r.width > 0) tops.add(Math.round(r.top / 4));
    }
    if (tops.size > 1 && (el.textContent || '').trim().includes(' ')) out.wraps.push({ path: css(el), text: (el.textContent || '').trim().slice(0, 40) });
  }

  // (i) table body rows: minimum height 36.
  for (const tr of document.querySelectorAll('[data-slot=table-container] tbody tr')) {
    if (!visible(tr)) continue;
    const h = tr.getBoundingClientRect().height;
    if (h < 35.5) out.rows.push({ path: css(tr), h: Math.round(h) });
  }

  // (h) text contrast from computed colours (WCAG AA: 4.5, large text 3). Elements over gradients/images are skipped.
  const cv = document.createElement('canvas'); cv.width = cv.height = 1;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  const norm = (c) => {
    ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data; return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
  };
  const over = (top, bot) => { const a = top.a + bot.a * (1 - top.a); return a === 0 ? { r: 0, g: 0, b: 0, a: 0 } : { r: (top.r * top.a + bot.r * bot.a * (1 - top.a)) / a, g: (top.g * top.a + bot.g * bot.a * (1 - top.a)) / a, b: (top.b * top.a + bot.b * bot.a * (1 - top.a)) / a, a }; };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const la = lum(a), lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };
  const seen = new Map();
  for (const el of document.querySelectorAll('body *')) {
    if (!visible(el)) continue;
    const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 0);
    if (!own) continue;
    if (el.closest('[disabled],[aria-disabled=true],script,style,[data-qa-skip-contrast]')) continue;
    const cs = getComputedStyle(el);
    let bg = { r: 0, g: 0, b: 0, a: 0 }, skip = false, opacity = 1;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const s = getComputedStyle(n);
      opacity *= parseFloat(s.opacity);
      if (s.backgroundImage !== 'none') { skip = true; break; }
      bg = over(bg, norm(s.backgroundColor)); // layers are visited top-down, so existing bg stays on top
      if (bg.a >= 0.999) break;
    }
    if (skip) continue;
    if (bg.a < 0.999) bg = over(bg, { r: 11, g: 18, b: 32, a: 1 }); // page background
    let fg = norm(cs.color); fg = { ...fg, a: fg.a * opacity };
    const text = over(fg, bg);
    const size = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight, 10) >= 700;
    const need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
    const cr = ratio(text, bg);
    if (cr < need) {
      const key = cs.color + '|' + cs.backgroundColor + '|' + size;
      if (!seen.has(key)) seen.set(key, { path: css(el), text: el.textContent.trim().slice(0, 30), ratio: cr.toFixed(2), need, size });
    }
  }
  out.contrast = [...seen.values()];

  // (j) type scale: only 11 / 12 / 14 / 16 / 24 px for text (login hero heading is display type and exempt).
  const SCALE = new Set([11, 12, 14, 16, 24]);
  const badSizes = new Map();
  for (const el of document.querySelectorAll('body *')) {
    if (!visible(el) || el.closest('.login-brief h1,[data-qa-skip-contrast]')) continue;
    if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
    const size = parseFloat(getComputedStyle(el).fontSize);
    if (!SCALE.has(size) && !badSizes.has(size)) badSizes.set(size, { path: css(el), text: el.textContent.trim().slice(0, 30) });
  }
  out.sizes = [...badSizes].map(([size, v]) => ({ size, ...v }));

  // (k) icons: 16 px everywhere except the login brand mark and chips marked data-qa-icon-exempt.
  const badIcons = new Map();
  for (const svg of document.querySelectorAll('svg')) {
    if (!visible(svg) || svg.closest('.brand-mark,[data-qa-icon-exempt]')) continue;
    const r = svg.getBoundingClientRect();
    const k = Math.round(r.width) + 'x' + Math.round(r.height);
    if (k !== '16x16' && !badIcons.has(k)) badIcons.set(k, css(svg));
  }
  out.icons = [...badIcons].map(([size, path]) => ({ size, path }));
  return out;
})()
