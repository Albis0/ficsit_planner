import type { CalcMode, MNode } from '../types';

/** Machines on a node: the count set, or for one sizing itself to what comes in, what the numbers say it takes. */
export const countOf = (n: MNode, calc?: NodeCalc): number =>
  n.k === 'machine' && n.auto ? (calc?.n ?? 0) : n.k === 'machine' || n.k === 'gen' || n.k === 'extract' ? (n.n ?? 1) : 0;

/**
 * Why a node runs below its limit, or doesn't run:
 * - full: at its limit
 * - partial: running, below its limit
 * - idle: nothing reaches it, or nothing takes what it makes
 * - deadlock: it waits on itself (a loop with nothing coming in from outside)
 * - noInput: an input end has no belt
 * - noOutput: an output end has no belt, so it fills up and stops
 * - jam: a belt brings it something it can't take
 * - unknown: its recipe or building is no longer in the game
 */
export type NodeStatus = 'full' | 'partial' | 'idle' | 'deadlock' | 'noInput' | 'noOutput' | 'jam' | 'unknown';

export interface NodeCalc {
  /** Share of its limit it runs at, 0 to 1 (machines, generators, extractors). */
  u: number;
  /** Per minute through each input and output end. */
  ins: number[];
  outs: number[];
  status: NodeStatus;
  /** Machines it takes, for a machine that sizes itself to what comes in. */
  n?: number;
  /** Its output left over where nothing is connected, when the model counts that instead of stopping. */
  spare?: number[];
}

/**
 * - capped: running at the belt's or pipe's most
 * - jam: carries something its far end can't take, so nothing moves
 * - unbounded: nothing limits it; a source, machine count or belt limit is needed somewhere
 */
export type LinkStatus = 'capped' | 'jam' | 'unbounded';

export interface LinkCalc {
  rate: number;
  /** What it carries and how much of each; one item on most belts. */
  items: [string, number][];
  /** Most it can carry: the belt or pipe, or the player's limit. */
  cap: number;
  status?: LinkStatus;
}

export interface CalcResult {
  mode: CalcMode;
  nodes: Record<string, NodeCalc>;
  links: Record<string, LinkCalc>;
  /** Somewhere nothing limits the flow. */
  unbounded?: boolean;
}

/** What the worker is asked to work out. */
export interface CalcInput {
  model: import('../types').Model;
  tier: number;
  game?: import('../../game').GameRules;
}
