import { motionReduced } from '../components/ModeSwitch';

/**
 * When the pick in a row of choices changes (segmented buttons, the panel tabs, the settings sections), the old
 * pick's highlight glides over to the new one. A background can't move between two buttons in CSS, so a copy of
 * it slides on a short-lived layer under the labels while the new button's own one waits.
 */
const GROUPS = '.segmented, .side > .tabs, .settings-nav, .mobile-nav';
const ON = new Set(['true', 'page']);
const MS = 180;

function slide(group: HTMLElement, from: HTMLElement, to: HTMLElement) {
  const g = group.getBoundingClientRect();
  const a = from.getBoundingClientRect();
  const b = to.getBoundingClientRect();
  if (!a.width || !b.width) return;
  const look = getComputedStyle(to);
  const ghost = document.createElement('span');
  ghost.className = 'slide-ghost';
  ghost.setAttribute('aria-hidden', 'true');
  Object.assign(ghost.style, {
    left: `${b.left - g.left - group.clientLeft + group.scrollLeft}px`,
    top: `${b.top - g.top - group.clientTop + group.scrollTop}px`,
    width: `${b.width}px`,
    height: `${b.height}px`,
    backgroundColor: look.backgroundColor,
    backgroundImage: look.backgroundImage,
    boxShadow: look.boxShadow,
    borderRadius: look.borderRadius,
  });
  if (getComputedStyle(group).position === 'static') group.classList.add('slide-anchor');
  group.classList.add('sliding');
  to.classList.add('slide-to');
  group.appendChild(ghost);
  const run = ghost.animate(
    [
      { transform: `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${a.width / b.width}, ${a.height / b.height})` },
      { transform: 'none' },
    ],
    { duration: MS, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' },
  );
  const done = () => {
    ghost.remove();
    // Hand the highlight back without letting the button's own colour transition replay it.
    to.style.transition = 'none';
    to.classList.remove('slide-to');
    void to.offsetWidth;
    to.style.transition = '';
    if (!group.querySelector('.slide-ghost')) group.classList.remove('sliding', 'slide-anchor');
  };
  run.onfinish = done;
  run.oncancel = done;
}

if (typeof MutationObserver === 'function' && typeof document !== 'undefined') {
  new MutationObserver((records) => {
    if (motionReduced()) return;
    const gained: HTMLElement[] = [];
    const lost: HTMLElement[] = [];
    for (const r of records) {
      const el = r.target as HTMLElement;
      const now = ON.has(el.getAttribute(r.attributeName!) ?? '');
      const was = ON.has(r.oldValue ?? '');
      if (now && !was) gained.push(el);
      else if (was && !now) lost.push(el);
    }
    for (const to of gained) {
      const group = to.closest<HTMLElement>(GROUPS);
      const from = group && lost.find((el) => el.closest(GROUPS) === group);
      if (group && from) slide(group, from, to);
    }
  }).observe(document.documentElement, {
    subtree: true,
    attributes: true,
    attributeOldValue: true,
    attributeFilter: ['aria-checked', 'aria-selected', 'aria-current'],
  });
}
