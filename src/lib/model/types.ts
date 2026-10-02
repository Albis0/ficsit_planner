import type { Purity } from '../extraction';

/**
 * A factory built by hand: machines, extractors, splitters and the belts between them, where the player put them.
 * Nothing here knows about React or the store, so the same model can live in a factory tab or anywhere else.
 */
export const MODEL_VERSION = 1;

/**
 * How the numbers are worked out. 'full' follows the game: splitters share evenly, a full belt backs up, a machine
 * runs as fast as its inputs and outputs let it. 'basic' finds the most the machines can run within every limit.
 * 'sheet' runs every machine at its set clock and shows what's short or left over. 'off' shows no numbers.
 */
export type CalcMode = 'full' | 'basic' | 'sheet' | 'off';
export const CALC_MODES: CalcMode[] = ['full', 'basic', 'sheet', 'off'];

/** Conveyor and pipe attachments. */
export type LogisticKind = 'splitter' | 'merger' | 'smart' | 'prog' | 'prio' | 'junction';
export const LOGISTIC_KINDS: LogisticKind[] = ['splitter', 'merger', 'smart', 'prog', 'prio', 'junction'];

/** What a smart or programmable splitter output takes: some items, anything, anything no other output names, the overflow, or nothing. */
export type OutRule = { items: string[] } | { any: true } | { undef: true } | { over: true } | { none: true };

export type StorageMode = 'fill' | 'empty' | 'pass';

interface Base {
  id: string;
  /** Top left corner on the floor. */
  x: number;
  y: number;
  /** Ticked once it's built in the game. */
  done?: true;
  /** The player's own name for it. */
  label?: string;
}

export interface MachineNode extends Base {
  k: 'machine';
  recipe: string;
  /** Machines, fractions allowed (2.5 is two full and one at half). Default 1. */
  n?: number;
  /** 1 = 100%, up to 2.5. Default 1. */
  clock?: number;
  /** Somersloops in each machine. */
  sloops?: number;
}

export interface GenNode extends Base {
  k: 'gen';
  generator: string;
  fuel: string;
  n?: number;
  clock?: number;
}

export interface ExtractNode extends Base {
  k: 'extract';
  extractor: string;
  item: string;
  purity?: Purity;
  n?: number;
  clock?: number;
}

/** Comes in from outside the factory (a train, another factory), or leaves it. */
export interface IoNode extends Base {
  k: 'in' | 'out';
  /** Unset on an output: it takes anything. */
  item?: string;
  /** Most it brings in or takes, a minute; unset is no limit. */
  lim?: number;
  /** An output for what's left over, or an input for something nothing here makes. */
  tag?: 'spare' | 'bring';
}

export interface LogisticNode extends Base {
  k: 'logistic';
  kind: LogisticKind;
  /** Smart and programmable splitters: what each of the three outputs takes. */
  rules?: OutRule[];
  /** Pipeline junction: how many of its four ends come in (the rest go out). Default 1. */
  ins?: number;
}

export interface SinkNode extends Base {
  k: 'sink';
}

export interface StorageNode extends Base {
  k: 'storage';
  mode: StorageMode;
  /** What it gives out when emptying. */
  item?: string;
  lim?: number;
}

export interface NoteNode extends Base {
  k: 'note';
  text: string;
  w: number;
  h: number;
}

export interface GroupNode extends Base {
  k: 'group';
  w: number;
  h: number;
}

/** A node whose recipe or building left the game in an update: kept with its belts so nothing built by hand is lost. */
export interface UnknownNode extends Base {
  k: 'unknown';
  was: string;
  ins: number;
  outs: number;
}

export type MNode =
  | MachineNode
  | GenNode
  | ExtractNode
  | IoNode
  | LogisticNode
  | SinkNode
  | StorageNode
  | NoteNode
  | GroupNode
  | UnknownNode;

export type NodeKind = MNode['k'];

export type LineStyle = 'curve' | 'straight' | 'step';

/** A belt or pipe from output `ap` of node `a` to input `bp` of node `b`. What it carries comes from its ends. */
export interface MLink {
  id: string;
  a: string;
  ap: number;
  b: string;
  bp: number;
  /** Index into the game's belts or pipes; unset is the best one unlocked. */
  mk?: number;
  /**
   * Lines side by side, when one machine group's output needs more than one belt or pipe can carry (32 smelters
   * onto two Mk.6 belts). Default 1.
   */
  lanes?: number;
  /** Most it carries, a minute. */
  lim?: number;
  /** Bends, in floor coordinates. */
  pts?: [number, number][];
  line?: LineStyle;
}

export interface Model {
  v: typeof MODEL_VERSION;
  calc: CalcMode;
  nodes: MNode[];
  links: MLink[];
  /** Next id to hand out, so ids stay short. */
  seq: number;
  /** An output with nothing on it counts its output as left over instead of stopping the machine. */
  drain?: true;
}

export const emptyModel = (): Model => ({ v: MODEL_VERSION, calc: 'basic', nodes: [], links: [], seq: 1 });

/** Machines and extractors: what a node's count, clock and power belong to. */
export type Runner = MachineNode | GenNode | ExtractNode;
export const isRunner = (n: MNode): n is Runner => n.k === 'machine' || n.k === 'gen' || n.k === 'extract';

/** Everything but notes and boxes takes part in the numbers. */
export const isPart = (n: MNode) => n.k !== 'note' && n.k !== 'group';
