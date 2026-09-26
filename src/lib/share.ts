import { useEffect } from 'react';
import { activePowerPlan, defaultEnabled, type Plan, type PowerPlan, poweredBy, useStore } from '../store';
import { importData, KIND } from './backup';

/*
  A shared link carries a factory (or a power plant) in the part of the address after '#', which the
  browser never sends anywhere: no server stores it, and it opens offline too. The tabs are packed
  small (recipe lists as changes from the standard set), compressed and written in URL-safe base64.
*/

export const SHARE_HASH = '#share=';
/** Longest link text worth reading back; far above any real factory, well below what could hang a tab. */
const MAX_LINK = 60_000;
const MAX_TEXT = 1_000_000;

type Packed = Omit<Plan, 'enabled'> & { on: string[]; off: string[] };

/** Recipes as the changes from the standard set: a few ids instead of about 150. */
export function pack(p: Plan): Packed {
  const std = defaultEnabled();
  const on = new Set(p.enabled);
  const { enabled, ...rest } = p;
  const stdSet = new Set(std);
  return { ...rest, on: enabled.filter((id) => !stdSet.has(id)), off: std.filter((id) => !on.has(id)) };
}

export function unpack(x: unknown): unknown {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return x;
  const { on, off, ...rest } = x as Record<string, unknown>;
  const ids = (v: unknown) => (Array.isArray(v) ? v.filter((id): id is string => typeof id === 'string') : []);
  const dropped = new Set(ids(off));
  return { ...rest, enabled: [...defaultEnabled().filter((id) => !dropped.has(id)), ...ids(on)] };
}

/** What a link from the tab on screen carries: a factory with the plants that power it, or a plant with the factories it powers. */
export function sharedTabs(): { plans: Plan[]; power: PowerPlan[] } {
  const s = useStore.getState();
  if (s.mode === 'power') {
    const pp = activePowerPlan(s);
    const fed = pp.sizeBy === 'factories' ? poweredBy(pp, s.plans) : new Set<string>();
    return { plans: s.plans.filter((p) => fed.has(p.id)), power: [pp] };
  }
  const plan = s.plans.find((p) => p.id === s.active) ?? s.plans[0];
  const power = s.power.filter((pp) => pp.plants.length > 0 && pp.sizeBy === 'factories' && poweredBy(pp, s.plans).has(plan.id));
  return { plans: [plan], power };
}

const toBase64Url = (bytes: Uint8Array) => {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromBase64Url = (text: string) => {
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

async function through(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/** 'z' + deflated, or 'j' + plain where the browser can't compress. */
export async function encode(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  if (typeof CompressionStream === 'undefined') return `j${toBase64Url(bytes)}`;
  return `z${toBase64Url(await through(bytes, new CompressionStream('deflate-raw')))}`;
}

export async function decode(text: string): Promise<unknown> {
  if (text.length > MAX_LINK) throw new Error('too long');
  const bytes = fromBase64Url(text.slice(1));
  const raw = text[0] === 'z' ? await through(bytes, new DecompressionStream('deflate-raw')) : text[0] === 'j' ? bytes : undefined;
  if (!raw || raw.length > MAX_TEXT) throw new Error('unreadable');
  return JSON.parse(new TextDecoder().decode(raw));
}

/** The link for the tab on screen. */
export async function shareLink(): Promise<string> {
  const { plans, power } = sharedTabs();
  const body = {
    kind: KIND,
    v: 1,
    from: useStore.getState().mode === 'power' ? 'power' : 'factory',
    plans: plans.map(pack),
    power: power.map((pp) => ({ ...pp, chain: pack(pp.chain) })),
  };
  return `${location.origin}${location.pathname}${SHARE_HASH}${await encode(body)}`;
}

/** Copies the link, or hands it to the phone's share sheet; says which happened. */
export async function shareTab(name: string): Promise<'copied' | 'shared' | 'failed'> {
  try {
    const url = await shareLink();
    const phone = matchMedia('(pointer: coarse)').matches;
    if (phone && navigator.share) {
      try {
        await navigator.share({ title: `${name} · FICSIT Planner`, url });
        return 'shared';
      } catch (e) {
        // Closing the sheet isn't a failure; anything else falls back to copying.
        if ((e as Error).name === 'AbortError') return 'shared';
      }
    }
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch {
    return 'failed';
  }
}

/** Reads a link's tabs into the planner as new tabs and shows the first one. */
export async function openShared(hash: string): Promise<boolean> {
  try {
    const body = (await decode(hash.slice(SHARE_HASH.length))) as { kind?: unknown; from?: unknown; plans?: unknown; power?: unknown };
    if (body?.kind !== KIND || !Array.isArray(body.plans)) return false;
    const power = Array.isArray(body.power)
      ? body.power.map((pp) => (pp && typeof pp === 'object' ? { ...pp, chain: unpack((pp as { chain?: unknown }).chain) } : pp))
      : [];
    const r = importData({ kind: KIND, plans: body.plans.map(unpack), power });
    if (!r.ok || (r.count === 0 && r.power === 0)) return false;
    const s = useStore.getState();
    // A plant's link opens on the plant; a factory's on the factory.
    const plant = body.from === 'power' || r.count === 0 ? r.plants[0] : undefined;
    const name = plant ? s.power.find((p) => p.id === plant)?.name : s.plans.find((p) => p.id === r.plans[0])?.name;
    s.set({
      mode: plant ? 'power' : 'factory',
      ...(plant ? { activePower: plant } : {}),
      tab: 'targets',
      pane: 'floor',
      notice: { key: plant ? 'sharedPlantOpened' : 'sharedOpened', name: name ?? '' },
    });
    return true;
  } catch {
    return false;
  }
}

// The link the page was opened with, read before anything else can rewrite the address (the Codex keeps it in step).
let opening = typeof location !== 'undefined' && location.hash.startsWith(SHARE_HASH) ? location.hash : undefined;
if (opening) history.replaceState(null, '', location.pathname + location.search);

function take(hash: string) {
  openShared(hash).then((ok) => {
    if (!ok) useStore.getState().set({ notice: { key: 'sharedBroken' } });
  });
}

/**
 * Picks up a shared link: the one the page was opened with, and any pasted into the address bar later.
 * The address is cleared at once, so reloading doesn't add the tabs a second time.
 */
export function useSharedLinks() {
  useEffect(() => {
    if (opening) take(opening);
    opening = undefined;
    const later = () => {
      if (!location.hash.startsWith(SHARE_HASH)) return;
      const hash = location.hash;
      history.replaceState(null, '', location.pathname + location.search);
      take(hash);
    };
    window.addEventListener('hashchange', later);
    return () => window.removeEventListener('hashchange', later);
  }, []);
}
