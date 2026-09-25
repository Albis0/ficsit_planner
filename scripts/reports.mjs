// Reads feedback sent from the app's report dialog (stored in the site's D1 database).
//
//   bun run reports              newest 30 that aren't done yet
//   bun run reports all          everything, newest first
//   bun run reports show 12      one report in full, with the plan it came with
//   bun run reports done 12      mark it handled (it stops showing in the default list)
//   bun run reports md           write the open ones to reports/feedback.md
//
// Add --local to read the database `wrangler pages dev` uses instead of the live one.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2).filter((a) => a !== '--local');
const where = process.argv.includes('--local') ? '--local' : '--remote';
const [cmd = 'list', arg] = args;

// The project's own wrangler, run by node directly so the SQL reaches it as one argument on every OS.
const wrangler = path.join(import.meta.dirname, '..', 'node_modules', 'wrangler', 'bin', 'wrangler.js');

function query(sql) {
  const out = execFileSync('node', [wrangler, 'd1', 'execute', 'ficsit-reports', where, '--json', '--command', sql], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    maxBuffer: 256 * 1024 * 1024,
  });
  return JSON.parse(out)[0]?.results ?? [];
}

const id = (x) => {
  const n = Number.parseInt(x, 10);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`Not a report number: ${x}`);
  return n;
};

// Report text comes from strangers. The endpoint already strips control characters; this strips them again
// before anything reaches the terminal, in case older rows or another writer let some through.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point.
const UNSAFE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g;
const clean = (s) => String(s ?? '').replace(UNSAFE, '');
/** One-line fields: a line break in a title or contact can't add fake rows or headings. */
const flat = (s) => clean(s).replace(/[\r\n\t]+/g, ' ');
/** For Markdown: no images or raw HTML that would load something when the file is previewed. */
const md = (s) => clean(s).replace(/!\[/g, '!\\[').replace(/</g, '&lt;');

const metaOf = (r) => {
  try {
    return JSON.parse(r.meta || '{}');
  } catch {
    return {};
  }
};

const line = (r) => {
  const meta = metaOf(r);
  const tag = r.kind === 'bug' ? 'BUG ' : 'IDEA';
  return flat(
    `#${String(r.id).padEnd(4)} ${tag} ${r.created.slice(0, 16).replace('T', ' ')}  ${r.title}  [${meta.mode || '?'}, v${meta.app || '?'}]${r.status === 'done' ? '  (done)' : ''}`,
  );
};

const full = (r, esc = clean) => {
  const meta = metaOf(r);
  const one = (s) => esc(s).replace(/[\r\n\t]+/g, ' ');
  return [
    `## #${r.id} ${r.kind === 'bug' ? 'Bug' : 'Idea'}: ${one(r.title)}`,
    '',
    `${r.created} · ${r.status}${r.area ? ` · ${one(r.area).replace(/^area/, '')}` : ''}${r.contact ? ` · contact: ${one(r.contact)}` : ''}`,
    '',
    esc(r.body),
    r.steps ? `\n**Steps**\n\n${esc(r.steps)}` : '',
    `\n_App ${one(meta.app) || '?'}, game data ${one(meta.data) || '?'}, ${one(meta.mode) || '?'} planner, tier ${one(meta.tier)}, ${one(meta.screen) || '?'}${meta.installed ? ', installed' : ''}_`,
    meta.agent ? `_${one(meta.agent)}_` : '',
  ].join('\n');
};

const COLUMNS = 'id, created, kind, status, title, body, steps, area, contact, meta';

if (cmd === 'list' || cmd === 'all') {
  const rows = query(
    `SELECT id, created, kind, status, title, meta FROM reports ${cmd === 'all' ? '' : "WHERE status != 'done'"} ORDER BY id DESC LIMIT ${cmd === 'all' ? 500 : 30}`,
  );
  console.log(rows.length ? rows.map(line).join('\n') : 'No reports.');
} else if (cmd === 'show') {
  const [r] = query(`SELECT ${COLUMNS}, plan FROM reports WHERE id = ${id(arg)}`);
  if (!r) throw new Error(`No report #${arg}`);
  console.log(full(r));
  if (r.plan) {
    let plan;
    try {
      plan = JSON.stringify(JSON.parse(r.plan), null, 1);
    } catch {
      plan = '(not valid JSON, not shown)';
    }
    console.log(`\nAttached plan:\n${clean(plan)}`);
  }
} else if (cmd === 'done') {
  query(`UPDATE reports SET status = 'done' WHERE id = ${id(arg)}`);
  console.log(`#${arg} marked done.`);
} else if (cmd === 'md') {
  const rows = query(`SELECT ${COLUMNS} FROM reports WHERE status != 'done' ORDER BY id DESC`);
  const file = path.join(import.meta.dirname, '..', 'reports', 'feedback.md');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `# Feedback (${rows.length} open)\n\n${rows.map((r) => full(r, md)).join('\n\n---\n\n')}\n`);
  console.log(`Wrote ${rows.length} reports to ${path.relative(process.cwd(), file)}`);
} else {
  console.log('Usage: bun run reports [list | all | show <n> | done <n> | md] [--local]');
}
