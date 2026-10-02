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
  type Viewport,
  ReactFlowProvider,
  useReactFlow,
  useStore as useFlowStore,
  useStoreApi,
} from '@xyflow/react';
import '@xyflow/react/dist/base.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../../lib/i18n';
import type { CalcResult } from '../../lib/model/calc/result';
import { compile } from '../../lib/model/calc/compile';
import { openCards, openEnds } from '../../lib/model/checks';
import { type Choice, placeChoice, type Want, wantAt } from '../../lib/model/choices';
import { cardSize } from '../../lib/model/layout';
import { addNode, canConnect, connect, moveNodes, removeLinks, removeNodes } from '../../lib/model/ops';
import { portsOf } from '../../lib/model/ports';
import { type Model, isPart } from '../../lib/model/types';
import { COARSE, useMediaQuery } from '../../lib/useMediaQuery';
import { useStore } from '../../store';
import { openingViewport } from '../GraphView';
import { type BeltData, BeltLink, PickLink } from './BeltLink';
import { Chooser } from './Chooser';
import { CalcNodes, type PartData, PartNode } from './PartNode';

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
  /** Recipes this home has turned on: the chooser lists them first. */
  marked?: ReadonlySet<string>;
}

const nodeTypes = { part: PartNode };
const edgeTypes = { belt: BeltLink };

/** Room kept along the floor's bottom edge for its buttons, so no card opens under them. */
const BAR = 76;
/** Room kept along the top for the toolbar. */
const TOP = 60;

/** The chooser's size, for keeping it inside the floor. */
const CHOOSER = { w: 440, h: 520 };
/** Narrower than this, the chooser comes up from the bottom instead. */
const SHEET = 600;

/** Where the camera was on each model, so coming back from the list finds the floor as it was left. */
const cameras = new Map<string, Viewport>();

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

function Canvas({ host, calc }: { host: ModelHost; calc?: CalcResult }) {
  const { t } = useT();
  const tier = useStore((s) => s.tier);
  const inspect = useStore((s) => s.inspect);
  const set = useStore((s) => s.set);
  const gridLines = useStore((s) => s.settings.gridLines);
  const coarse = useMediaQuery(COARSE);
  const flow = useReactFlow();
  const flowStore = useStoreApi();
  const clickStart = useFlowStore(clickStartSelector);
  const { model } = host;
  const [choosing, setChoosing] = useState<Choosing>();

  // Cards as React Flow draws them. Kept here so a drag moves the card at once; the model hears of it when it's let go.
  const toNodes = useCallback(
    (m: Model, keep?: Node[]): Node[] => {
      const open = openEnds(m);
      const wired = new Map<string, { ins: boolean[]; outs: boolean[] }>();
      for (const n of m.nodes) {
        const p = portsOf(n);
        wired.set(n.id, { ins: p.ins.map(() => false), outs: p.outs.map(() => false) });
      }
      for (const l of m.links) {
        const a = wired.get(l.a);
        const b = wired.get(l.b);
        if (a && l.ap < a.outs.length) a.outs[l.ap] = true;
        if (b && l.bp < b.ins.length) b.ins[l.bp] = true;
      }
      const was = new Map(keep?.map((n) => [n.id, n]));
      return m.nodes.filter(isPart).map((n) => ({
        ...was.get(n.id),
        id: n.id,
        type: 'part',
        position: { x: n.x, y: n.y },
        data: { node: n, wired: wired.get(n.id)!, open: open.get(n.id) } satisfies PartData,
        selected: inspect === n.id || was.get(n.id)?.selected,
      }));
    },
    [inspect],
  );
  const [nodes, setNodes] = useState<Node[]>(() => toNodes(model));
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new model (or a new pick in the panel) redraws the cards.
  useEffect(() => setNodes((cur) => toNodes(model, cur)), [model, inspect]);

  const [picked, setPicked] = useState<Set<string>>(new Set());
  const net = useMemo(() => compile(model, tier), [model, tier]);
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
          transport: a.transport,
          calc: calc?.links[a.link.id],
        } satisfies BeltData,
      })),
    [net, calc, picked, inspect],
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) host.redo();
        else host.undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        host.redo();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        removeSelected();
      } else if (e.key === 'Escape') {
        setPicked(new Set());
        flowStore.setState({ connectionClickStartHandle: null });
        set({ inspect: undefined });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [host, removeSelected, set, flowStore]);

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
      host.edit((m) => {
        const { id: _, ...init } = placeChoice(m, c, flowAt, want);
        const added = addNode(m, init as Parameters<typeof addNode>[1]);
        made = added.id;
        if (!want || c.port === undefined) return added.model;
        return want.side === 'in'
          ? connect(added.model, want.node, want.port, added.id, c.port).model
          : connect(added.model, added.id, c.port, want.node, want.port).model;
      });
      setChoosing(undefined);
      setPicked(new Set());
      if (made) {
        set({ inspect: made });
        setReveal(made);
      }
    },
    [choosing, host, set],
  );

  // A card just put down that landed under the panel or off the floor's edge: the floor moves just enough to show it.
  const [reveal, setReveal] = useState<string>();
  useEffect(() => {
    if (!reveal) return;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
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
        const top = floor.top + TOP;
        const dx = card.right > right ? Math.max(right - card.right, left - card.left) : card.left < left ? left - card.left : 0;
        const dy = card.bottom > bottom ? Math.max(bottom - card.bottom, top - card.top) : card.top < top ? top - card.top : 0;
        if (!dx && !dy) return;
        const v = flow.getViewport();
        flow.setViewport({ ...v, x: v.x + dx, y: v.y + dy }, { duration: 250 });
      });
    });
    return () => cancelAnimationFrame(frame);
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

  const closeChooser = useCallback(() => setChoosing(undefined), []);
  const parts = model.nodes.filter(isPart).length;

  // Cards with an end that needs a belt; the button goes from one to the next.
  const open = useMemo(() => openCards(model), [model]);
  const openAt = useRef(0);
  const nextOpen = () => {
    const id = open[openAt.current++ % open.length];
    const n = model.nodes.find((x) => x.id === id);
    if (!n) return;
    const { w, h } = cardSize(n);
    flow.setCenter(n.x + w / 2, n.y + h / 2, { zoom: Math.max(flow.getZoom(), 0.8), duration: 300 });
    setPicked(new Set());
    set({ inspect: id });
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
          onDoubleClick={(e) => {
            // A double click on the empty floor puts something down there.
            if ((e.target as HTMLElement).classList.contains('react-flow__pane')) choose({ x: e.clientX, y: e.clientY });
          }}
          connectOnClick
          nodesDraggable
          elementsSelectable
          selectNodesOnDrag={false}
          deleteKeyCode={null}
          multiSelectionKeyCode={['Control', 'Meta']}
          selectionKeyCode="Shift"
          minZoom={0.1}
          maxZoom={2}
          snapToGrid
          snapGrid={[20, 20]}
          proOptions={{ hideAttribution: true }}
          defaultViewport={cameras.get(host.key)}
          onInit={(f) => {
            if (cameras.has(host.key) || model.nodes.length === 0) return;
            const box = document.querySelector('.floor-view')?.getBoundingClientRect();
            const sized = nodes.map((n) => {
              const { w, h } = cardSize((n.data as PartData).node);
              return { ...n, width: w, height: h };
            });
            if (!box) return;
            // Below the toolbar along the top, above the buttons along the bottom.
            const v = openingViewport(sized, box.width, box.height - BAR - TOP, 'LR');
            f.setViewport({ ...v, y: v.y + TOP });
          }}
          onMoveEnd={(_, v) => cameras.set(host.key, v)}
          onNodeClick={(e, n) => {
            // A tap on an end lays a belt; it doesn't open the card.
            if ((e.target as HTMLElement).closest('.react-flow__handle')) return;
            setPicked(new Set());
            set({ inspect: n.id });
          }}
          onNodeDoubleClick={(_, n) => {
            // A double click picks the belts on that card, not the cards at their other ends.
            setPicked(new Set(model.links.filter((l) => l.a === n.id || l.b === n.id).map((l) => l.id)));
            setNodes((cur) => cur.map((x) => (x.selected ? { ...x, selected: false } : x)));
            set({ inspect: undefined });
          }}
          onEdgeClick={(_, e) => pickLink(e.id)}
          onPaneClick={(e) => {
            // Half way through laying a belt by taps: the floor tapped is where the next card goes.
            const start = flowStore.getState().connectionClickStartHandle;
            if (start) {
              flowStore.setState({ connectionClickStartHandle: null });
              const port = Number(start.id?.slice(1));
              if (Number.isInteger(port)) {
                choose({ x: e.clientX, y: e.clientY }, wantAt(model, tier, start.nodeId, start.type === 'source' ? 'out' : 'in', port));
                return;
              }
            }
            setPicked(new Set());
            set({ inspect: undefined });
          }}
          zoomOnDoubleClick={false}
        >
          {gridLines && <Background id="minor" variant={BackgroundVariant.Lines} gap={40} lineWidth={1} color="#2f2f2f" />}
          {gridLines && <Background id="major" variant={BackgroundVariant.Lines} gap={160} lineWidth={1} color="#3b3b3b" />}
          {parts === 0 && !choosing && (
            <div className="floor-empty">
              <button type="button" className="primary-button" onClick={() => choose(undefined)}>
                {t('addFirst')}
              </button>
            </div>
          )}
          {clickStart && (
            <div className="connect-strip" role="status">
              <span>{clickStart.type === 'source' ? t('tapInput') : t('tapOutput')}</span>
              <button type="button" className="text-button" onClick={() => flowStore.setState({ connectionClickStartHandle: null })}>
                {t('cancel')}
              </button>
            </div>
          )}
          <div className="floor-controls">
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
              className="floor-button add-part"
              title={t('addPart')}
              aria-label={t('addPart')}
              onClick={() => choose(undefined)}
            >
              <span aria-hidden className="add-plus">
                +
              </span>
              <span className="fit-label">{t('add')}</span>
            </button>
            <button
              type="button"
              className="floor-button"
              title={t('fit')}
              onClick={() =>
                flow.fitView({ padding: { top: `${TOP}px`, left: '24px', right: '24px', bottom: `${BAR}px` }, maxZoom: 1, duration: 250 })
              }
            >
              <span className="fit-icon" aria-hidden>
                ⤢
              </span>
              <span className="fit-label">{t('fit')}</span>
            </button>
          </div>
          {choosing &&
            createPortal(
              <Chooser want={choosing.want} tier={tier} marked={host.marked} at={choosing.at} onPick={onPick} onClose={closeChooser} />,
              choosing.over,
            )}
        </ReactFlow>
      </PickLink.Provider>
    </CalcNodes.Provider>
  );
}

/** The hand-built floor: cards where the player put them, belts they laid, the numbers on both. */
export function ModelEditor({ host, calc }: { host: ModelHost; calc?: CalcResult }) {
  return (
    <ReactFlowProvider key={host.key}>
      <Canvas host={host} calc={calc} />
    </ReactFlowProvider>
  );
}
