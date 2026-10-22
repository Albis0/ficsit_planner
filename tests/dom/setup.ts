import { GlobalRegistrator } from '@happy-dom/global-registrator';

// The browser the component tests run in. Only `bun run test:dom` loads this, in a process of its own: the other
// tests run without a window, as the solver and the save reader do.
GlobalRegistrator.register({ url: 'http://localhost/' });
