import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  type Connection,
  type Edge,
  type FinalConnectionState,
  type Node,
  type NodeChange,
  ReactFlow,
  SelectionMode,
  type Viewport,
  ReactFlowProvider,
  useReactFlow,
  useStore as useFlowStore,
  useStoreApi,
} from '@xyflow/react';
import '@xyflow/react/dist/base.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ExtractionSettings } from '../../lib/extraction';
import { useT } from '../../lib/i18n';
import type { CalcResult } from '../../lib/model/calc/result';
import { builtTransport, compile } from '../../lib/model/calc/compile';
import { openCards, openEnds, ruleFlags } from '../../lib/model/checks';
import { type Choice, placeChoice, type Want, wantAt } from '../../lib/model/choices';
import { cardSize, dirOf, GRID, snap } from '../../lib/model/layout';
import {
  addNode,
  type Clip,
  canConnect,
  connect,
  copyNodes,
  moveNodes,
  pasteClip,
  removeLinks,
  removeNodes,
  updateNode,
} from '../../lib/model/ops';
import { portsOf } from '../../lib/model/ports';
import { type Model, isPart } from '../../lib/model/types';
import { COARSE, useMediaQuery } from '../../lib/useMediaQuery';
import { useStore } from '../../store';
import { openingViewport } from '../GraphView';
import { type BeltData, BeltLink, PickLink } from './BeltLink';
import { CardMenu, type CardMenuItem } from './CardMenu';
import { Chooser } from './Chooser';
import { FloorStrip } from './FloorStrip';
import { CalcNodes, CardFlags, EditCard, FloorDir, type PartData, PartNode, RemoveCard } from './PartNode';

/**
 * Where a hand-built model lives and how it changes. The factory tab is one host today; the editor knows nothing else
 * about where the model is kept, so it can move somewhere else unchanged.
 */
export interface ModelHost {
  /** Names the model for its undo list and its camera. */
  key: string;
  model: Model;
  edit: (fn: (m: Model) => Model, merge?: string) => void;
  undo: () => void;
  redo: () => void;
  /** Recipes this home has turned on: the chooser lists only these, and a card with another one says so. */
  on?: ReadonlySet<string>;
  /** The miner, purity and clock a new miner comes with. */
  extraction?: ExtractionSettings;
  /** Most of each resource a minute; a miner past it says so. */
  caps?: Record<string, number>;
}

const nodeTypes = { part: PartNode };
const edgeTypes = { belt: BeltLink };

/** Room kept along the floor's bottom edge for its buttons, so no card opens under them. */
const BAR = 76;
/** Room kept along the top for the toolbar, at the least. */
const TOP = 60;

/** Room kept along the top: down to the toolbar's lower edge, which wraps onto a second row on a phone. */
function topRoom() {
  const floor = document.querySelector('.floor-view')?.getBoundingClientRect();
  const bar = document.querySelector('.model-toolbar')?.getBoundingClientRect();
  return floor && bar ? Math.max(TOP, Math.round(bar.bottom - floor.top + 12)) : TOP;
}

/** Furthest out: far enough for a whole big factory on a phone. */
const MIN_ZOOM = 0.04;

/** How long after opening a floor its camera follows the floor's size, while the totals over it come in. */
const SETTLE = 3000;

/** How long a finger stays still on the empty floor before the build menu opens. */
const PRESS = 500;
/** How long a click waits for a second one before the card's panel opens. */
const DOUBLE = 250;

/** Cards copied with Ctrl+C, kept while the app is open so they paste on any floor. */
let clipboard: Clip | undefined;

/** Outputs and inputs have nothing to set on the floor (their amounts are in the side panel), so they open no panel. */
const panelless = (n: { k: string } | undefined) => n?.k === 'in' || n?.k === 'out';

/** The chooser's size, for keeping it inside the floor. */
const CHOOSER = { w: 440, h: 520 };
/** Narrower than this, the chooser comes up from the bottom instead. */
const SHEET = 600;

/** Where the camera was on each model, so coming back from the list finds the floor as it was left. */
const cameras = new Map<string, Viewport>();

/** Models built afresh or tidied up: they open with the whole floor in view. */
const showAll = new Set<string>();

/** Forgets where the camera was on a model, so a model built afresh or tidied up opens with all of it in view. */
export const forgetCamera = (key: string) => {
  cameras.delete(key);
  showAll.add(key);
};

/** The camera with every card in view, below the toolbar and above the buttons, no closer than the cards' own size. */
function fitted(nodes: Node[], width: number, height: number, top: number): Viewport {
  const x0 = Math.min(...nodes.map((n) => n.position.x));
  const y0 = Math.min(...nodes.map((n) => n.position.y));
  const x1 = Math.max(...nodes.map((n) => n.position.x + (n.width ?? 0)));
  const y1 = Math.max(...nodes.map((n) => n.position.y + (n.height ?? 0)));
  const w = width - 48;
  const h = height - top - BAR;
  const zoom = Math.max(MIN_ZOOM, Math.min(1, w / Math.max(1, x1 - x0), h / Math.max(1, y1 - y0)));
  return { x: 24 + (w - (x1 - x0) * zoom) / 2 - x0 * zoom, y: top + (h - (y1 - y0) * zoom) / 2 - y0 * zoom, zoom };
}

/**
 * A big floor opens at the readable zoom on the stretch with the most cards in view, rather than on the first
 * column, which on a floor laid out by hand or tidied can be one miner in an empty corner.
 */
function densest(nodes: Node[], v: Viewport, width: number, height: number): Viewport {
  const centres = nodes.map((n) => ({ x: n.position.x + (n.width ?? 0) / 2, y: n.position.y + (n.height ?? 0) / 2 }));
  const w = width / v.zoom / 2;
  const h = height / v.zoom / 2;
  const inside = (c: { x: number; y: number }) => centres.filter((p) => Math.abs(p.x - c.x) < w && Math.abs(p.y - c.y) < h);
  // The whole floor already in view: as it is.
  const shown = { x: (width / 2 - v.x) / v.zoom, y: (height / 2 - v.y) / v.zoom };
  if (inside(shown).length === centres.length) return v;
  let best = shown;
  let most = inside(shown).length;
  for (const c of centres) {
    const near = inside(c);
    // Centred on what's around it, so the cards at the window's edge aren't cut in half.
    const mid = { x: near.reduce((s, p) => s + p.x, 0) / near.length, y: near.reduce((s, p) => s + p.y, 0) / near.length };
    const n = inside(mid).length;
    if (n > most || (n === most && mid.x < best.x)) {
      most = n;
      best = mid;
    }
  }
  return { x: width / 2 - best.x * v.zoom, y: height / 2 - best.y * v.zoom, zoom: v.zoom };
}

const REVEAL = 'ficsit-reveal-card';

/** Moves the floor just enough to show a card, from outside the editor: the side panel adding one, or going to one. */
export const revealCard = (id: string) => window.dispatchEvent(new CustomEvent(REVEAL, { detail: id }));

/** What the panel shows: a node by its id, or a belt as "link:<id>". */
export const linkKey = (id: string) => `link:${id}`;

const typing = (e: KeyboardEvent) =>
  !!(e.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable]') || !!document.querySelector('dialog[open]');

/** Where a mouse or finger let go, on the screen. */
const pointOf = (e: MouseEvent | TouchEvent) =>
  'changedTouches' in e ? { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY } : { x: e.clientX, y: e.clientY };

/** The chooser open: where the new card goes on the floor, where the chooser shows, and the belt waiting for it. */
interface Choosing {
  /** The floor it opens over, above the toolbar and the buttons along the bottom. */
  over: Element;
  flowAt: { x: number; y: number };
  at?: { x: number; y: number };
  want?: Want;
}

const clickStartSelector = (s: { connectionClickStartHandle: { nodeId: string; id?: string | null; type: string } | null }) =>
  s.connectionClickStartHandle;

function Canvas({ host, calc, onArrange }: { host: ModelHost; calc?: CalcResult; onArrange?: (m: Model) => void }) {
  const { t } = useT();
  const tier = useStore((s) => s.tier);
  const inspect = useStore((s) => s.inspect);
  const set = useStore((s) => s.set);
  const gridLines = useStore((s) => s.settings.gridLines);
  const addWith = useStore((s) => s.settings.addWith);
  const coarse = useMediaQuery(COARSE);
  const flow = useReactFlow();
  const flowStore = useStoreApi();
  const clickStart = useFlowStore(clickStartSelector);
  const { model } = host;
  const dir = dirOf(model);
  // What the belt being laid by taps carries, when its end says.
  const clickItem = useMemo(() => {
    const n = clickStart && model.nodes.find((x) => x.id === clickStart.nodeId);
    if (!n || !clickStart) return undefined;
    const p = portsOf(n);
    return (clickStart.type === 'source' ? p.outs : p.ins)[Number(clickStart.id?.slice(1))]?.item;
  }, [clickStart, model]);
  const [choosing, setChoosing] = useState<Choosing>();
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; ids: string[] }>();
  // Cards just pasted or duplicated: picked once they're drawn, so they can be moved off together.
  const pickNext = useRef<Set<string>>(new Set());
  // Where the pointer last was on the floor, in floor units: Ctrl+V puts the copy there.
  const pointer = useRef<{ x: number; y: number }>(undefined);
  const opening = useRef<number>(undefined);
  useEffect(() => () => clearTimeout(opening.current), []);

  // Cards as React Flow draws them. Kept here so a drag moves the card at once; the model hears of it when it's let go.
  const toNodes = useCallback(
    (m: Model, keep?: Node[], letGo = false, pick: ReadonlySet<string> = new Set()): Node[] => {
      const open = openEnds(m);
      const wired = new Map<string, { ins: boolean[]; outs: boolean[] }>();
      const lanes = new Map<string, { ins: number[]; outs: number[] }>();
      for (const n of m.nodes) {
        const p = portsOf(n);
        wired.set(n.id, { ins: p.ins.map(() => false), outs: p.outs.map(() => false) });
        lanes.set(n.id, { ins: p.ins.map(() => 1), outs: p.outs.map(() => 1) });
      }
      for (const l of m.links) {
        const a = wired.get(l.a);
        const b = wired.get(l.b);
        if (a && l.ap < a.outs.length) a.outs[l.ap] = true;
        if (b && l.bp < b.ins.length) b.ins[l.bp] = true;
        // An end holds as many belts side by side as the line on it has, up to six.
        const n = Math.min(6, l.lanes ?? 1);
        const la = lanes.get(l.a);
        const lb = lanes.get(l.b);
        if (la && l.ap < la.outs.length) la.outs[l.ap] = Math.max(la.outs[l.ap], n);
        if (lb && l.bp < lb.ins.length) lb.ins[l.bp] = Math.max(lb.ins[l.bp], n);
      }
      const was = new Map(keep?.map((n) => [n.id, n]));
      return m.nodes.filter(isPart).map((n) => ({
        ...was.get(n.id),
        id: n.id,
        type: 'part',
        position: { x: n.x, y: n.y },
        data: { node: n, wired: wired.get(n.id)!, lanes: lanes.get(n.id), open: open.get(n.id) } satisfies PartData,
        selected: inspect === n.id || pick.has(n.id) || (!letGo && was.get(n.id)?.selected),
      }));
    },
    [inspect],
  );
  const [nodes, setNodes] = useState<Node[]>(() => toNodes(model));
  // Closing the panel lets go of the cards too, so on a phone a finger on them pans the floor again.
  const shownBefore = useRef(inspect);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new model (or a new pick in the panel) redraws the cards.
  useEffect(() => {
    const letGo = shownBefore.current !== undefined && inspect === undefined;
    shownBefore.current = inspect;
    // Taken now: the redraw runs later, when this may be set again.
    const pick = pickNext.current;
    pickNext.current = new Set();
    setNodes((cur) => toNodes(model, cur, letGo, pick));
  }, [model, inspect]);

  const [picked, setPicked] = useState<Set<string>>(new Set());
  const net = useMemo(() => compile(model, tier), [model, tier]);
  // Cards that go against the side panel: a recipe turned off, above the tier, a resource past its limit.
  const flags = useMemo(() => ruleFlags(model, { tier, on: host.on, caps: host.caps }, calc), [model, tier, host.on, host.caps, calc]);
  const edges = useMemo<Edge[]>(
    () =>
      net.arcs.map((a) => ({
        id: a.link.id,
        source: a.link.a,
        sourceHandle: `o${a.link.ap}`,
        target: a.link.b,
        targetHandle: `i${a.link.bp}`,
        type: 'belt',
        selected: picked.has(a.link.id) || inspect === linkKey(a.link.id),
        data: {
          link: a.link,
          item: a.items[0] ?? a.from.ports.outs[a.link.ap]?.item ?? a.to.ports.ins[a.link.bp]?.item,
          transport: builtTransport(a.medium, a.link, tier, calc?.links[a.link.id]?.rate),
          calc: calc?.links[a.link.id],
          down: dir === 'TB',
        } satisfies BeltData,
      })),
    [net, calc, picked, inspect, tier, dir],
  );

  // On a touch screen a card moves only once it's picked, so a finger on any other card pans the floor.
  const shown = useMemo(() => (coarse ? nodes.map((n) => ({ ...n, draggable: !!n.selected })) : nodes), [nodes, coarse]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    // Removing goes through the model (Delete key), so it can be undone.
    setNodes((cur) =>
      applyNodeChanges(
        changes.filter((c) => c.type !== 'remove'),
        cur,
      ),
    );
  }, []);

  const removeSelected = useCallback(() => {
    const gone = nodes.filter((n) => n.selected).map((n) => n.id);
    const belts = edges.filter((e) => e.selected).map((e) => e.id);
    if (!gone.length && !belts.length) return;
    host.edit((m) => removeLinks(removeNodes(m, gone), belts));
    setPicked(new Set());
    set({ inspect: undefined });
  }, [nodes, edges, host, set]);

  /** The cards picked on the floor, or the one whose panel is open. */
  const pickedCards = useCallback(() => {
    const ids = nodes.filter((n) => n.selected).map((n) => n.id);
    return ids.length ? ids : inspect && model.nodes.some((n) => n.id === inspect) ? [inspect] : [];
  }, [nodes, inspect, model]);

  /**
   * A copy down on the floor: where the pointer is, or else just past the cards copied (below them on a floor running
   * left to right, beside them on one running down), moved on until it lies on no card. One step to undo.
   */
  const paste = useCallback(
    (clip: Clip, at?: { x: number; y: number }) => {
      const boxes = clip.nodes.map((n) => ({ x: n.x, y: n.y, ...cardSize(n, dir) }));
      const x0 = Math.min(...boxes.map((b) => b.x));
      const y0 = Math.min(...boxes.map((b) => b.y));
      const w = Math.max(...boxes.map((b) => b.x + b.w)) - x0;
      const h = Math.max(...boxes.map((b) => b.y + b.h)) - y0;
      let dx = at ? snap(at.x) - x0 : dir === 'TB' ? w + GRID : 0;
      let dy = at ? snap(at.y) - y0 : dir === 'TB' ? 0 : h + GRID;
      const taken = model.nodes.filter(isPart).map((n) => ({ x: n.x, y: n.y, ...cardSize(n, dir) }));
      const hits = () =>
        boxes.some((b) => taken.some((t) => b.x + dx < t.x + t.w && t.x < b.x + dx + b.w && b.y + dy < t.y + t.h && t.y < b.y + dy + b.h));
      for (let i = 0; i < 400 && hits(); i++) {
        if (dir === 'TB') dx += GRID;
        else dy += GRID;
      }
      let made: string[] = [];
      host.edit((m) => {
        const r = pasteClip(m, clip, dx, dy);
        made = r.ids;
        return r.model;
      });
      // Only the copy is picked afterwards, so it moves off on its own.
      setNodes((cur) => cur.map((n) => (n.selected ? { ...n, selected: false } : n)));
      pickNext.current = new Set(made);
      setPicked(new Set());
      set({ inspect: undefined });
    },
    [model, dir, host, set],
  );
  const copy = useCallback(
    (ids: string[]) => {
      const c = copyNodes(model, ids);
      if (c) clipboard = c;
    },
    [model],
  );
  const duplicate = useCallback(
    (ids: string[]) => {
      const c = copyNodes(model, ids);
      if (c) paste(c);
    },
    [model, paste],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e)) {
        // Escape in a field of the panel leaves the field; a second one lets go of the card.
        if (e.key === 'Escape') (e.target as HTMLElement).blur?.();
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) host.redo();
        else host.undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        host.redo();
      } else if (mod && e.key.toLowerCase() === 'c' && !window.getSelection()?.toString()) {
        const ids = pickedCards();
        if (ids.length) {
          e.preventDefault();
          copy(ids);
        }
      } else if (mod && e.key.toLowerCase() === 'v' && clipboard) {
        e.preventDefault();
        paste(clipboard, pointer.current);
      } else if (mod && e.key.toLowerCase() === 'd') {
        const ids = pickedCards();
        if (ids.length) {
          e.preventDefault();
          duplicate(ids);
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        removeSelected();
      } else if (e.key === 'Escape') {
        setPicked(new Set());
        setNodes((cur) => cur.map((n) => (n.selected ? { ...n, selected: false } : n)));
        flowStore.setState({ connectionClickStartHandle: null, nodesSelectionActive: false });
        set({ inspect: undefined });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [host, removeSelected, set, flowStore, pickedCards, copy, paste, duplicate]);

  const editCard = useCallback((id: string, patch: Record<string, unknown>) => host.edit((m) => updateNode(m, id, patch)), [host]);
  const removeCard = useCallback(
    (id: string) => {
      host.edit((m) => removeNodes(m, [id]));
      if (inspect === id) set({ inspect: undefined });
    },
    [host, inspect, set],
  );

  const pickLink = useCallback(
    (id: string) => {
      setPicked(new Set());
      set({ inspect: linkKey(id) });
    },
    [set],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      const ap = Number(c.sourceHandle?.slice(1));
      const bp = Number(c.targetHandle?.slice(1));
      if (!c.source || !c.target || !Number.isInteger(ap) || !Number.isInteger(bp)) return;
      host.edit((m) => connect(m, c.source, ap, c.target, bp).model);
    },
    [host],
  );
  /** Opens the chooser at a spot on the screen, for a new card there (fed by, or feeding, a waiting belt). */
  const choose = useCallback(
    (screen: { x: number; y: number } | undefined, want?: Want) => {
      const over = document.querySelector('.floor-view');
      const box = over?.getBoundingClientRect();
      if (!over || !box) return;
      const centre = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
      const flowAt = flow.screenToFlowPosition(screen ?? centre);
      // Beside the spot, kept inside the floor; on a narrow screen it comes up from the bottom.
      const at =
        screen && box.width >= SHEET
          ? {
              x: Math.max(12, Math.min(screen.x - box.left + 12, box.width - CHOOSER.w - 12)),
              y: Math.max(12, Math.min(screen.y - box.top - 40, box.height - CHOOSER.h - 12)),
            }
          : undefined;
      setChoosing({ over, flowAt, at, want });
    },
    [flow],
  );

  const onPick = useCallback(
    (c: Choice) => {
      if (!choosing) return;
      const { flowAt, want } = choosing;
      let made: string | undefined;
      let ioCard = false;
      host.edit((m) => {
        const { id: _, ...init } = placeChoice(m, c, flowAt, want);
        const added = addNode(m, init as Parameters<typeof addNode>[1]);
        made = added.id;
        ioCard = panelless(init);
        if (!want || c.port === undefined) return added.model;
        return want.side === 'in'
          ? connect(added.model, want.node, want.port, added.id, c.port).model
          : connect(added.model, added.id, c.port, want.node, want.port).model;
      });
      setChoosing(undefined);
      setPicked(new Set());
      if (made) {
        // An output has no panel of its own; its amount is set in the side panel.
        set({ inspect: ioCard ? undefined : made });
        setReveal(made);
      }
    },
    [choosing, host, set],
  );

  // A card just put down that landed under the panel or off the floor's edge: the floor moves just enough to show it.
  const [reveal, setReveal] = useState<string>();
  useEffect(() => {
    const on = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      setReveal(id);
      // Shown picked, so it's plain which card the side panel meant.
      pickNext.current = new Set([id]);
      setNodes((cur) => cur.map((x) => (x.selected === (x.id === id) ? x : { ...x, selected: x.id === id })));
    };
    window.addEventListener(REVEAL, on);
    return () => window.removeEventListener(REVEAL, on);
  }, []);
  useEffect(() => {
    if (!reveal) return;
    let gone = false;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(async () => {
        // Where the panel ends up, once it has slid in.
        const sliding = document.querySelector('.floor-view .inspector')?.getAnimations() ?? [];
        await Promise.all(sliding.map((a) => a.finished.catch(() => {})));
        if (gone) return;
        setReveal(undefined);
        const card = document.querySelector(`.react-flow__node[data-id="${CSS.escape(reveal)}"]`)?.getBoundingClientRect();
        const floor = document.querySelector('.floor-view')?.getBoundingClientRect();
        if (!card || !floor) return;
        const panel = document.querySelector('.floor-view .inspector')?.getBoundingClientRect();
        // The panel sits on the right on a wide screen, along the bottom on a phone.
        const side = panel && panel.left > floor.left + floor.width / 2;
        const right = (side ? panel.left : floor.right) - 16;
        const bottom = (panel && !side ? panel.top : floor.bottom) - (panel && !side ? 16 : BAR);
        const left = floor.left + 16;
        const top = floor.top + topRoom();
        const dx = card.right > right ? Math.max(right - card.right, left - card.left) : card.left < left ? left - card.left : 0;
        const dy = card.bottom > bottom ? Math.max(bottom - card.bottom, top - card.top) : card.top < top ? top - card.top : 0;
        if (!dx && !dy) return;
        const v = flow.getViewport();
        flow.setViewport({ ...v, x: v.x + dx, y: v.y + dy }, { duration: 250 });
      });
    });
    return () => {
      gone = true;
      cancelAnimationFrame(frame);
    };
  }, [reveal, flow]);

  /** A belt let go: on a card, onto its first free end that fits; on the floor, the chooser for what goes there. */
  const onConnectEnd = useCallback(
    (e: MouseEvent | TouchEvent, st: FinalConnectionState) => {
      if (st.isValid || !st.fromHandle) return;
      const from = st.fromHandle;
      const side = from.type === 'source' ? 'out' : 'in';
      const port = Number(from.id?.slice(1));
      if (!Number.isInteger(port)) return;
      const p = pointOf(e);
      const hit = document.elementFromPoint(p.x, p.y);
      const card = hit?.closest('.react-flow__node')?.getAttribute('data-id');
      if (card) {
        if (card === from.nodeId) return;
        const to = model.nodes.find((n) => n.id === card);
        if (!to) return;
        const ends = side === 'out' ? portsOf(to).ins : portsOf(to).outs;
        const taken = new Set(model.links.filter((l) => (side === 'out' ? l.b : l.a) === card).map((l) => (side === 'out' ? l.bp : l.ap)));
        const fits = ends
          .map((_, i) => i)
          .filter((i) => !(side === 'out' ? canConnect(model, from.nodeId, port, card, i) : canConnect(model, card, i, from.nodeId, port)));
        const end = fits.find((i) => !taken.has(i)) ?? fits[0];
        if (end === undefined) return;
        host.edit((m) => (side === 'out' ? connect(m, from.nodeId, port, card, end) : connect(m, card, end, from.nodeId, port)).model);
        return;
      }
      if (!hit?.closest('.react-flow__pane')) return;
      choose(p, wantAt(model, tier, from.nodeId, side, port));
    },
    [model, host, tier, choose],
  );

  // The camera a floor opens with: all of it when built afresh or tidied up, else the stretch with the most cards.
  // Kept while the floor around it settles (the totals come in a moment later and take room from the top), until
  // the player moves it.
  const settling = useRef<{ until: number; all: boolean }>(undefined);
  const latest = useRef(nodes);
  latest.current = nodes;
  const latestDir = useRef(dir);
  latestDir.current = dir;
  const openCamera = useCallback(
    (all: boolean) => {
      const box = document.querySelector('.floor-view')?.getBoundingClientRect();
      if (!box) return;
      const sized = latest.current.map((n) => {
        const { w, h } = cardSize((n.data as PartData).node, latestDir.current);
        return { ...n, width: w, height: h };
      });
      const top = topRoom();
      if (all) return void flow.setViewport(fitted(sized, box.width, box.height, top));
      // Below the toolbar along the top, above the buttons along the bottom.
      const h = box.height - BAR - top;
      const v = openingViewport(sized, box.width, h, latestDir.current);
      const d = densest(sized, v, box.width, h);
      flow.setViewport({ ...d, y: d.y + top });
    },
    [flow],
  );
  useEffect(() => {
    const floor = document.querySelector('.floor-view');
    if (!floor) return;
    const watch = new ResizeObserver(() => {
      const s = settling.current;
      if (s && performance.now() < s.until) openCamera(s.all);
    });
    watch.observe(floor);
    return () => watch.disconnect();
  }, [openCamera]);

  const closeChooser = useCallback(() => setChoosing(undefined), []);

  // A finger held still on the empty floor opens the build menu there.
  const flowEl = useRef<HTMLDivElement>(null);
  const chooseRef = useRef(choose);
  chooseRef.current = choose;
  useEffect(() => {
    const el = flowEl.current;
    if (!el) return;
    let press: { x: number; y: number; timer: ReturnType<typeof setTimeout> } | undefined;
    // Opened by a held finger: the mouse events the browser sends when it lifts would pick what's under it.
    let fired = false;
    const lift = (e: TouchEvent) => {
      if (fired) e.preventDefault();
      fired = false;
    };
    const cancel = () => {
      if (press) clearTimeout(press.timer);
      press = undefined;
    };
    const down = (e: PointerEvent) => {
      cancel();
      if (e.pointerType !== 'touch' || !(e.target as HTMLElement).classList.contains('react-flow__pane')) return;
      const at = { x: e.clientX, y: e.clientY };
      press = {
        ...at,
        timer: setTimeout(() => {
          fired = true;
          chooseRef.current(at);
        }, PRESS),
      };
    };
    const move = (e: PointerEvent) => {
      if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) cancel();
    };
    el.addEventListener('pointerdown', down, true);
    el.addEventListener('pointermove', move, true);
    for (const t of ['pointerup', 'pointercancel']) el.addEventListener(t, cancel, true);
    el.addEventListener('touchend', lift, { capture: true, passive: false });
    return () => {
      el.removeEventListener('touchend', lift, true);
      cancel();
      el.removeEventListener('pointerdown', down, true);
      el.removeEventListener('pointermove', move, true);
      for (const t of ['pointerup', 'pointercancel']) el.removeEventListener(t, cancel, true);
    };
  }, []);
  const parts = model.nodes.filter(isPart).length;

  // Cards with an end that needs a belt; the button goes from one to the next.
  const open = useMemo(() => openCards(model), [model]);
  const openAt = useRef(0);
  const nextOpen = () => {
    const id = open[openAt.current++ % open.length];
    const n = model.nodes.find((x) => x.id === id);
    if (!n) return;
    const { w, h } = cardSize(n, dir);
    flow.setCenter(n.x + w / 2, n.y + h / 2, { zoom: Math.max(flow.getZoom(), 0.8), duration: 300 });
    setPicked(new Set());
    if (panelless(n)) {
      pickNext.current = new Set([id]);
      setNodes((cur) => cur.map((x) => ({ ...x, selected: x.id === id })));
      set({ inspect: undefined });
    } else set({ inspect: id });
  };

  const isValid = useCallback(
    (c: Connection | Edge) => {
      const ap = Number(c.sourceHandle?.slice(1));
      const bp = Number(c.targetHandle?.slice(1));
      return !!c.source && !!c.target && !canConnect(model, c.source, ap, c.target, bp);
    },
    [model],
  );

  return (
    <CalcNodes.Provider value={calc?.nodes}>
      <CardFlags.Provider value={flags}>
        <FloorDir.Provider value={dir}>
          <RemoveCard.Provider value={removeCard}>
            <EditCard.Provider value={editCard}>
              <PickLink.Provider value={pickLink}>
                <ReactFlow
                  nodes={shown}
                  edges={edges}
                  nodeTypes={nodeTypes}
                  edgeTypes={edgeTypes}
                  onNodesChange={onNodesChange}
                  onNodeDragStop={(_, __, dragged) => host.edit((m) => moveNodes(m, new Map(dragged.map((n) => [n.id, n.position]))))}
                  onConnect={onConnect}
                  onConnectEnd={onConnectEnd}
                  isValidConnection={isValid}
                  ref={flowEl}
                  onDoubleClick={(e) => {
                    // A double click on the empty floor puts something down there, when the settings say so; a right click
                    // otherwise. Never both, so the one that isn't for adding stays free.
                    if (addWith === 'double' && (e.target as HTMLElement).classList.contains('react-flow__pane'))
                      choose({ x: e.clientX, y: e.clientY });
                  }}
                  onPaneContextMenu={(e) => {
                    e.preventDefault();
                    // A held finger is handled above; a phone sends this too.
                    if (coarse) return;
                    if (addWith === 'right') choose({ x: e.clientX, y: e.clientY });
                  }}
                  connectOnClick
                  nodesDraggable
                  elementsSelectable
                  selectNodesOnDrag={false}
                  deleteKeyCode={null}
                  multiSelectionKeyCode={['Control', 'Meta']}
                  selectionKeyCode="Shift"
                  selectionMode={SelectionMode.Partial}
                  minZoom={MIN_ZOOM}
                  maxZoom={2}
                  snapToGrid
                  snapGrid={[GRID, GRID]}
                  proOptions={{ hideAttribution: true }}
                  defaultViewport={cameras.get(host.key)}
                  onInit={() => {
                    if (cameras.has(host.key) || model.nodes.length === 0) return;
                    const all = showAll.delete(host.key);
                    settling.current = { until: performance.now() + SETTLE, all };
                    openCamera(all);
                  }}
                  onMoveStart={(e) => {
                    // Moved by the player: the camera is theirs from here on.
                    if (e) settling.current = undefined;
                  }}
                  onMoveEnd={(_, v) => cameras.set(host.key, v)}
                  onNodeClick={(e, n) => {
                    // A tap on an end lays a belt; it doesn't open the card.
                    if ((e.target as HTMLElement).closest('.react-flow__handle')) return;
                    setPicked(new Set());
                    // The card shows picked at once; its panel waits out a double click, which ticks it built instead.
                    clearTimeout(opening.current);
                    if (e.detail > 1) return;
                    if (panelless((n.data as PartData).node)) {
                      set({ inspect: undefined });
                      return;
                    }
                    opening.current = window.setTimeout(() => set({ inspect: n.id }), DOUBLE);
                  }}
                  onNodeContextMenu={(e, n) => {
                    e.preventDefault();
                    const box = flowEl.current?.getBoundingClientRect();
                    if (!box) return;
                    clearTimeout(opening.current);
                    // A right click on one of the picked cards is for all of them.
                    const all = nodes.filter((x) => x.selected).map((x) => x.id);
                    const ids = all.includes(n.id) ? all : [n.id];
                    const [w, h] = [210, 200];
                    setMenu({
                      at: { x: Math.min(e.clientX - box.left, box.width - w - 8), y: Math.min(e.clientY - box.top, box.height - h - 8) },
                      ids,
                    });
                  }}
                  onNodeDoubleClick={(e, n) => {
                    clearTimeout(opening.current);
                    // A double click ticks a card built in the game, or unticks it.
                    if ((e.target as HTMLElement).closest('.react-flow__handle, button')) return;
                    const was = model.nodes.find((x) => x.id === n.id);
                    if (was) host.edit((m) => updateNode(m, n.id, { done: was.done ? undefined : true }));
                  }}
                  onEdgeClick={(ev, e) => {
                    // As with cards: the panel waits out a double click, which takes the belt off instead.
                    clearTimeout(opening.current);
                    if (ev.detail > 1) return;
                    opening.current = window.setTimeout(() => pickLink(e.id), DOUBLE);
                  }}
                  onEdgeDoubleClick={(_, e) => {
                    clearTimeout(opening.current);
                    host.edit((m) => removeLinks(m, [e.id]));
                    if (inspect === linkKey(e.id)) set({ inspect: undefined });
                  }}
                  onPaneMouseMove={(e) => {
                    pointer.current = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
                  }}
                  onPaneMouseLeave={() => {
                    pointer.current = undefined;
                  }}
                  onPaneClick={(e) => {
                    // Half way through laying a belt by taps: the floor tapped is where the next card goes.
                    const start = flowStore.getState().connectionClickStartHandle;
                    if (start) {
                      flowStore.setState({ connectionClickStartHandle: null });
                      const port = Number(start.id?.slice(1));
                      if (Number.isInteger(port)) {
                        choose(
                          { x: e.clientX, y: e.clientY },
                          wantAt(model, tier, start.nodeId, start.type === 'source' ? 'out' : 'in', port),
                        );
                        return;
                      }
                    }
                    clearTimeout(opening.current);
                    setPicked(new Set());
                    set({ inspect: undefined });
                  }}
                  zoomOnDoubleClick={false}
                >
                  {gridLines && <Background id="minor" variant={BackgroundVariant.Lines} gap={GRID} lineWidth={1} color="#2f2f2f" />}
                  {gridLines && <Background id="major" variant={BackgroundVariant.Lines} gap={GRID * 4} lineWidth={1} color="#3b3b3b" />}
                  {parts === 0 && !choosing && (
                    <div className="floor-empty">
                      <button type="button" className="primary-button" onClick={() => choose(undefined)}>
                        {t('addFirst')}
                      </button>
                    </div>
                  )}
                  {clickStart && (
                    <FloorStrip
                      item={clickItem}
                      actions={
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => flowStore.setState({ connectionClickStartHandle: null })}
                        >
                          {t('cancel')}
                        </button>
                      }
                    >
                      {clickStart.type === 'source' ? t('tapInput') : t('tapOutput')}
                    </FloorStrip>
                  )}
                  <div className="floor-controls">
                    {onArrange && model.nodes.some(isPart) && (
                      <div className="segmented floor-dir" role="radiogroup" aria-label={t('direction')}>
                        {(['LR', 'TB'] as const).map((d) => (
                          <button
                            key={d}
                            type="button"
                            role="radio"
                            aria-checked={dir === d}
                            title={t(d === 'LR' ? 'leftToRight' : 'topToBottom')}
                            // Turned the other way, the floor is laid out afresh that way; one undo turns it back.
                            onClick={() => {
                              if (d === dir) return;
                              const { dir: _, ...rest } = model;
                              onArrange(d === 'TB' ? { ...rest, dir: 'TB' } : rest);
                            }}
                          >
                            <span aria-hidden>{d === 'LR' ? '→' : '↓'}</span>
                            <span className="sr-only">{t(d === 'LR' ? 'leftToRight' : 'topToBottom')}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {open.length > 0 && (
                      <button
                        type="button"
                        className="floor-button open-ends"
                        title={t('openEndsHint')}
                        aria-label={t('openEnds', { n: open.length })}
                        onClick={nextOpen}
                      >
                        <span className="fit-label">{t('openEnds', { n: open.length })}</span>
                        <span className="fit-icon" aria-hidden>
                          ⚠︎ {open.length}
                        </span>
                      </button>
                    )}
                    <button
                      type="button"
                      className="floor-button"
                      title={t('fit')}
                      onClick={() =>
                        flow.fitView({
                          padding: { top: `${topRoom()}px`, left: '24px', right: '24px', bottom: `${BAR}px` },
                          maxZoom: 1,
                          duration: 250,
                        })
                      }
                    >
                      <span className="fit-icon" aria-hidden>
                        ⤢
                      </span>
                      <span className="fit-label">{t('fit')}</span>
                    </button>
                  </div>
                  {menu && (
                    <CardMenu
                      at={menu.at}
                      onClose={() => setMenu(undefined)}
                      items={((): CardMenuItem[] => {
                        const ids = menu.ids;
                        const cards = model.nodes.filter((n) => ids.includes(n.id));
                        const built = cards.length > 0 && cards.every((n) => n.done);
                        return [
                          { label: t('duplicate'), keys: 'Ctrl+D', onPick: () => duplicate(ids) },
                          { label: t('copy'), keys: 'Ctrl+C', onPick: () => copy(ids) },
                          ...(clipboard ? [{ label: t('paste'), keys: 'Ctrl+V', onPick: () => clipboard && paste(clipboard) }] : []),
                          {
                            label: built ? t('notBuilt') : t('markBuilt'),
                            onPick: () =>
                              host.edit((m) => ids.reduce((acc, id) => updateNode(acc, id, { done: built ? undefined : true }), m)),
                          },
                          {
                            label: t('remove'),
                            keys: 'Del',
                            danger: true,
                            onPick: () => {
                              host.edit((m) => removeNodes(m, ids));
                              setPicked(new Set());
                              set({ inspect: undefined });
                            },
                          },
                        ];
                      })()}
                    />
                  )}
                  {choosing &&
                    createPortal(
                      <Chooser want={choosing.want} tier={tier} rules={host} at={choosing.at} onPick={onPick} onClose={closeChooser} />,
                      choosing.over,
                    )}
                </ReactFlow>
              </PickLink.Provider>
            </EditCard.Provider>
          </RemoveCard.Provider>
        </FloorDir.Provider>
      </CardFlags.Provider>
    </CalcNodes.Provider>
  );
}

/** The hand-built floor: cards where the player put them, belts they laid, the numbers on both. */
export function ModelEditor({ host, calc, onArrange }: { host: ModelHost; calc?: CalcResult; onArrange?: (m: Model) => void }) {
  return (
    <ReactFlowProvider key={host.key}>
      {/* With the numbers off, cards and belts show none: not even zeros. */}
      <Canvas host={host} calc={calc?.mode === 'off' ? undefined : calc} onArrange={onArrange} />
    </ReactFlowProvider>
  );
}
