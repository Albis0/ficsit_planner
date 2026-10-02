import { data } from '../../lib/data';
import { PURITIES } from '../../lib/extraction';
import { useT } from '../../lib/i18n';
import { LOGISTICS, SINK, STORAGE_NAME } from '../../lib/model/catalog';
import { linkMedium, transportOf } from '../../lib/model/calc/compile';
import type { CalcResult } from '../../lib/model/calc/result';
import { removeLinks, removeNodes, updateLink, updateNode } from '../../lib/model/ops';
import { extractorById, extractorRate, portsOf, runnerRecipe } from '../../lib/model/ports';
import type { MLink, MNode } from '../../lib/model/types';
import { amplification, describeUse } from '../../lib/solver';
import { minerLabel, recipeLabel } from '../../lib/text';
import { useStore } from '../../store';
import { Icon } from '../Icon';
import { RateInput } from '../RateInput';
import { linkKey, type ModelHost } from './ModelEditor';
import { useStatusText } from './PartNode';

const MAX_CLOCK = 2.5;

/** The panel for whatever is picked on a hand-built floor: a machine, a miner, an input or output, a belt. */
export function ModelInspector({ host, calc }: { host: ModelHost; calc?: CalcResult }) {
  const inspect = useStore((s) => s.inspect);
  if (!inspect) return null;
  if (inspect.startsWith('link:')) {
    const link = host.model.links.find((l) => linkKey(l.id) === inspect);
    return link ? <LinkPanel host={host} link={link} calc={calc} /> : null;
  }
  const node = host.model.nodes.find((n) => n.id === inspect);
  return node ? <NodePanel host={host} node={node} calc={calc} /> : null;
}

function Head({ icon, title, sub }: { icon: string; title: string; sub?: string }) {
  const { t } = useT();
  const set = useStore((s) => s.set);
  return (
    <header className="inspector-head">
      <Icon id={icon} size={48} />
      <div className="inspector-title">
        <span className="inspector-machine">{title}</span>
        {sub && <span className="inspector-recipe">{sub}</span>}
      </div>
      <button type="button" className="icon-button" aria-label={t('close')} onClick={() => set({ inspect: undefined })}>
        ×
      </button>
    </header>
  );
}

/** Count and clock, as typed: fractions allowed for the count ("8/3"), clock in percent. */
function CountClock({ host, node }: { host: ModelHost; node: MNode & { n?: number; clock?: number } }) {
  const { t } = useT();
  const n = node.n ?? 1;
  const clock = node.clock ?? 1;
  const change = (patch: Record<string, unknown>, key: string) => host.edit((m) => updateNode(m, node.id, patch), `${node.id}:${key}`);
  return (
    <>
      <div className="inspector-row">
        <span className="inspector-label">{t('machines')}</span>
        <div className="stepper">
          <button
            type="button"
            aria-label={t('fewerMachines')}
            disabled={n <= 1}
            onClick={() => change({ n: Math.max(1, Math.ceil(n) - 1) }, 'n')}
          >
            −
          </button>
          <RateInput
            value={Math.round(n * 10000) / 10000}
            label={t('machines')}
            onChange={(v) => v > 0 && change({ n: v === 1 ? undefined : v }, 'n')}
          />
          <button type="button" aria-label={t('moreMachines')} onClick={() => change({ n: Math.floor(n) + 1 }, 'n')}>
            +
          </button>
        </div>
        <p className="hint">{t('countHint')}</p>
      </div>
      <div className="inspector-row">
        <label className="inspector-label" htmlFor="mclock">
          {t('clockSpeed')}
        </label>
        <div className="clock-control">
          <input
            id="mclock"
            type="range"
            min={1}
            max={MAX_CLOCK * 100}
            step={1}
            value={Math.round(clock * 100)}
            onChange={(e) => change({ clock: Number(e.target.value) / 100 === 1 ? undefined : Number(e.target.value) / 100 }, 'clock')}
            style={{ ['--fill' as string]: `${((clock * 100 - 1) / (MAX_CLOCK * 100 - 1)) * 100}%` }}
          />
          <RateInput
            value={Math.round(clock * 10000) / 100}
            label={t('clockSpeed')}
            max={MAX_CLOCK * 100}
            onChange={(v) => v >= 1 && change({ clock: v === 100 ? undefined : v / 100 }, 'clock')}
          />
          <span className="unit">%</span>
        </div>
      </div>
    </>
  );
}

/** Each end: what goes through it now, and what it would at full speed. */
function Flows({ node, calc }: { node: MNode; calc?: CalcResult }) {
  const { t, name, num } = useT();
  const c = calc?.nodes[node.id];
  const ports = portsOf(node);
  const r = node.k === 'machine' || node.k === 'gen' || node.k === 'extract' ? runnerRecipe(node) : undefined;
  const units = (node.k === 'machine' || node.k === 'gen' || node.k === 'extract' ? (node.n ?? 1) * (node.clock ?? 1) : 0) || 0;
  const amp = r && node.k === 'machine' ? amplification(r, { clock: node.clock ?? 1, sloops: node.sloops ?? 0 }) : 1;
  const row = (side: 'in' | 'out', i: number) => {
    const p = side === 'in' ? ports.ins[i] : ports.outs[i];
    const now = (side === 'in' ? c?.ins[i] : c?.outs[i]) ?? 0;
    const full = r ? (side === 'in' ? r.inputs[i].rate : r.outputs[i].rate * amp) * units : undefined;
    return (
      <div key={`${side}${i}`}>
        <dt>
          {p.item && <Icon id={p.item} size={18} />}{' '}
          {p.item ? name(data.items[p.item]) : side === 'in' ? t('inEnd', { n: i + 1 }) : t('outEnd', { n: i + 1 })}
        </dt>
        <dd>
          {num(now)}
          {full !== undefined && <small> / {num(full)}</small>}
          {t('perMin')}
        </dd>
      </div>
    );
  };
  if (!ports.ins.length && !ports.outs.length) return null;
  return (
    <dl className="inspector-stats">
      {ports.ins.length > 0 && <h3 className="inspector-label">{t('inputs')}</h3>}
      {ports.ins.map((_, i) => row('in', i))}
      {ports.outs.length > 0 && <h3 className="inspector-label">{t('outputs')}</h3>}
      {ports.outs.map((_, i) => row('out', i))}
    </dl>
  );
}

function Remove({ host, node }: { host: ModelHost; node: MNode }) {
  const { t } = useT();
  const set = useStore((s) => s.set);
  return (
    <div className="inspector-actions">
      <button
        type="button"
        className="text-button"
        onClick={() => host.edit((m) => updateNode(m, node.id, { done: node.done ? undefined : true }))}
        aria-pressed={!!node.done}
      >
        {node.done ? t('markNotBuilt') : t('markBuilt')}
      </button>
      <button
        type="button"
        className="text-button danger"
        onClick={() => {
          host.edit((m) => removeNodes(m, [node.id]));
          set({ inspect: undefined });
        }}
      >
        {t('removeNode')}
      </button>
    </div>
  );
}

function NodePanel({ host, node, calc }: { host: ModelHost; node: MNode; calc?: CalcResult }) {
  const { t, name, num } = useT();
  const tier = useStore((s) => s.tier);
  const statusText = useStatusText();
  const c = calc?.nodes[node.id];
  const status = c && (node.k === 'machine' || node.k === 'gen' || node.k === 'extract') ? statusText(c.status, c.u) : undefined;
  const change = (patch: Record<string, unknown>, key?: string) =>
    host.edit((m) => updateNode(m, node.id, patch), key && `${node.id}:${key}`);

  let head: { icon: string; title: string; sub?: string };
  let body: React.ReactNode = null;
  if (node.k === 'machine' || node.k === 'gen') {
    const r = runnerRecipe(node);
    head = {
      icon: r?.machine ?? '',
      title: name(data.machines[r?.machine ?? ''] ?? { name: r?.machine ?? '' }),
      sub: r ? recipeLabel(name(r), r.kind) : '',
    };
    const slots = node.k === 'machine' && r ? (data.machines[r.machine]?.somersloopSlots ?? 0) : 0;
    const use = r
      ? describeUse(r, { clock: node.clock ?? 1, sloops: node.k === 'machine' ? (node.sloops ?? 0) : 0 }, node.n ?? 1)
      : undefined;
    body = (
      <>
        <CountClock host={host} node={node} />
        {slots > 0 && node.k === 'machine' && (
          <div className="inspector-row">
            <span className="inspector-label">{t('sloops')}</span>
            <div className="sloop-slots" role="radiogroup" aria-label={t('sloops')}>
              {Array.from({ length: slots + 1 }, (_, n) => n).map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={(node.sloops ?? 0) === n}
                  className={n > 0 && n <= (node.sloops ?? 0) ? 'filled' : undefined}
                  onClick={() => change({ sloops: n || undefined })}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        )}
        {use && (
          <dl className="inspector-stats">
            <div>
              <dt>{t('power')}</dt>
              <dd className="power">
                {num(use.power * (c?.u ?? 0))} <small>/ {num(use.power)}</small> MW
              </dd>
            </div>
          </dl>
        )}
      </>
    );
  } else if (node.k === 'extract') {
    const e = extractorById.get(node.extractor);
    head = { icon: node.extractor, title: e ? name(e) : node.extractor, sub: name(data.items[node.item]) };
    const options = data.extractors.filter(
      (x) => x.tier <= tier && (x.resources.length ? x.resources.includes(node.item) : data.items[node.item]?.form === 'solid'),
    );
    body = (
      <>
        {options.length > 1 && (
          <div className="inspector-row">
            <span className="inspector-label">{t('extractor')}</span>
            <div className="segmented" role="radiogroup">
              {options.map((x) => (
                <button
                  key={x.id}
                  type="button"
                  role="radio"
                  aria-checked={x.id === node.extractor}
                  onClick={() => change({ extractor: x.id })}
                >
                  {minerLabel(name(x))}
                </button>
              ))}
            </div>
          </div>
        )}
        {e?.purity && (
          <div className="inspector-row">
            <span className="inspector-label">{t('purity')}</span>
            <div className="segmented" role="radiogroup">
              {PURITIES.map((p) => (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={(node.purity ?? 'normal') === p}
                  onClick={() => change({ purity: p === 'normal' ? undefined : p })}
                >
                  {t(p)}
                </button>
              ))}
            </div>
          </div>
        )}
        <CountClock host={host} node={node} />
        {e && (
          <p className="hint">
            {t('extractEach', { n: num(extractorRate(e, node.purity) * (node.clock ?? 1)), item: name(data.items[node.item]) })}
          </p>
        )}
      </>
    );
  } else if (node.k === 'in' || node.k === 'out') {
    const it = node.item ? data.items[node.item] : undefined;
    head = { icon: node.item ?? '', title: it ? name(it) : t('anything'), sub: node.k === 'in' ? t('comesIn') : t('output') };
    body = (
      <div className="inspector-row">
        <span className="inspector-label">{node.k === 'in' ? t('limitIn') : t('limitOut')}</span>
        <RateInput
          value={node.lim ?? Number.NaN}
          label={node.k === 'in' ? t('limitIn') : t('limitOut')}
          placeholder={t('noLimit')}
          onChange={(v) => change({ lim: v }, 'lim')}
          onClear={() => change({ lim: undefined }, 'lim')}
        />
      </div>
    );
  } else if (node.k === 'logistic') head = { icon: LOGISTICS[node.kind].icon, title: LOGISTICS[node.kind].name };
  else if (node.k === 'sink') head = { icon: SINK.icon, title: SINK.name };
  else if (node.k === 'storage') head = { icon: 'Build_StorageContainerMk2_C', title: STORAGE_NAME };
  else if (node.k === 'unknown') {
    head = { icon: '', title: t('runUnknown'), sub: node.was };
    body = <p className="hint">{t('unknownHint')}</p>;
  } else head = { icon: '', title: '' };

  return (
    <aside className="inspector manual" aria-label={head.title}>
      <Head {...head} />
      {status && (
        <p className={`run-state big ${status.tone}`} role="status">
          {status.text}
        </p>
      )}
      {body}
      <Flows node={node} calc={calc} />
      <Remove host={host} node={node} />
    </aside>
  );
}

function LinkPanel({ host, link, calc }: { host: ModelHost; link: MLink; calc?: CalcResult }) {
  const { t, name, num } = useT();
  const set = useStore((s) => s.set);
  const tier = useStore((s) => s.tier);
  const a = host.model.nodes.find((n) => n.id === link.a);
  const b = host.model.nodes.find((n) => n.id === link.b);
  if (!a || !b) return null;
  const medium = linkMedium(portsOf(a), portsOf(b), link);
  const list = medium === 'pipe' ? data.pipes : data.belts;
  const transport = transportOf(medium, link.mk, tier);
  const c = calc?.links[link.id];
  const change = (patch: Partial<MLink>, key?: string) => host.edit((m) => updateLink(m, link.id, patch), key && `${link.id}:${key}`);
  const item = c?.items[0]?.[0];
  return (
    <aside className="inspector manual" aria-label={transport.name}>
      <Head
        icon={transport.id}
        title={t(medium === 'pipe' ? 'pipeName' : 'beltName', { mk: transport.name })}
        sub={item ? name(data.items[item]) : undefined}
      />
      <dl className="inspector-stats">
        <div>
          <dt>{t('carries')}</dt>
          <dd>
            {num(c?.rate ?? 0)}
            <small> / {num(c?.cap ?? transport.rate)}</small>
            {t('perMin')}
          </dd>
        </div>
        {c && c.items.length > 1 && (
          <div>
            <dt>{t('mixed')}</dt>
            <dd>{c.items.map(([i, r]) => `${num(r)} ${name(data.items[i])}`).join(', ')}</dd>
          </div>
        )}
      </dl>
      {c?.status === 'jam' && <p className="run-state big bad">{t('beltJam')}</p>}
      {c?.status === 'capped' && <p className="run-state big warn">{t('beltFull', { mk: transport.name })}</p>}
      <div className="inspector-row">
        <span className="inspector-label">{t(medium === 'pipe' ? 'pipeMk' : 'beltMk')}</span>
        <div className="segmented mk-pick" role="radiogroup">
          {list.map((x, i) => (
            <button
              key={x.id}
              type="button"
              role="radio"
              aria-checked={x.id === transport.id}
              disabled={x.tier > tier}
              title={`${num(x.rate)}${t('perMin')}`}
              onClick={() => change({ mk: i })}
            >
              {x.name}
            </button>
          ))}
        </div>
      </div>
      <div className="inspector-row">
        <span className="inspector-label">{t(medium === 'pipe' ? 'pipesSide' : 'beltsSide')}</span>
        <div className="stepper">
          <button
            type="button"
            aria-label={t('fewerLines')}
            disabled={(link.lanes ?? 1) <= 1}
            onClick={() => change({ lanes: (link.lanes ?? 1) - 1 > 1 ? (link.lanes ?? 1) - 1 : undefined })}
          >
            −
          </button>
          <b>{link.lanes ?? 1}</b>
          <button type="button" aria-label={t('moreLines')} onClick={() => change({ lanes: Math.min(99, (link.lanes ?? 1) + 1) })}>
            +
          </button>
        </div>
      </div>
      <div className="inspector-row">
        <span className="inspector-label">{t('limitBelt')}</span>
        <RateInput
          value={link.lim ?? Number.NaN}
          label={t('limitBelt')}
          placeholder={t('noLimit')}
          onChange={(v) => change({ lim: v }, 'lim')}
          onClear={() => change({ lim: undefined }, 'lim')}
        />
      </div>
      <div className="inspector-actions">
        <button
          type="button"
          className="text-button danger"
          onClick={() => {
            host.edit((m) => removeLinks(m, [link.id]));
            set({ inspect: undefined });
          }}
        >
          {t(medium === 'pipe' ? 'removePipe' : 'removeBelt')}
        </button>
      </div>
    </aside>
  );
}
