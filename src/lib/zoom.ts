/** Scales the whole UI. Inside Tauri this is real webview zoom; in a plain browser it falls back to CSS zoom. */
export async function applyScale(scale: number) {
  if ('__TAURI_INTERNALS__' in window) {
    const { getCurrentWebview } = await import('@tauri-apps/api/webview');
    await getCurrentWebview().setZoom(scale);
  } else {
    document.documentElement.style.zoom = String(scale);
  }
}
