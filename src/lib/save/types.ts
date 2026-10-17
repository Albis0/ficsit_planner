import type { SaveHeader } from './header';

export type { SaveHeader };

/** What a placed building is to the planner. */
export type BuildingKind =
  | 'machine'
  | 'extractor'
  /** Resource Well Pressurizer: stands on the well's core; its extractors stand on the satellites. */
  | 'pressurizer'
  | 'generator'
  | 'battery'
  | 'splitter'
  | 'merger'
  | 'smart'
  | 'prog'
  | 'prio'
  | 'junction'
  | 'storage'
  | 'sink'
  | 'pump'
  | 'pass'
  | 'belt'
  | 'lift'
  | 'pipe';

export type SaveBuilding = {
  /** Instance name, unique in the save (Build_SmelterMk1_C_2146390454). */
  id: string;
  /** Class, the same id the planner uses (Build_SmelterMk1_C). */
  cls: string;
  kind: BuildingKind;
  /** Where it stands in the world, cm, and which way it faces, degrees. */
  x: number;
  y: number;
  z: number;
  yaw: number;
  recipe?: string;
  /** Clock speed, 1 = 100%. */
  clock?: number;
  sloops?: number;
  shards?: number;
  producing?: boolean;
  /** Share of the last measured stretch it was producing, 0 to 1. */
  productivity?: number;
  /** Extractors: the node actor it stands on, and where that node is (cm). */
  node?: string;
  nodeAt?: [number, number, number];
  /** Generators: the fuel item it burns. */
  fuel?: string;
  /** Belts, lifts and pipes: length in metres. */
  length?: number;
};

/** One belt or pipe joint between two buildings' ports, written once. */
export type SaveLink = { a: string; ap: string; b: string; bp: string; pipe: boolean };

export type SaveCircuit = { id: number; members: string[] };

/** Somersloops or power shards: loose (inventories, storage), slotted into buildings, and uploaded to the Dimensional Depot. */
export type SaveCount = { free: number; inMachines: number; inDepot: number };

/** Everything the planner takes from a save, in the planner's own ids. Holds no player name or account. */
export type SaveData = {
  header: SaveHeader;
  /** Recipes the game has made available, standard and alternate. */
  recipes: string[];
  schematics: string[];
  /** Space Elevator phase (GP_Project_Assembly_Phase_1). */
  phase?: string;
  buildings: SaveBuilding[];
  links: SaveLink[];
  circuits: SaveCircuit[];
  sloops: SaveCount;
  shards: SaveCount;
  /** Instance names of the map pickups that are gone: Mercer Spheres, Somersloops, slugs, and drop pods whose hard drive was taken. */
  collected: string[];
  /** Buildings the planner has no card for (HUB, MAM, lights…), by class, with how many. */
  other: Record<string, number>;
  /** Where the HUB, the Space Elevator, the MAM, the AWESOME Shop and radar towers stand, cm. */
  landmarks: { cls: string; x: number; y: number }[];
  /** What this version could not read or does not know, with how often. */
  unknown: Record<string, number>;
  /** Objects in the save, read or not. */
  objects: number;
};
