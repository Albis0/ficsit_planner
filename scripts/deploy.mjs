// Uploads the site to Cloudflare Pages.
//
//   bun run deploy:preview   the preview address, with its own database; any local state is fine
//   bun run deploy           the live site, only from a clean, pushed commit whose CI run passed
//
// Both run the checks and tests first and stop at the first failure. The live site also asks to be told "evet" first
// (typed at the prompt, or --confirm evet when there is no terminal), so it is never deployed by accident.
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';

const preview = process.argv.includes('--preview');
const root = path.join(import.meta.dirname, '..');
const wrangler = path.join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const REPO = 'Albis0/ficsit_planner';

const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const stop = (why) => {
  console.error(`\nNot deployed: ${why}`);
  process.exit(1);
};
const run = (label, cmd, args) => {
  console.log(`\n> ${label}`);
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' && cmd === 'bun' });
  if (r.status !== 0) stop(`${label} failed.`);
};

/** The live site goes up only when told so: "evet" typed here, or --confirm evet where nothing can be typed. */
async function confirmLive() {
  const flag = process.argv.indexOf('--confirm');
  if (flag > -1) {
    if (process.argv[flag + 1] !== 'evet') stop('--confirm needs the word evet.');
    return;
  }
  if (!process.stdin.isTTY) stop('the live site needs a yes: run it in a terminal and type evet, or add --confirm evet.');
  process.stdout.write('\nThis puts the live site (ficsitplanner.app and ficsit-planner.pages.dev) on this version.\nType evet to go on: ');
  const answer = await new Promise((resolve) => {
    process.stdin.setEncoding('utf8');
    process.stdin.once('data', (d) => resolve(String(d).trim()));
  });
  process.stdin.pause();
  if (answer !== 'evet') stop('not confirmed.');
}

if (!preview) {
  await confirmLive();
  if (git('rev-parse', '--abbrev-ref', 'HEAD') !== 'main') stop('the live site is deployed from main only.');
  if (git('status', '--porcelain')) stop('there are uncommitted changes. Commit them (or try them with deploy:preview) first.');
  git('fetch', '--quiet', 'origin', 'main');
  const head = git('rev-parse', 'HEAD');
  if (head !== git('rev-parse', 'origin/main')) stop('this commit is not pushed to GitHub yet.');
  console.log(`> CI for ${head.slice(0, 7)}`);
  // A fresh push takes a minute to show up and a few more to finish: wait for it (up to 10 minutes) instead of refusing.
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let ci;
  for (let i = 0; i < 40; i++) {
    const res = await fetch(`https://api.github.com/repos/${REPO}/actions/runs?head_sha=${head}&per_page=5`);
    if (!res.ok)
      stop(`could not read CI status (HTTP ${res.status}${res.status === 403 ? ', GitHub rate limit: try again in an hour' : ''}).`);
    ci = ((await res.json()).workflow_runs ?? []).find((r) => r.name === 'CI');
    if (ci?.status === 'completed') break;
    console.log(`  CI ${ci ? ci.status.replace('_', ' ') : 'not started yet'}, waiting...`);
    await sleep(15000);
  }
  if (ci?.status !== 'completed') stop('CI did not finish in 10 minutes. Try again later.');
  if (ci.conclusion !== 'success') stop(`CI ${ci.conclusion} for this commit: ${ci.html_url}`);
  console.log('  passed');
}

run('checks', 'bun', ['run', 'check']);
run('tests', 'bun', ['test']);
run('build', 'bun', ['run', 'build']);
run(
  'database migrations',
  'node',
  preview
    ? [wrangler, 'd1', 'migrations', 'apply', 'ficsit-reports-preview', '--remote', '--env', 'preview']
    : [wrangler, 'd1', 'migrations', 'apply', 'ficsit-reports', '--remote'],
);
run('upload', 'node', [wrangler, 'pages', 'deploy', '--branch', preview ? 'preview' : 'main', ...(preview ? ['--commit-dirty=true'] : [])]);
console.log(
  preview
    ? '\nPreview: https://preview.ficsit-planner.pages.dev'
    : '\nLive: https://ficsitplanner.app (and https://ficsit-planner.pages.dev)',
);
