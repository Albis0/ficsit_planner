import meta from '../data/meta.json';
import { useStore } from '../store';
import type { Feedback, FeedbackMeta } from './feedback-schema';

export { type Feedback, type FeedbackKind, LIMITS } from './feedback-schema';

export const GITHUB_ISSUES = 'https://github.com/Albis0/ficsit_planner/issues';

/** Where an unsent report waits between visits, contact details included. */
export const DRAFT_KEY = 'ficsit-feedback-draft';

/** Where the report came from, so a bug can be reproduced. Shown in full under "What gets sent". */
export function feedbackMeta(): FeedbackMeta {
  const s = useStore.getState();
  return {
    app: __APP_VERSION__,
    data: `${meta.gameVersion} (${meta.changelist})`,
    mode: s.mode,
    tier: s.tier,
    screen: `${innerWidth}×${innerHeight} @${devicePixelRatio}x`,
    agent: navigator.userAgent,
    lang: navigator.language,
    installed: matchMedia('(display-mode: standalone)').matches,
  };
}

export type SendResult = { ok: true; id: number } | { ok: false; reason: 'offline' | 'rate' | 'busy' | 'failed' };

/** Posts to the site's own endpoint; nothing goes anywhere else. */
export async function sendFeedback(f: Feedback): Promise<SendResult> {
  if (!navigator.onLine) return { ok: false, reason: 'offline' };
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 15000);
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}api/report`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(f),
      signal: abort.signal,
    });
    const body = (await res.json().catch(() => ({}))) as { id?: number; error?: string };
    // 'rate' is this sender's hourly limit; 'busy' is everyone's daily one, nothing the sender did.
    if (res.status === 429) return { ok: false, reason: body.error === 'busy' ? 'busy' : 'rate' };
    return res.ok && typeof body.id === 'number' ? { ok: true, id: body.id } : { ok: false, reason: 'failed' };
  } catch {
    return { ok: false, reason: navigator.onLine ? 'failed' : 'offline' };
  } finally {
    clearTimeout(timer);
  }
}

/** The same report as a new GitHub issue, for when the endpoint can't be reached. */
export function githubIssueUrl(f: Feedback): string {
  const footer = `\n\n---\nApp ${f.meta.app}, game data ${f.meta.data}, ${f.meta.mode} planner, tier ${f.meta.tier}, ${f.meta.screen}\n${f.meta.agent}`;
  let text = [f.body, f.steps && `\n**Steps**\n${f.steps}`, f.area && `\n**Area:** ${f.area}`].filter(Boolean).join('\n');
  const url = (body: string) =>
    `${GITHUB_ISSUES}/new?${new URLSearchParams({
      title: `${f.kind === 'bug' ? '[Bug]' : '[Idea]'} ${f.title}`,
      body: body + footer,
      labels: f.kind === 'bug' ? 'bug' : 'enhancement',
    })}`;
  // GitHub turns away links much past 8 KB. Encoded text can be several times longer than typed, so shorten until it fits.
  while (url(text).length > MAX_URL && text.length > 1) text = `${text.slice(0, Math.floor(text.length * 0.8))}…`;
  return url(text);
}

const MAX_URL = 7000;
