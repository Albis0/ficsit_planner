import { useState } from 'react';
import { useT } from '../lib/i18n';
import { POLL_NOTE } from '../lib/poll-schema';
import { actOnPoll, answerUpdate, useUpdateAnswered, usePollOffer } from '../lib/polls';

/** One to five, then the words they may want to add. Sent only when they press Send. */
function RatingForm({ onSend }: { onSend: (rating: number, note: string) => void }) {
  const { t } = useT();
  const [rating, setRating] = useState(0);
  const [note, setNote] = useState('');
  return (
    <div className="poll-form">
      <div className="poll-scale">
        <span className="poll-end">{t('pollPoor')}</span>
        <div className="poll-rating" role="radiogroup" aria-label={t('pollRate')}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" role="radio" aria-checked={rating === n} className="poll-pick" onClick={() => setRating(n)}>
              {n}
            </button>
          ))}
        </div>
        <span className="poll-end">{t('pollGreat')}</span>
      </div>
      {rating > 0 && (
        <>
          <textarea
            className="text-field"
            rows={2}
            maxLength={POLL_NOTE}
            placeholder={t('pollNote')}
            aria-label={t('pollNote')}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button type="button" className="primary-button poll-send" onClick={() => onSend(rating, note.trim())}>
            {t('pollSend')}
          </button>
        </>
      )}
    </div>
  );
}

/** The question that comes a couple of minutes after a part of the app was tried. */
export function PollCard() {
  const { t } = useT();
  const poll = usePollOffer();
  if (!poll) return null;
  return (
    <section className="toast poll" role="dialog" aria-label={poll.question} key={poll.id}>
      <header className="poll-head">
        <p className="poll-question">{poll.question}</p>
        <button type="button" className="poll-x" aria-label={t('pollClose')} onClick={() => actOnPoll('close')}>
          ×
        </button>
      </header>
      <RatingForm onSend={(rating, note) => actOnPoll('answer', rating, note)} />
      <footer className="poll-foot">
        <button type="button" className="text-button quiet" onClick={() => actOnPoll('later')}>
          {t('later')}
        </button>
        <button type="button" className="text-button quiet" onClick={() => actOnPoll('never')}>
          {t('pollNever')}
        </button>
      </footer>
    </section>
  );
}

/** A version's own question under Settings › Updates, answered once. */
export function UpdateAsk({ version, question }: { version: string; question: string }) {
  const { t } = useT();
  const answered = useUpdateAnswered(version);
  return (
    <div className="update-ask">
      <p className="poll-question">{question}</p>
      {answered ? (
        <p className="poll-thanks">{t('pollThanks')}</p>
      ) : (
        <RatingForm onSend={(rating, note) => answerUpdate(version, rating, note)} />
      )}
    </div>
  );
}
