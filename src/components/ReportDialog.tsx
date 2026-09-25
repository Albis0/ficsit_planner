import { useEffect, useId, useState } from 'react';
import { useT } from '../lib/i18n';
import {
  DRAFT_KEY,
  type Feedback,
  type FeedbackKind,
  feedbackMeta,
  GITHUB_ISSUES,
  githubIssueUrl,
  LIMITS,
  sendFeedback,
} from '../lib/feedback';
import { currentPlan, useStore } from '../store';
import { Dialog } from './Dialog';
import { Glyph } from './Glyph';

/** `bugAttach` remembers the attach box for bugs, so a trip to Idea and back doesn't tick it again. */
type Draft = Omit<Feedback, 'plan' | 'meta' | 'website'> & { attach: boolean; bugAttach: boolean };

const blank = (kind: FeedbackKind): Draft => ({
  kind,
  title: '',
  body: '',
  steps: '',
  area: '',
  contact: '',
  attach: kind === 'bug',
  bugAttach: true,
});

/** The unsent report from last time, field by field: a damaged draft can't break the dialog. */
function loadDraft(): Draft {
  const d = blank('bug');
  try {
    const saved = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null');
    if (!saved || typeof saved !== 'object') return d;
    const kind: FeedbackKind = saved.kind === 'idea' ? 'idea' : 'bug';
    const text = (k: 'title' | 'body' | 'steps' | 'area' | 'contact') => (typeof saved[k] === 'string' ? saved[k] : '');
    const bugAttach = typeof saved.bugAttach === 'boolean' ? saved.bugAttach : true;
    return {
      kind,
      title: text('title'),
      body: text('body'),
      steps: text('steps'),
      area: text('area'),
      contact: text('contact'),
      attach: typeof saved.attach === 'boolean' ? saved.attach : kind === 'bug' && bugAttach,
      bugAttach,
    };
  } catch {}
  return d;
}

function saveDraft(d: Draft | undefined) {
  try {
    if (d) localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    else localStorage.removeItem(DRAFT_KEY);
  } catch {}
}

const AREAS = ['areaGraph', 'areaPower', 'areaRecipes', 'areaResources', 'areaLook', 'areaOther'] as const;

/** Feedback in two halves: something broke, or something could be better. Sent straight to the developer. */
export function ReportDialog({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  const [draft, setDraft] = useState<Draft>(loadDraft);
  const [state, setState] = useState<
    { step: 'edit' } | { step: 'sending' } | { step: 'sent'; id: number } | { step: 'failed'; why: string }
  >({
    step: 'edit',
  });
  const [honey, setHoney] = useState('');
  const [peek, setPeek] = useState(false);
  const ids = { title: useId(), body: useId(), steps: useId(), contact: useId() };

  useEffect(() => {
    if (state.step !== 'sent') saveDraft(draft);
  }, [draft, state.step]);

  const bug = draft.kind === 'bug';
  const put = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const valid = draft.title.trim().length >= LIMITS.titleMin && draft.body.trim().length >= LIMITS.bodyMin;

  const payload = (): Feedback => {
    const s = useStore.getState();
    return {
      kind: draft.kind,
      title: draft.title.trim(),
      body: draft.body.trim(),
      steps: bug ? draft.steps.trim() : '',
      area: bug ? '' : draft.area,
      contact: draft.contact.trim(),
      plan: draft.attach ? JSON.stringify(s.mode === 'power' ? { grid: s.grid } : { plan: currentPlan(s) }) : undefined,
      meta: feedbackMeta(),
      website: honey,
    };
  };

  const send = async () => {
    if (!valid || state.step === 'sending') return;
    setState({ step: 'sending' });
    const r = await sendFeedback(payload());
    if (r.ok) {
      saveDraft(undefined);
      setState({ step: 'sent', id: r.id });
    } else setState({ step: 'failed', why: r.reason });
  };

  if (state.step === 'sent') {
    return (
      <Dialog title={t('feedback')} icon="flag" className="report-dialog" onClose={onClose}>
        <div className="report-sent" role="status">
          <span className="sent-badge">
            <Glyph name="check" size={44} />
          </span>
          <h3 className="sent-title">{bug ? t('sentBug') : t('sentIdea')}</h3>
          <p className="hint">{t('sentHint', { id: state.id })}</p>
          <div className="report-actions">
            <button
              type="button"
              className="ghost-button"
              onClick={() => {
                setDraft(blank(draft.kind));
                setState({ step: 'edit' });
              }}
            >
              {t('sendAnother')}
            </button>
            <button type="button" className="primary-button" onClick={onClose}>
              {t('close')}
            </button>
          </div>
        </div>
      </Dialog>
    );
  }

  const sending = state.step === 'sending';
  return (
    <Dialog title={t('feedback')} icon="flag" className="report-dialog" onClose={onClose}>
      <form
        className="report-form"
        data-kind={draft.kind}
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <div className="report-kinds" role="radiogroup" aria-label={t('feedbackKind')}>
          {(['bug', 'idea'] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={draft.kind === k}
              className={`report-kind ${k}`}
              onClick={() => draft.kind !== k && put({ kind: k, attach: k === 'bug' && draft.bugAttach })}
            >
              <span className="report-kind-icon">
                <Glyph name={k === 'bug' ? 'bug' : 'bulb'} size={26} />
              </span>
              <span className="report-kind-text">
                <b>{k === 'bug' ? t('kindBug') : t('kindIdea')}</b>
                <small>{k === 'bug' ? t('kindBugHint') : t('kindIdeaHint')}</small>
              </span>
            </button>
          ))}
        </div>

        <label className="field-block" htmlFor={ids.title}>
          <span className="field-label">
            {bug ? t('bugTitle') : t('ideaTitle')}
            <span className="field-count">
              {draft.title.length}/{LIMITS.title}
            </span>
          </span>
          <input
            id={ids.title}
            className="text-field"
            maxLength={LIMITS.title}
            placeholder={bug ? t('bugTitlePh') : t('ideaTitlePh')}
            value={draft.title}
            onChange={(e) => put({ title: e.target.value })}
            required
          />
        </label>

        <label className="field-block" htmlFor={ids.body}>
          <span className="field-label">
            {bug ? t('bugBody') : t('ideaBody')}
            <span className="field-count">
              {draft.body.length}/{LIMITS.body}
            </span>
          </span>
          <textarea
            id={ids.body}
            className="text-field"
            rows={5}
            maxLength={LIMITS.body}
            placeholder={bug ? t('bugBodyPh') : t('ideaBodyPh')}
            value={draft.body}
            onChange={(e) => put({ body: e.target.value })}
            required
          />
        </label>

        {bug ? (
          <label className="field-block" htmlFor={ids.steps}>
            <span className="field-label">
              {t('bugSteps')} <em>{t('optional')}</em>
            </span>
            <textarea
              id={ids.steps}
              className="text-field"
              rows={3}
              maxLength={LIMITS.steps}
              placeholder={t('bugStepsPh')}
              value={draft.steps}
              onChange={(e) => put({ steps: e.target.value })}
            />
          </label>
        ) : (
          <div className="field-block">
            <span className="field-label">
              {t('ideaArea')} <em>{t('optional')}</em>
            </span>
            <div className="chips" role="radiogroup" aria-label={t('ideaArea')}>
              {AREAS.map((a) => (
                <button
                  key={a}
                  type="button"
                  role="radio"
                  aria-checked={draft.area === a}
                  className="chip-button"
                  onClick={() => put({ area: draft.area === a ? '' : a })}
                >
                  {t(a)}
                </button>
              ))}
            </div>
          </div>
        )}

        <label className="field-block" htmlFor={ids.contact}>
          <span className="field-label">
            {t('contact')} <em>{t('optional')}</em>
          </span>
          <input
            id={ids.contact}
            className="text-field"
            maxLength={LIMITS.contact}
            placeholder={t('contactPh')}
            value={draft.contact}
            onChange={(e) => put({ contact: e.target.value })}
          />
        </label>

        {/* Left empty by people; bots that fill every field get a quiet "thanks" and nothing is stored. */}
        <input
          className="honeypot"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden
          value={honey}
          onChange={(e) => setHoney(e.target.value)}
          name="website"
        />

        <label className="check-row">
          <input
            type="checkbox"
            checked={draft.attach}
            onChange={(e) => put({ attach: e.target.checked, ...(bug ? { bugAttach: e.target.checked } : {}) })}
          />
          <span>
            <b>{t('attachPlan')}</b>
            <small>{t('attachPlanHint')}</small>
          </span>
        </label>

        <details className="report-peek" open={peek} onToggle={(e) => setPeek(e.currentTarget.open)}>
          <summary>{t('whatIsSent')}</summary>
          {peek && (
            <pre>{JSON.stringify({ ...payload(), website: undefined, plan: draft.attach ? t('attachedPlan') : undefined }, null, 2)}</pre>
          )}
        </details>

        {state.step === 'failed' && (
          <div className="report-error" role="alert">
            <span>
              {state.why === 'rate'
                ? t('sendRate')
                : state.why === 'busy'
                  ? t('sendBusy')
                  : state.why === 'offline'
                    ? t('sendOffline')
                    : t('sendFailed')}
            </span>
            <a className="text-button" href={githubIssueUrl(payload())} target="_blank" rel="noreferrer">
              {t('openOnGithub')}
            </a>
          </div>
        )}

        <footer className="report-foot">
          <p className="report-privacy">
            {t('reportPrivacy')}{' '}
            <a href={GITHUB_ISSUES} target="_blank" rel="noreferrer">
              <Glyph name="github" size={14} /> GitHub
            </a>
          </p>
          <button type="submit" className={`primary-button send-button ${sending ? 'sending' : ''}`} disabled={!valid || sending}>
            <Glyph name="send" size={18} />
            {sending ? t('sending') : bug ? t('sendBug') : t('sendIdea')}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
