// The opening screen in index.html stays until the app can show a finished floor: the game data, the solver and the
// first answer. These two calls change what it says and take it away.

const el = () => document.getElementById('boot');

export function bootText(text: string) {
  const span = document.getElementById('boot-text');
  if (span && span.textContent !== text) span.textContent = text;
}

export function bootDone() {
  const boot = el();
  if (!boot || boot.classList.contains('boot-out')) return;
  boot.classList.add('boot-out');
  setTimeout(() => boot.remove(), 220);
}
