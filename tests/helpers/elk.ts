import ELK from 'elkjs/lib/elk-api.js';
import type { Engine } from '../../src/lib/layout';
import { setLayoutEngine } from '../../src/lib/model/arrange';

/** The layout engine in workers of its own, as the app runs it; call the returned function to let the workers go. */
export function layoutEngine(): () => void {
  const list = [0, 1].map(() => new ELK({ workerFactory: () => new Worker(require.resolve('elkjs/lib/elk-worker.min.js')) as never }));
  let next = 0;
  setLayoutEngine((graph) => list[next++ % list.length].layout(graph));
  return () => {
    for (const e of list) e.terminateWorker();
  };
}

// Bun has a global `self` and no `document`, so ELK's bundled build takes it for a web worker and won't start here.
// ELK's own worker script runs fine in a Bun worker, the same way the app runs it in the browser.
const elk = new ELK({ workerFactory: () => new Worker(require.resolve('elkjs/lib/elk-worker.min.js')) as never });

/** ELK in a worker of its own, for laying out the Auto floor in tests. */
export const testEngine: Engine = (graph) => elk.layout(graph);
