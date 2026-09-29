// Runs inside the page: looks over everything on screen and returns what's wrong with it.
// Kept free of imports so the sweep can hand it to the browser as it is.

/** @returns {{kind: string, what: string, detail: string}[]} */
export function inspectPage(opts) {
  const W = innerWidth;
  const H = innerHeight;
  const out = [];
  const add = (kind, el, detail) => out.push({ kind, what: el ? describe(el) : '', detail });

  function describe(el) {
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    const own = el.closest('[class]') === el ? '' : ` in ${describe(el.closest('[class]'))}`;
    return `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}${own}`;
  }
  const style = (el) => getComputedStyle(el);
  function* ancestors(el) {
    for (let a = el; a; a = a.parentElement) yield a;
  }
  // A background that hides what's under it.
  const solid = (el) => {
    const s = style(el);
    if (s.backgroundImage !== 'none' || s.backdropFilter !== 'none') return true;
    const m = s.backgroundColor.match(/[\d.]+/g);
    return !!m && (m.length < 4 ? true : Number(m[3]) > 0.6) && s.backgroundColor !== 'rgba(0, 0, 0, 0)';
  };
  const shown = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const s = style(el);
    return s.visibility !== 'hidden' && s.opacity !== '0';
  };
  const text = (el) =>
    [...el.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent)
      .join('')
      .trim();
  // The part of an element that can actually be seen: its box cut down by every ancestor that clips or scrolls.
  const seen = (el) => {
    let { left, top, right, bottom } = el.getBoundingClientRect();
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const s = style(a);
      if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
      const b = a.getBoundingClientRect();
      left = Math.max(left, b.left);
      top = Math.max(top, b.top);
      right = Math.min(right, b.right);
      bottom = Math.min(bottom, b.bottom);
    }
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  };
  // With a dialog open only it counts: what's behind it is dimmed and can't be reached.
  const modal = [...document.querySelectorAll('dialog[open]')].at(-1);
  const root = modal ?? document.body;
  const all = [...root.querySelectorAll('*')].filter((el) => !el.closest('svg, .sr-only, script, style, noscript'));
  const visible = all.filter(shown);

  // 1. The page wider than the window: the whole app slides sideways on a phone.
  const se = document.scrollingElement;
  if (se.scrollWidth > W + 1) add('page-wider-than-window', null, `${se.scrollWidth}px on a ${W}px window`);

  // Nearest ancestor that clips (hidden) or scrolls (auto/scroll).
  const clipper = (el) => {
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const s = style(a);
      if (s.overflowX !== 'visible' || s.overflowY !== 'visible' || s.clipPath !== 'none') return a;
    }
    return undefined;
  };
  const inCanvas = (el) => el.closest('.react-flow__viewport, .leaflet-pane, .leaflet-control-container');

  for (const el of visible) {
    const r = el.getBoundingClientRect();
    const t = text(el);
    const box = clipper(el);
    // 2. Sticking out of the window with nothing to scroll it into view.
    if (!inCanvas(el) && (r.right > W + 1 || r.left < -1)) {
      const scrolls = box && /auto|scroll/.test(style(box).overflowX);
      const boxIn = box && box.getBoundingClientRect().right <= W + 1 && box.getBoundingClientRect().left >= -1;
      if (!(scrolls && boxIn) && !(box && boxIn) && !el.closest('.plan-tabs-strip')) {
        add('off-screen', el, `${t.slice(0, 40) || '(no text)'}: ${Math.round(r.left)}–${Math.round(r.right)} of ${W}`);
      }
    }
    // 3. Cut off by a box that hides its overflow (not a scroller: those can be scrolled).
    if (box && (t || el.tagName === 'IMG')) {
      const s = style(box);
      const hides = (s.overflowX === 'hidden' || s.overflowX === 'clip' || s.clipPath !== 'none') && !/auto|scroll/.test(s.overflowY);
      if (hides && !inCanvas(el)) {
        const b = box.getBoundingClientRect();
        const cut = Math.max(b.left - r.left, r.right - b.right, b.top - r.top, r.bottom - b.bottom);
        if (cut > 3 && !el.closest('.plan-tabs-strip')) add('cut-off', el, `${t.slice(0, 40) || 'image'} loses ${Math.round(cut)}px`);
      }
    }
  }

  // 4. Cards whose content spills out of them (no clipping, so it draws over what's next to them).
  const CARDS = [
    '.machine-node',
    '.endpoint-node',
    '.power-node',
    '.item-card',
    '.resource-card',
    '.codex-recipe',
    '.codex-tile',
    '.codex-amount',
    '.gen-row',
    '.gen-card',
    '.quick-item',
    '.tier-card',
    '.readout',
    '.toast',
    '.inspector',
    '.recipe-row',
    '.map-item',
    '.codex-cat-card',
    '.codex-stat',
    '.edge-label',
    '.fuel-chip',
    '.fuel-pill',
    'button',
  ];
  for (const card of root.querySelectorAll(CARDS.join(','))) {
    if (!shown(card)) continue;
    const c = card.getBoundingClientRect();
    const cs = style(card);
    // A card that scrolls may be longer than its box; only running out sideways is wrong there.
    const scrollsY = /auto|scroll/.test(cs.overflowY);
    for (const el of card.querySelectorAll('*')) {
      if (!shown(el) || !(text(el) || el.tagName === 'IMG')) continue;
      const r = el.getBoundingClientRect();
      const over = Math.max(c.left - r.left, r.right - c.right, scrollsY ? 0 : c.top - r.top, scrollsY ? 0 : r.bottom - c.bottom);
      if (over > 3) {
        add('spills-out-of-card', el, `"${(text(el) || 'image').slice(0, 40)}" ${Math.round(over)}px outside ${describe(card)}`);
        break;
      }
    }
  }

  // 5. Text that doesn't fit and is cut short with "…" or a line clamp.
  for (const el of visible) {
    const s = style(el);
    const clamps = s.webkitLineClamp && s.webkitLineClamp !== 'none';
    if (s.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) add('text-shortened', el, el.textContent.trim().slice(0, 60));
    else if (clamps && el.scrollHeight > el.clientHeight + 2) add('text-shortened', el, el.textContent.trim().slice(0, 60));
  }

  // 5b. Text cut off at its own edge with no "…" to say there's more.
  for (const el of visible) {
    const s = style(el);
    if (!text(el) || s.textOverflow === 'ellipsis' || (s.webkitLineClamp && s.webkitLineClamp !== 'none')) continue;
    const clips = /hidden|clip/.test(s.overflowX) || /hidden|clip/.test(s.overflowY);
    if (clips && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 2))
      add(
        'text-cut',
        el,
        `${el.textContent.trim().slice(0, 50)} (${el.scrollWidth}×${el.scrollHeight} in ${el.clientWidth}×${el.clientHeight})`,
      );
  }

  // 6. Pieces of text drawn over each other.
  // Text, and the fields showing a value (a covered name next to an amount box is as bad as text on text). A line of
  // text wrapping onto two lines has a box wider than its words, so only single-line pieces are compared.
  const field = (el) => el.tagName === 'INPUT' && !/checkbox|radio|range|hidden/.test(el.type) && el.value;
  const words = visible
    .filter((el) => (text(el) || field(el)) && !el.closest('.toast, .leaflet-popup, .tab-menu-list, .install-hint'))
    .filter((el) => el.getClientRects().length === 1)
    .map((el) => ({ el, r: seen(el) }))
    .filter(({ r }) => r.width > 1 && r.height > 1 && r.bottom > 0 && r.top < H && r.right > 0 && r.left < W);
  for (let i = 0; i < words.length; i++) {
    for (let j = i + 1; j < words.length; j++) {
      const a = words[i];
      const b = words[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const x = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
      const y = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
      if (x < 3 || y < 3) continue;
      const small = Math.min(a.r.width * a.r.height, b.r.width * b.r.height);
      if ((x * y) / small < 0.15) continue;
      // Which one is drawn on top, and whether that one sits on a solid background (a panel, a button, a card)
      // hiding the other: only text drawn straight over text is a problem.
      const common = [...ancestors(a.el)].find((x) => x.contains(b.el));
      const chainA = [...ancestors(a.el)].filter((x) => x !== common && !x.contains(b.el));
      const chainB = [...ancestors(b.el)].filter((x) => x !== common && !x.contains(a.el));
      const stack = document.elementsFromPoint(Math.max(a.r.left, b.r.left) + x / 2, Math.max(a.r.top, b.r.top) + y / 2);
      const ia = stack.findIndex((e) => chainA.includes(e));
      const ib = stack.findIndex((e) => chainB.includes(e));
      // Two pieces of one card (a name under its amount box) overlapping is always wrong; across layers (a panel over
      // the floor, a floating bar over a list) only when the one on top lets the other show through.
      const sameCard = common?.closest(CARDS.join(','));
      if (!sameCard) {
        if (ia < 0 && ib < 0) continue;
        // One of them can't be picked by the pointer, so which is on top is unknown: a solid one could be hiding the other.
        if ((ia < 0 || ib < 0) && (chainA.some(solid) || chainB.some(solid))) continue;
        const upper = ib < 0 || (ia >= 0 && ia < ib) ? chainA : chainB;
        if (upper.some(solid)) continue;
      }
      const words_ = (el) => (text(el) || el.value || '').slice(0, 30);
      add('text-overlaps', a.el, `"${words_(a.el)}" over "${words_(b.el)}" (${describe(b.el)})`);
    }
  }

  // 7. Machine and item cards on the floor lying on top of each other, or a belt label on a card.
  const nodes = [...document.querySelectorAll('.react-flow__node')].filter(shown).map((el) => ({ el, r: el.getBoundingClientRect() }));
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i].r;
      const b = nodes[j].r;
      const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (x > 2 && y > 2)
        add(
          'cards-overlap',
          nodes[i].el.firstElementChild,
          `${nodes[i].el.textContent.slice(0, 30)} / ${nodes[j].el.textContent.slice(0, 30)}`,
        );
    }
  for (const label of document.querySelectorAll('.edge-label')) {
    if (!shown(label)) continue;
    const l = label.getBoundingClientRect();
    for (const n of nodes) {
      const x = Math.min(l.right, n.r.right) - Math.max(l.left, n.r.left);
      const y = Math.min(l.bottom, n.r.bottom) - Math.max(l.top, n.r.top);
      if (x > 4 && y > 4) {
        add('label-on-card', label, `${label.textContent.slice(0, 30)} on ${n.el.textContent.slice(0, 30)}`);
        break;
      }
    }
  }

  // 8. Words that should never reach the screen.
  for (const el of visible) {
    const t = text(el);
    if (!t) continue;
    if (/\bundefined\b|\bNaN\b|\[object|Infinity|\{\w+\}/.test(t)) add('broken-text', el, t.slice(0, 60));
    else if (t === '?') add('broken-text', el, 'a name shown as "?"');
  }

  // 9. Pictures that didn't load.
  for (const img of root.querySelectorAll('img'))
    if (img.complete && img.naturalWidth === 0 && shown(img)) add('missing-image', img, img.src.split('/').pop());

  // 10. Buttons and fields with nothing to call them by (screen readers read "button").
  for (const el of root.querySelectorAll('button, [role=button], a[href], input, select, textarea')) {
    if (!shown(el) || el.type === 'hidden') continue;
    const name =
      el.getAttribute('aria-label') ||
      el.getAttribute('title') ||
      el.getAttribute('aria-labelledby') ||
      el.textContent.trim() ||
      el.getAttribute('placeholder') ||
      (el.id && document.querySelector(`label[for="${el.id}"]`)) ||
      el.closest('label');
    if (!name) add('no-name', el, el.outerHTML.slice(0, 80));
  }

  // 11. On a touch screen, things too small to hit with a finger.
  if (opts?.touch) {
    for (const el of root.querySelectorAll('button, a[href], input:not([type=hidden]), select, [role=button], [role=radio], [role=tab]')) {
      if (!shown(el) || inCanvas(el)) continue;
      // A box inside its label is hit through the label; a slider through its thumb; a link inside a sentence is
      // part of the text around it.
      if (el.closest('label') || el.type === 'range' || (el.tagName === 'A' && el.closest('p'))) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 28 || r.height < 28)
        add(
          'small-to-tap',
          el,
          `${Math.round(r.width)}×${Math.round(r.height)}px ${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30)}`,
        );
    }
  }
  return out;
}
