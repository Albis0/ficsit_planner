import { useT } from '../lib/i18n';

/** What kind of factory a tab is, in front of its name: a small tag, grey for one worked out from its targets, orange for one built by hand. */
export function KindIcon({ manual }: { manual: boolean }) {
  const { t } = useT();
  return <span className={`kind-tag ${manual ? 'manual' : 'auto'}`}>{t(manual ? 'kindManual' : 'kindAuto')}</span>;
}
