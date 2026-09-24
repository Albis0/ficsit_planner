/** Scales the whole UI with CSS zoom, 1 = 100%. */
export function applyScale(scale: number) {
  document.documentElement.style.zoom = String(scale);
}
