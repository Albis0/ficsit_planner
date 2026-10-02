import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  ReactFlow,
  type Viewport,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/base.css';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useT } from '../../lib/i18n';
import type { CalcResult } from '../../lib/model/calc/result';
import { compile } from '../../lib/model/calc/compile';
import { canConnect, connect, moveNodes, removeLinks, removeNodes } from '../../lib/model/ops';
import { portsOf } from '../../lib/model/ports';
import { type Model, isPart } from '../../lib/model/types';
import { COARSE, useMediaQuery } from '../../lib/useMediaQuery';
import { useStore } from '../../store';
import { openingViewport } from '../GraphView';
import { type BeltData, BeltLink, PickLink } from './BeltLink';
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
}

const nodeTypes = { part: PartNode };
const edgeTypes = { belt: BeltLink };

/** Room kept along the floor's bottom edge for its buttons, so no card opens under them. */
const BAR = 76;
/** Room kept along the top for the toolbar. */
const TOP = 60;

/** Sizes cards are drawn at, for placing the camera before they're measured. */
const SIZE: Record<string, { width: number; height: number }> = {
  machine: { width: 310, height: 130 },
  gen: { width: 310, height: 130 },
  extract: { width: 330, height: 100 },
  in: { width: 330, height: 100 },
  out: { width: 330, height: 100 },
};
const FITTING = { width: 96, height: 96 };

/** Where the camera was on each model, so coming back from the list finds the floor as it was left. */
const cameras = new Map<string, Viewport>();

/** What the panel shows: a node by its id, or a belt as "link:<id>". */
export const linkKey = (id: string) => `link:${id}`;

const typing = (e: KeyboardEvent) =>
  !!(e.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable]') || !!document.querySelector('dialog[open]');

function Canvas({ host, calc }: { host: ModelHost; calc?: CalcResult }) {
  const { t } = useT();
  const tier = useStore((s) => s.tier);
  const inspect = useStore((s) => s.inspect);
  const set = useStore((s) => s.set);
  const gridLines = useStore((s) => s.settings.gridLines);
  const coarse = useMediaQuery(COARSE);
  const flow = useReactFlow();
  const { model } = host;

  // Cards as React Flow draws them. Kept here so a drag moves the card at once; the model hears of it when it's let go.
  const toNodes = useCallback(
    (m: Model, keep?: Node[]): Node[] => {
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
        data: { node: n, wired: wired.get(n.id)! } satisfies PartData,
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
        set({ inspect: undefined });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [host, removeSelected, set]);

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
          isValidConnection={isValid}
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
            const sized = nodes.map((n) => ({ ...n, ...(SIZE[(n.data as PartData).node.k] ?? FITTING) }));
            if (!box) return;
            // Below the toolbar along the top, above the buttons along the bottom.
            const v = openingViewport(sized, box.width, box.height - BAR - TOP, 'LR');
            f.setViewport({ ...v, y: v.y + TOP });
          }}
          onMoveEnd={(_, v) => cameras.set(host.key, v)}
          onNodeClick={(_, n) => {
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
          onPaneClick={() => {
            setPicked(new Set());
            set({ inspect: undefined });
          }}
          zoomOnDoubleClick={false}
        >
          {gridLines && <Background id="minor" variant={BackgroundVariant.Lines} gap={40} lineWidth={1} color="#2f2f2f" />}
          {gridLines && <Background id="major" variant={BackgroundVariant.Lines} gap={160} lineWidth={1} color="#3b3b3b" />}
          <div className="floor-controls">
            <button
              type="button"
              className="floor-button"
              title={t('fit')}
              onClick={() => flow.fitView({ padding: { top: '24px', left: '24px', right: '24px', bottom: `${BAR}px` }, duration: 250 })}
            >
              <span className="fit-icon" aria-hidden>
                ⤢
              </span>
              <span className="fit-label">{t('fit')}</span>
            </button>
          </div>
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
