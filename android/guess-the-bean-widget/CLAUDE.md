# android/guess-the-bean-widget/ — Guess the Bean Android widget

Root non-negotiables apply where they translate (privacy model, `is_test` is N/A here).
This is a **native Kotlin / Jetpack Glance companion**, not a rewrite of the web app: it
shows the latest public activity of one Guess the Bean session on the Android home
screen and links through to the existing web display page
(`/guess-the-bean/display/`). It is outside `src/` entirely — no JS lint, no Prettier
(`.prettierignore` excludes `android/`), no shared code with the web build.

_Status (2026-09-19): feature-complete prototype. **Honor Magic V5 (MagicOS 10) works**
after the Glance `Button` fix below — cover screen, unfolded screen, a live session and a
fresh signed release build (with the tall-tile layout fix) verified on the Magic V5; Nothing Phone (2), Android 16, also verified (2026-09-19); Honor
tablet still to verify. Not yet distributed; no automated tests
beyond the Android Studio template stubs. Full diagnosis:
`HONOR-COMPATIBILITY-STUDY.md`._

## What it does

- 4×2 (resizeable) Glance widget; `OPEN` / `CLOSED` / `REVEALED` state labels.
- Setup screen accepts a participant **or** display URL, extracts + validates the UUID
  `session` query parameter, stores only that URL/UUID in app-private `SharedPreferences`.
- Reads via the production anonymous Supabase client (public REST + the
  `session_display_guesses` RPC). Exact total via the `Content-Range` count header.
- Manual `Refresh` action + network-constrained WorkManager periodic refresh.
- Card tap opens the stored display URL; the setup screen can disconnect and cancel work.

## Privacy model (hard rule)

Anonymous only. **Never** read `contacts` or `bean_count`; pre-reveal shows names only,
numeric guesses appear only post-reveal, through the same RPC the web display uses. No
service-role key, organiser token, or contact data belongs in this app. A creator-only /
authenticated widget would be a separate feature with a different security model — do not
weaken the anonymous display policy to get live pre-reveal numbers.

## Production configuration

The release build must use the **production** Supabase URL/anon key that
`https://seduhscore.com` ships. `app/build.gradle.kts` reads ignored `local.properties`
first:

```properties
supabase.url=https://<production-project>.supabase.co
supabase.anonKey=<production-anon-key>
```

and falls back to the repo root `.env` (`VITE_SUPABASE_*`), which is the **local dev**
stack. A release built without `local.properties` entries therefore silently bakes in the
local endpoint — check `local.properties` before building anything for distribution.
The anon key is a public client credential, but `local.properties` is still never
committed.

## Git hygiene

Track: source, resources, Gradle wrapper, `libs.versions.toml`. Keep untracked (this
directory's `.gitignore`): `local.properties`, `.gradle/`, `.kotlin/`, `.idea/`,
`build/`, `app/release/`, `*.apk`, `*.aab`, keystores. A built APK embeds BuildConfig and
goes stale after every source change — never commit one.

## Release checklist

1. Confirm `local.properties` points at production.
2. Rebuild + sign a **fresh** release APK after the final source change (Android Studio:
   Build → Generate App Bundles or APKs → Generate APKs → APK, release; output
   `app/release/app-release.apk`, git-ignored). Last done 2026-09-19 with the Honor fix.
3. `apksigner verify --verbose --print-certs <apk>`.
4. Install and test on the target phone **and its launcher** (emulator is not enough).

Distribution path (Play internal testing vs. managed signed release) is still undecided.

## KB notes

- **Refresh is not real-time.** WorkManager periodic work is deferrable; the requested
  15 minutes is a floor, not a guarantee. The manual `Refresh` action is the immediate path.
- **Glance:** declare a `GlanceAppWidgetReceiver` correctly with explicit size/cell
  metadata in `res/xml/latest_guesses_widget_info.xml`, and test placement on real
  launchers — the emulator hides launcher-specific rejection (below).
- **Never use Glance's `Button` — it fails to render in Honor MagicOS's launcher.** Symptom:
  the widget places at the right size, spins on Glance's loading layout, then becomes a
  "Cannot add widget." tile (Honor's error view for a RemoteViews that won't apply).
  Same APK is fine on Samsung/Pixel. Use `Box` + `Text` + `clickable(...)` instead (all
  verified on Honor). Translucent backgrounds, `clickable` on containers, Row and
  `defaultWeight` spacers are also verified fine. This was first misdiagnosed as a launcher
  policy/install-source problem; it was a content problem.
- **Do not size Glance content from `LocalSize` on Honor.** MagicOS reports a wrong, smaller
  tile size (132×408dp reported for a real ~177×312dp 4×2 tile), so a height budget built on it
  under-fills the card. Tile heights also differ per launcher (~110dp stock, ~177dp Honor). The
  card instead pins the footer (Updated + Refresh) at the bottom and gives the body
  `defaultWeight()`, so extra names clip rather than pushing Refresh out (max 3 names).
- **Diagnosing OEM-only widget failures:** Honor silences logcat (`persist.log.tag=S`), so
  use `dumpsys appwidget` (bound id + non-null `views=` means bind succeeded) and
  `adb exec-out screencap -d <displayId> -p` (foldables have two displays; find ids in
  `dumpsys SurfaceFlinger --display-id`) to watch the failure, then bisect content with the
  `probe` build type: `gradlew :app:assembleProbe` (installs as
  `com.seduhscore.guessthebeanwidget.probe`, label "GtB PROBE", seven one-feature widgets in
  `app/src/probe/`; never part of debug/release).
- **Do NOT add `com.hihonor.widget.type="honorcard"`.** It is Honor's Card / Smart
  Services discovery metadata, not a compatibility switch; on the Magic V5 it made the
  widget disappear from the picker entirely. Keep it out of the cross-OEM APK unless the
  project deliberately takes on Honor Smart Services registration/submission (a vendor
  platform project, not a manifest tweak).

## Known gaps

- No unit tests for URL parsing, status mapping, or API error/`Content-Range` parsing —
  add before calling this production-grade.
- Release build has `optimization` disabled (`build.gradle.kts`); revisit alongside
  distribution.
