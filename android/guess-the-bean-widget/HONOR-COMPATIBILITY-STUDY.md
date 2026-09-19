# Honor / MagicOS compatibility study — Guess the Bean widget

**Written:** 2026-09-19 · **Status:** **root cause found and fixed on the Magic V5 cover
screen (see "Resolution").** Sections 1–8 below are the original research/plan and the
hypotheses that led there; several (install source, size attrs, profile) turned out to be
wrong and are kept for the record.

## Resolution (2026-09-19)

**Root cause: Jetpack Glance's `Button` composable does not render in Honor MagicOS's
launcher.** Everything else in our widget does. The Honor launcher placed the widget at the
right size, showed Glance's loading spinner, then replaced the tile with its error view
("Cannot add widget." — Honor's wording of AOSP's "Problem loading widget") when it tried to
apply our RemoteViews. Samsung/Pixel hosts apply the same RemoteViews fine, which is why it
looked like a launcher policy problem.

**How it was found (no launcher logs available — Honor sets `persist.log.tag=S`):**
1. `adb screencap -d <cover display id>` while adding the widget showed the tile being
   allocated, spinning, then turning into the error view — i.e. failure at first render, not
   bind/placement/policy. (`dumpsys appwidget` had already shown a bound widget id with
   non-null views.)
2. A `probe` build type (`app/src/probe/`, installs as `…guessthebeanwidget.probe`, label
   "GtB PROBE") shipped seven tiny widgets, each adding one feature. Result on the Magic V5:
   plain text ✔, opaque bg + coloured text ✔, translucent bg ✔, whole-card `clickable` ✔,
   **Glance `Button` ✘**, Row + weighted Spacer ✔, plain non-Glance RemoteViews ✔.
3. Replaced `Button(...)` in `LatestGuessesWidget.kt` with `Box` + `Text` +
   `clickable(actionRunCallback<RefreshWidgetAction>())`. Re-tested on the phone cover
   screen: the full widget renders.

**Ruled out along the way:** install source (reinstalling with installer = Play changed
nothing), Private Space/second user, provider size attributes, bind permissions, Glance as
a whole. The earlier "Honor is out of scope / needs Smart Services registration" conclusion
was wrong; `honorcard` is still not needed and still must not be added.

**Verified by the user on the Magic V5 (2026-09-19):** unfolded inner screen (widget
persists, and works after remove + re-add) and a live session showing real data.
**Signed release verified (2026-09-19):** a fresh release APK (signed with the project key,
same certificate as the previous install, production Supabase) was installed in place on the
Magic V5; the widget was re-added from the real app and shows live data after Refresh. The
probe app was then uninstalled. The same signed release was also verified on a Nothing Phone (2)
(Android 16, Nothing Launcher): renders correctly with live data. **Still to verify:** the Honor tablet.

**Second fix, same day — tall Honor tiles.** With live data, Refresh was clipped at the bottom
(a 4×2 tile is ~177dp tall on Honor vs ~110dp on stock launchers). Sizing the content from
`LocalSize` (`SizeMode.Exact`) rendered fine but under-filled the card: **Honor reports the
tile as 132×408dp when it is really ~177×312dp**, so that data can't be trusted. Final
layout: footer row (Updated + Refresh) pinned to the bottom, body column with
`defaultWeight()` showing up to 3 names that clip instead of pushing Refresh out. Verified on
the phone with the probe app, then a fresh signed release.

**Reusable lesson:** when a widget "can't be added" on one OEM only, bisect the _content_
(one Glance feature per probe widget) before assuming launcher policy, and use
`screencap -d <displayId>` + `dumpsys appwidget` when logs are silenced.
**Requirement (user decision, 2026-09-19):** the widget must work on the user's primary
Honor phone (Magic V5) and Honor tablet. "Use another launcher" is a fallback, not an answer.

## 0. First evidence — Magic V5 over USB (2026-09-19)

Device: `MBH-N49`, **MagicOS 10.0.0.164, Android 16 (SDK 36)**, launcher
`com.hihonor.android.launcher`, cover screen 1060×2376 @480dpi (≈353dp wide), inner screen
2172×2352 (≈724dp wide). Two users: 0 (owner) and 100 (Parallel Space).

| Finding                                                                                                                                     | Meaning |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| App installed for user 0, not Parallel Space                                                                                                | **H6 ruled out** |
| `dumpsys appwidget`: our provider is registered, `zombie=false`, min 250×110dp, resizeMode 3, initialLayout resolved                        | Manifest/provider XML is read fine |
| After the failed adds, widget id **9648** exists: provider = ours, host = Honor launcher (hostId 1027), `views=` (RemoteViews) **non-null** | **Bind succeeded and our provider delivered a first RemoteViews.** The failure is _after_ bind, inside the launcher. Not a bind/permission/Glance-inflate failure |
| Installer of our app: `com.google.android.packageinstaller` (sideload). Installer of every other third-party widget app on the phone I checked (Gmail, Waktu, ProtonVPN, Luno, Edge): `com.android.vending` (Play) | **Correlation, not proof.** Nothing sideloaded exists on the phone to compare. H3 (install-source policy) is now the leading hypothesis |
| Third-party widgets with our exact size already place on this phone (Gmail 250×110dp resizeMode 3; Waktu 250×140dp)                         | Size/resize attributes alone are unlikely to be the cause (H1/H2 weaker) |
| `persist.log.tag = S`, `logd.final_release = 1`: Honor silences app/system logs; even `adb shell log -t X` is dropped                       | Plain `logcat` cannot show the launcher's error; see §4.1 |
| USB link re-enumerated mid-capture (transport id changed)                                                                                   | Try a different cable/port; a dead logcat stream cost the first capture |

**Cheapest next discriminators:** (1) reinstall the same APK with the installer recorded as
Play (`adb install -r -i com.android.vending <apk>`) — if placement then works, the launcher
keys on install source; (2) Play internal testing for the real fix; (3) sideload one other
widget app (e.g. an F-Droid one) to see whether _all_ sideloaded widgets fail.

## 1. What we actually know

| Fact                                                                                                   | Source                       | Confidence |
| ------------------------------------------------------------------------------------------------------ | ---------------------------- | ---------- |
| Same standard APK places fine on Samsung; Pixel emulator fine                                          | Handoff, manual test         | High       |
| Magic V5 default launcher lists the widget under Classic widgets, then says "cannot add widget"        | Handoff, manual test         | High       |
| Adding `com.hihonor.widget.type="honorcard"` removed the widget from the picker                        | Handoff, manual test         | High       |
| Honor documents `honorcard` as the marker for Smart Services (yoyo) cards; it can also swap `android.appwidget.provider` for `android.appwidget.honor.provider` so only Honor devices read the card info | Honor developer guide, via a search-result summary only — **I could not fetch developer.honor.com** (521 / empty) | Medium |
| Global Magic V5 has moved to MagicOS 10 (Android 16); it launched on MagicOS 9 (Android 15)            | GSMArena                     | Medium     |
| Huawei-lineage launchers have historically surfaced widget failures as `SecurityException`s when the launcher can't reach a widget-related component (e.g. a non-exported configure activity) | home-assistant/android#2064 (Huawei P9) | Medium — different device/era, but same launcher family |
| Honor's own launcher is `com.hihonor.android.launcher` and guards vendor content providers with vendor permissions | Kvaesitso#930                | Medium     |

**What I could not find:** any public Honor document, forum thread or issue that explains why
a valid plain AppWidget is listed but unplaceable on MagicOS. I searched Honor support,
developer.honor.com, XDA, GitHub and Stack Overflow-style sources. So this is not a
known-bug lookup — it is a **diagnosis problem**, and the plan below is built to isolate
the cause in as few install cycles as possible rather than guess.

Caveat on the old finding: "the widget works on Samsung, so the APK is fine" rules out a
_broken_ APK, but not a launcher that is stricter about something Samsung ignores. The
identical APK can still trip an Honor-only check.

## 2. Where "cannot add widget" can come from

Placing a widget is a chain; the toast can come from any link:

1. **Launcher-side pre-checks** — reads `AppWidgetProviderInfo` (size attrs, preview,
   category, features) and decides whether it fits the page/grid, or is allowed at all.
2. **Bind** — `AppWidgetManager.bindAppWidgetIdIfAllowed()` (system service, checks the
   provider is enabled/visible to the user/profile).
3. **Configure** — none for us (no `configure` activity), so this link is skipped.
4. **First render** — launcher inflates the `initialLayout`, then our first `RemoteViews`.
   An inflate failure shows as a broken/"Problem loading widget" tile _or_ a failed add.
5. **Vendor policy** — Honor-specific: source-of-install checks, security scan flags,
   second-space/private-space profile boundaries, service-card vs classic routing.

Our provider XML today (`res/xml/latest_guesses_widget_info.xml`): `initialLayout` =
Glance's default loading layout, `minWidth=250dp`, `minHeight=110dp`, `targetCell 4×2`,
`maxResize 360×220dp`, `resizeMode=horizontal|vertical`, `widgetCategory=home_screen`,
`description`. **Absent:** `minResizeWidth/Height`, `previewLayout`, `previewImage`,
`updatePeriodMillis`. Merged manifest: `targetSdk 37`, `minSdk 26`; WorkManager also injects
`RECEIVE_BOOT_COMPLETED`, `FOREGROUND_SERVICE`, `WAKE_LOCK`.

## 3. Ranked hypotheses

Ranked by (likelihood × cheapness of test). "Test" refers to §4.

| #   | Hypothesis                                                                                                                                             | Likelihood | Cheap test                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | ------------------------------------------------------------------ |
| H1  | **Provider-info attributes the Honor launcher dislikes** — missing `minResizeWidth/Height` and previews; or `minWidth 250dp` + `maxResize` combo mis-computed on the foldable's grid | Medium-high | Probe receivers A–D (§4.3)                                         |
| H2  | **Grid/space fit** — the widget doesn't fit the page/grid Honor computes (foldable inner screen, "large" home layout, cover screen), surfaced as a generic failure | Medium     | Try an empty page; try 2×2 / 4×1 variants; switch home layout     |
| H3  | **Vendor install-source / security policy** — Honor treats sideloaded or debug-signed apps differently for widgets (Samsung doesn't)                    | Medium     | Same probe APK via Play internal testing vs adb vs file manager; debug vs release signature |
| H4  | **Glance's `initialLayout` or first `RemoteViews` fails on Honor's launcher process** (plain RemoteViews works, Glance doesn't)                         | Medium-low | Probe D (Glance minimal) vs probe A (plain)                        |
| H5  | **Stale launcher state** — we installed variants with/without `honorcard`; Honor Home may hold a cached provider entry                                  | Medium     | Force-stop + clear Honor Home data, reboot, uninstall/reinstall    |
| H6  | **Wrong user profile** — app installed in Private Space / second user / app twin; widget can't cross the profile boundary                              | Low-medium | `pm list users`, `dumpsys package` user list                        |
| H7  | **`targetSdk 37` newer than the device** triggering an Honor compat path                                                                               | Low        | Rebuild probe with `targetSdk 35`                                   |
| H8  | **Honor-only allow-list / card registration** required for any third-party widget                                                                       | Low-medium | Control test: do _other_ third-party widgets place? (§4.2)         |

H8 matters because the whole plan forks on it: if other third-party widgets (e.g. from Play)
place fine on the same launcher, the cause is specific to _us_ and fixable; if they all fail
the same way, it's a device/launcher policy and we go to §5.

## 4. Debug plan (do in order — each step is cheap and each narrows the field)

### 4.1 Capture evidence first (decisive, ~10 min, no code)

Everything else is guesswork without the launcher's own error. `adb` is at
`%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe`.

On the Honor phone: Settings → About phone → tap Build number 7× → Developer options → USB
debugging **and** Wireless debugging (Android 11+; avoids a cable). Also enable "Install via
USB"/"USB debugging (security settings)" if present. Then, from the PC:

```bash
adb devices -l
adb logcat -c
adb logcat -v threadtime > honor-widget.log     # leave running, reproduce "cannot add widget", Ctrl+C
```

Search the log around the failed add for: `AppWidget`, `AppWidgetServiceImpl`,
`AppWidgetHostView`, `Launcher`, `hihonor`, `seduhscore`, `SecurityException`,
`InflateException`, `Error inflating`, `bind`. Also dump the system's view of the widget:

```bash
adb shell dumpsys appwidget > appwidget.txt      # is our provider registered? flags? "zombie"? hosts?
adb shell dumpsys package com.seduhscore.guessthebeanwidget > pkg.txt   # installer, targetSdk, receiver enabled/exported, installed-for-users
adb shell pm list users
adb shell pm query-receivers -a android.appwidget.action.APPWIDGET_UPDATE
```

If logcat is empty/filtered on the device: Honor is known (Huawei lineage) to gate logs.
Reports suggest dialling `*#*#2846579#*#*` → ProjectMenu → Log Setting → Log switch — **I
could not verify this on MagicOS 9/10**. Fallback: `adb bugreport honor-bug.zip`, which
includes the system log regardless.

Share `honor-widget.log`, `appwidget.txt`, `pkg.txt`. A single exception line usually names
the cause (H1/H3/H6/H8) outright.

### 4.2 Control widgets (5 min, no code)

On the same Honor launcher, try to place: (a) a widget from a Play Store app (Google Keep,
Google Calendar, Spotify), and (b) a **sideloaded** third-party widget (an F-Droid app such
as Simple Calendar Pro).

- (a) OK, (b) fails → install-source policy (H3). Fix = Play distribution.
- (a) and (b) OK → launcher accepts third-party widgets; the fault is ours (H1/H2/H4/H5/H6).
- Both fail → device policy/broken launcher state (H5/H8); try after clearing Honor Home.

### 4.3 Probe build — bisect in one install (needs code)

Build a `probe` variant of the widget app with **five receivers**, each with a distinct
label (`Probe A` … `Probe E`) so all appear in the picker; the user tries each and reports
which place. Each adds exactly one factor:

| Probe | Provider                         | Tests                                              |
| ----- | -------------------------------- | -------------------------------------------------- |
| A     | Plain `AppWidgetProvider` + a trivial hand-written `RemoteViews` layout; XML has only `initialLayout`, `minWidth`, `minHeight`, `updatePeriodMillis` | Baseline: can Honor place _any_ widget from this app/signature/install? (H3, H7, H8) |
| B     | A + `minResizeWidth/Height`, `resizeMode`, `widgetCategory` | H1, size attrs                                      |
| C     | B + `previewImage` + `previewLayout`, `targetCellWidth/Height` 2×2 | H1, preview/cell attrs                              |
| D     | Glance widget with the minimal XML from A                  | H4: Glance vs plain                                 |
| E     | Today's production XML + Glance (control — expected to fail) | Confirms we reproduce the failure                   |

Read the result as a decision table: A fails → not about our XML/Glance (go to H3/H6/H8 and
§4.1's log). A passes, B fails → `resize*` attrs. B passes, C fails → preview/cell attrs.
C passes, D fails → Glance. D passes, E fails → the specific attribute combo in production
XML (then bisect those attributes individually). Because the failing element is named by
which probe first breaks, this finds the cause in **one** install cycle instead of one per guess.

Run each probe from (i) adb install (debug), (ii) a release-signed APK via file manager,
and — if H3 is live — (iii) Play internal testing, to separate signature/source from content.

### 4.4 Hygiene before every Honor test

Clear the launcher's cache to rule out H5: Settings → Apps → Honor Home (system apps) →
Force stop → Storage → Clear cache (avoid "clear data" unless needed; it resets the home
layout). Uninstall old builds first. Reboot once after installing the very first probe.

## 5. What we can do to make it work (by cause)

1. **Content/attribute cause (H1/H2/H4)** — fix in the provider XML or layout, then
   re-run E. Likely edits: add `minResizeWidth/Height`, `previewLayout`+`previewImage`,
   drop or loosen `maxResize*`, provide smaller default cell size (e.g. 2×2 or 3×2),
   consider `SizeMode.Responsive` in Glance so the tablet/fold inner screen gets a layout
   that fits its cell sizes. Cheap, in-repo, fully ours.
2. **Install-source/signature cause (H3)** — distribute through Google Play internal testing
   (works for a small named tester group; no public listing needed). Honor global devices
   ship Play Services. Also release-sign consistently (the handoff's signed release APK).
3. **Profile/space cause (H6)** — install in the main user; document in the setup screen.
4. **Launcher-state cause (H5)** — clear Honor Home cache/reboot; document.
5. **Genuine Honor card-registration requirement (H8, worst case)** — the Honor Smart
   Services / `honorcard` path: developer.honor.com account, app + card registration and
   review. **Uncertain and heavy**: I could not confirm it is open to individual/global
   developers or how long approval takes. Only pursue if 1–4 are ruled out by evidence.
6. **Guaranteed fallbacks that don't depend on the launcher** (the "must work" safety net):
   - **Ongoing notification / Live-style notification** showing the latest guesses, updated
     by the same refresh worker — works on every launcher including Honor. Needs
     `POST_NOTIFICATIONS` (Android 13+). This is the most reliable substitute.
   - **Pinned home-screen shortcut** to the existing web display page
     (`/guess-the-bean/display/`) — no widget infrastructure involved.
   - **Compatible launcher** (Nova, Lawnchair, Smart Launcher, etc.). Note: only works on
     global Honor firmware; Chinese-market Honor/Huawei builds have blocked third-party
     launchers historically.
   Ship one of the first two regardless — they turn "must work on Honor" from a hope into a
   guarantee while the widget path is being resolved.

## 6. Refresh reliability on Honor (separate from placement)

Even once placed, Honor's aggressive process management (Huawei-lineage "PowerGenie") can
delay or kill WorkManager jobs. The 15-minute cadence is a floor already. To make it usable:
in the app's Settings → Battery → App launch, set to **Manage manually** with auto-launch,
secondary launch and run-in-background all on; exclude from battery optimisation. Keep the
widget's manual `Refresh` button and show "last updated" (already implemented). I could not
retrieve dontkillmyapp.com's Honor page (404), so treat these exact menu names as
approximate for MagicOS 9/10. Consider a setup-screen hint that deep-links to battery settings.

## 7. Device matrix (planned)

| Device                        | Launcher            | Expectation                                  | Status        |
| ----------------------------- | ------------------- | -------------------------------------------- | ------------- |
| Pixel 9 emulator              | Pixel launcher      | Works                                        | Verified      |
| Samsung physical              | One UI Home         | Works                                        | Verified      |
| Nothing phone                 | Nothing Launcher    | Expected to work (near-stock)                | Pending       |
| Honor Magic V5 (phone/fold)   | Honor Home          | **Fails today**                              | Debug (§4)    |
| Honor tablet                  | Honor Home          | Unknown; larger grid — test size attrs (H1/H2) | Pending       |

Real-device clouds (BrowserStack/Lambdatest etc.) sometimes carry Honor devices — worth
checking availability if a second Honor model is wanted. Unverified.

## 8. Recommended order of work

1. §4.1 evidence capture (user + PC, ~10 min) and §4.2 control widgets (~5 min).
2. Build the §4.3 probe variant (Claude, ~1 session) — install once, report which probes place.
3. Apply the fix the decision table names; re-verify on phone **and** tablet; update
   ROADMAP/CHANGELOG/`CLAUDE.md`, which currently say Honor is out of scope.
4. In parallel, add the notification/shortcut fallback (§5.6) so Honor is covered even if
   step 3 stalls.
5. Add unit tests (URL parsing, status mapping, count parsing) — already an open gap.

## Sources

- Honor developer Smart Services card guide (summary via search; original unreachable):
  <https://blog.csdn.net/honor_developer/article/details/126829344>
- Android widget layout/sizing guidance: <https://developer.android.com/develop/ui/views/appwidgets/layouts>
- Huawei launcher widget-add failure precedent: <https://github.com/home-assistant/android/issues/2064>
- Honor launcher vendor-permission precedent: <https://github.com/MM2-0/Kvaesitso/issues/930>
- Honor support, widgets missing from home screen: <https://www.honor.com/global/support/content/en-us00409513/>
- Magic V5 MagicOS 10 / Android 16: <https://m.gsmarena.com/global_honor_magic_v5_now_getting_magicos_10-news-70483.php>
