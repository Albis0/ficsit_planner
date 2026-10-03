/// <reference lib="webworker" />

// Runs ELK off the main thread so laying out a big factory never freezes the floor. ELK's own worker script answers
// the messages elk-api's ELK sends: in a worker it finds `self` and no `document`, and listens on self.onmessage.
import 'elkjs/lib/elk-worker.min.js';
