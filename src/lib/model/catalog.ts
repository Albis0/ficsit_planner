import type { LogisticKind, StorageMode } from './types';

/**
 * The game's conveyor and pipe attachments, sinks and containers, which the game data doesn't list as production
 * buildings: their names and icons, as in the build menu.
 */
export const LOGISTICS: Record<LogisticKind, { name: string; icon: string }> = {
  splitter: { name: 'Conveyor Splitter', icon: 'Build_ConveyorAttachmentSplitter_C' },
  merger: { name: 'Conveyor Merger', icon: 'Build_ConveyorAttachmentMerger_C' },
  smart: { name: 'Smart Splitter', icon: 'Build_ConveyorAttachmentSplitterSmart_C' },
  prog: { name: 'Programmable Splitter', icon: 'Build_ConveyorAttachmentSplitterProgrammable_C' },
  prio: { name: 'Priority Merger', icon: 'Build_ConveyorAttachmentMergerPriority_C' },
  junction: { name: 'Pipeline Junction', icon: 'Build_PipelineJunction_Cross_C' },
};

export const SINK = { name: 'AWESOME Sink', icon: 'Build_ResourceSink_C' };

export const STORAGE: Record<StorageMode, { icon: string }> = {
  fill: { icon: 'Build_StorageContainerMk2_C' },
  empty: { icon: 'Build_StorageContainerMk2_C' },
  pass: { icon: 'Build_StorageContainerMk2_C' },
};

export const STORAGE_NAME = 'Storage Container';
