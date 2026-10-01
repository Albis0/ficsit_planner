/**
 * Feedback as it travels from the report dialog to the site's own endpoint (functions/api/report.ts).
 * Both sides check it against these limits; the server's check is the one that counts.
 */
export type FeedbackKind = 'bug' | 'idea';

export interface FeedbackMeta {
  app: string;
  data: string;
  mode: string;
  tier: number;
  screen: string;
  agent: string;
  lang: string;
  installed: boolean;
}

export interface Feedback {
  kind: FeedbackKind;
  title: string;
  body: string;
  /** Bugs: how to make it happen. */
  steps: string;
  /** Ideas: which part of the planner it's about. */
  area: string;
  /** How to reach them, if they want an answer. */
  contact: string;
  /** The factory or power grid on screen, as JSON, when they chose to attach it. */
  plan?: string;
  meta: FeedbackMeta;
  /** Honeypot: people never see or fill it. */
  website?: string;
}

export const LIMITS = {
  titleMin: 4,
  title: 120,
  bodyMin: 10,
  body: 4000,
  steps: 2000,
  area: 40,
  contact: 200,
  plan: 60_000,
  meta: 600,
} as const;

/**
 * Control characters (bar newline and tab) and text-direction overrides are dropped, so a report can't
 * smuggle terminal escape codes into `bun run reports` or reorder what the reader sees.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point.
const UNSAFE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g;

/** Free text keeps its line breaks (as \n only); one-line fields lose them, so they can't fake extra rows or headings. */
const str = (x: unknown, max: number, lines = false) =>
  typeof x === 'string'
    ? x
        .replace(UNSAFE, '')
        .replace(/\r\n?/g, '\n')
        .replace(/[\n\t]+/g, (m) => (lines ? m : ' '))
        .trim()
        .slice(0, max)
    : '';

/** The attached plan, only if it's a JSON object within the size limit; anything else is dropped. */
function planOf(x: unknown): string | undefined {
  if (typeof x !== 'string' || !x || x.length > LIMITS.plan) return undefined;
  try {
    const v = JSON.parse(x);
    return v && typeof v === 'object' && !Array.isArray(v) ? JSON.stringify(v) : undefined;
  } catch {
    return undefined;
  }
}

/** Cleans what arrived; says what's wrong when it can't be used. */
export function checkFeedback(x: unknown): { ok: true; value: Feedback } | { ok: false; error: string } {
  if (!x || typeof x !== 'object') return { ok: false, error: 'not an object' };
  const f = x as Record<string, unknown>;
  if (f.kind !== 'bug' && f.kind !== 'idea') return { ok: false, error: 'kind' };
  const title = str(f.title, LIMITS.title);
  const body = str(f.body, LIMITS.body, true);
  if (title.length < LIMITS.titleMin) return { ok: false, error: 'title' };
  if (body.length < LIMITS.bodyMin) return { ok: false, error: 'body' };
  if (typeof f.plan === 'string' && f.plan.length > LIMITS.plan) return { ok: false, error: 'plan' };
  const m = (f.meta && typeof f.meta === 'object' ? f.meta : {}) as Record<string, unknown>;
  const meta: FeedbackMeta = {
    app: str(m.app, 20),
    data: str(m.data, 40),
    mode: str(m.mode, 10),
    tier: typeof m.tier === 'number' && Number.isFinite(m.tier) ? Math.round(m.tier) : -1,
    screen: str(m.screen, 40),
    agent: str(m.agent, 300),
    lang: str(m.lang, 20),
    installed: m.installed === true,
  };
  return {
    ok: true,
    value: {
      kind: f.kind,
      title,
      body,
      steps: str(f.steps, LIMITS.steps, true),
      area: str(f.area, LIMITS.area),
      contact: str(f.contact, LIMITS.contact),
      plan: planOf(f.plan),
      meta,
      website: str(f.website, 200),
    },
  };
}

/** Hours a sender is turned away after their nth strike: an hour, a day, a week, then a month. */
export const banHours = (strikes: number) => [1, 24, 168, 720][Math.min(Math.max(strikes, 1), 4) - 1];

/**
 * Text written to talk to whatever reads reports (an AI told to ignore its instructions and delete files)
 * or to wish harm on the maintainer. Real bug reports never read like this, so a match is a strike.
 */
const ABUSE = [
  /ignore\s+(all\s+)?(the\s+)?(above|previous|prior|earlier)\b/i,
  /disregard\s+(all\s+)?(the\s+)?(above|previous|prior)\b/i,
  /delete\s+(every|all)\s+(the\s+)?files?/i,
  /\b(this is|it'?s)\s+(me,?\s+)?your\s+(maintainer|developer|owner|creator)\b/i,
  /\b(system|developer)\s+prompt\b/i,
  /\bkill\s+your\s?self\b/i,
  /\bkys\b/i,
];

export function looksAbusive(f: Pick<Feedback, 'title' | 'body' | 'steps' | 'area' | 'contact'>): boolean {
  const text = [f.title, f.body, f.steps, f.area, f.contact].join('\n');
  return ABUSE.some((re) => re.test(text));
}
