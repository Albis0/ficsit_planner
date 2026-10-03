import ELK from 'elkjs/lib/elk.bundled.js';
import type { Engine } from './layout';

// ELK on this thread: for tests, and for the app when its layout workers won't start. Loaded only when needed,
// so the app's own bundle stays small.
const elk = new ELK();

export const mainThreadEngine: Engine = (graph) => elk.layout(graph);
