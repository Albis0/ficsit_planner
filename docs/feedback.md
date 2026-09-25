# Player feedback

The **Feedback** button in the top bar (in the ⋯ menu on phones) opens a window with two halves: **Report a bug**
and **Suggest an idea**. This page covers where those reports go and how to read them.

## What a report holds

| Field | Bug | Idea |
| --- | --- | --- |
| Title | "What went wrong, in a line" | "Your idea, in a line" |
| Body | What happened | Tell us more |
| Steps | Steps to make it happen (optional) | — |
| Area | — | Which part of the planner (optional) |
| Contact | How to reach them (optional) | same |
| Plan | The factory or power plant on screen, if they tick **Attach what I'm looking at** (on by default for bugs) | same, off by default |
| Meta | App version, game data version, which planner, tier, window size, browser, whether it's installed | same |

Players can open **What gets sent** to see the exact payload before sending. The text they type is kept in their
browser until the report goes through, so nothing is lost when they're offline.

## Where it goes

`functions/api/report.ts` is a Cloudflare Pages Function on the same site, at `POST /api/report`. It:

1. Accepts only POST with a JSON body, from the site itself (the `Origin` header must be the site's own; browsers
   always send it), up to about 140 KB. The body is counted as it streams in, so a bigger one is cut off without
   being read. Without the `REPORT_SALT` secret it turns everything away with 503 rather than keep weak hashes.
2. Checks every field against `src/lib/feedback-schema.ts`: a title of 4 to 120 characters, a body of 10 to 4000,
   and shorter limits on the rest. Control characters and text-direction overrides are removed, and one-line
   fields (title, area, contact, meta) lose their line breaks, so nothing typed can turn into terminal escape
   codes or fake rows and headings when you read it. An attached plan is kept only if it's a JSON object of at
   most 60 KB.
3. Quietly throws away anything that filled the hidden `website` field (bots do; people never see it), answering
   exactly like a stored report so the bot can't tell.
4. Allows six reports per clock hour per sender, twenty per clock hour per IPv6 site (/48), and 300 a day in
   total. A sender is a SHA-256 of the `REPORT_SALT` secret, the hour and the address (IPv6 cut to its /64, or its
   /48 for the site limit). The `hits` table holds only that hash, the hour and a count, no finer time, and rows
   from earlier hours are cleared by the next report. Reports never store the hash, so a report can't be lined up
   with an address or with the sender's other reports; the secret was generated on upload and never shown to
   anyone. Both slots, the daily total and the insert run in one D1 batch (one transaction), so a burst of
   parallel requests can't slip past, and a sender over their own limit doesn't use up their neighbours'.
5. Stores the report in the D1 database `ficsit-reports` (table `reports`, see `migrations/`) and answers with its
   number. When the daily total is reached the app says reports are paused for today and offers GitHub instead.

If the endpoint can't be reached, the window offers **Post on GitHub instead**, which opens a new issue on the
repository with the same text filled in.

## Reading reports

From the repo, logged in with `bunx wrangler login`:

```sh
bun run reports            # open reports, newest first
bun run reports all        # everything, including handled ones
bun run reports show 12    # one in full, with the plan that came with it
bun run reports done 12    # mark it handled
bun run reports md         # write the open ones to reports/feedback.md (not committed)
```

Add `--local` to use the local database that `bunx wrangler pages dev dist` writes to, for testing.

To load an attached plan: `show` prints it as JSON.

- A factory arrives as `{"plan": {…}}`. Save it as `{"kind":"ficsit-planner","version":1,"plans":[{…}]}`.
- A power plant arrives as `{"power": {…}}`. Save it as `{"kind":"ficsit-planner","version":2,"plans":[],"power":[{…}]}`.
  It's added as a new plant tab. Older reports carry `{"grid": {…}}`; save that as `"grid":{…}` instead of
  `"power"` and it becomes a plant.

Then load the file from **Settings → Your data → Load a copy**. Loaded files are checked field by field, so a
damaged or hostile plan can't break the app.

## Setup notes

- The database binding is `DB` in `wrangler.jsonc`. A new schema goes in a new file in `migrations/`, applied with
  `bun run db:migrate`.
- `REPORT_SALT` is a secret on the Pages project (`bunx wrangler pages secret put REPORT_SALT`), at least 16
  characters, set for both production and preview. Changing it resets the hourly limits, nothing else. For local
  testing put `REPORT_SALT=` and 16 or more characters in `.dev.vars` (git-ignored).
- `bun run deploy` applies any new migration to the live database before uploading the site.
- Local testing: `bun run build`, then `bunx wrangler d1 migrations apply ficsit-reports --local` once, then
  `bunx wrangler pages dev dist` and open <http://127.0.0.1:8788>.
