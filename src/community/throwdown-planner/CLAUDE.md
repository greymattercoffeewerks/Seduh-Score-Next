# src/community/throwdown-planner/ — Throwdown Bracket Planner (free Community tool)

A free Community tool at `/tools/throwdown-planner/` (card 06 on the hub): type how many brewers you expect and see how a
Throwdown knockout plays out (rounds, byes, who could rest twice, 3rd place, the Final, redemption). No account, no event, no
Supabase, no storage, nothing sent. Built 2026-11-28 after the owner found the in-event planner hard to find (CHANGELOG 4.35.0).

- **Files.** `throwdownPlannerScreen.js` (DOM, own `tp-` classes), `throwdownPlanner.css`, `main.js`; the page is
  `tools/throwdown-planner/index.html` (listed in `vite.config.js`, `public/sitemap.xml`, `communityTools.js`, the hub's icons).
  Frame: `toolChrome.js` like every tool (header sheets, then `toolChrome.css`, then this sheet).
- **The one exception to `src/tools/CLAUDE.md` ("a tool never imports from `src/formats/`").** The planner IS Throwdown's rules,
  and a copy would drift from the database. It imports exactly three pure modules: `formats/throwdown/bracketPreview.js` (the
  engine, held to the real bracket by `bracketPreview.test.js` and pgTAP `096`), `bracketPreviewCard.js` (only the word helpers
  `flagWords`, `summaryWords`, `diffWords`, `MAX_PREVIEW_ENTRANTS`; its card builder is not used) and `redemption.js` (the
  `MAX_CAP` and `MAX_FEED_ROUND` constants). `throwdownPlannerScreen.test.js` pins that list and that no Supabase, auth, router
  or data import appears. No Throwdown screen, CSS or class is used; the planner keeps its own.
- **Group size is fixed at 2** (the setup offers pairs only, owner 27 Nov); the sizes 3 and 4 exist in the engine but are not offered.
- **Not here:** saving, sharing a link, printing. Add only on the owner's say.
