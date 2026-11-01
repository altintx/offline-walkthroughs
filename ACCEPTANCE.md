# Acceptance record

## Automated checks

Verified locally: 60 app/artwork/core/import/storage tests, 15 browser reader tests, strict TypeScript check, Android JavaScript export (including the bundled font), Android prebuild, and controller autolinking. Native APK compilation was not run.

- Core/document/import/storage suite: preservation of prose, lists, preformatted content and maps; stable anchors; generated TOC and nested sibling positions; original Unicode search offsets; repeated/cross-file/empty search and nonwrapping boundaries; color preference fallback/overrides.
- Imports: stage before save; selected-guide confinement; GameFAQs section links; missing page/image disclosure and acceptance; cancellation cleanup; downloaded image placement and local references.
- Storage: SQLite-backed persistence and progress; artwork update preserves position; failed transaction retains previous content and cleans up its replacement file.
- Browser reader suite: every text character lies on a reachable page; rotation restores passage; cross-file search anchors; local image placement and content security policy; no HTTP requests while reading/navigating/resizing.
- TypeScript strict check, Expo Android JavaScript export, native Android prebuild, Expo controller autolinking.

These checks do not establish that the Kotlin module compiles or that device interactions work.

## Import/reader regression follow-up

Artwork lookup, credits, downloads, local copying and cache cleanup now live in `src/artwork.ts`. Staged imports and existing-guide selections share the same cache helper and identity headers; the separate `File.downloadFileAsync` UI path has been removed. Selection uses a synchronous in-flight guard and one completion/error boundary. Cover updates and renames write metadata without rebuilding text/navigation indexes. SQLite writes are serialized; transaction errors are checked against the committed document URI before cleanup. Confirmed commits remain successful after cleanup errors, while unknown outcomes retain potentially referenced files and report uncertainty. Tests cover rapid taps, explicit retry, canceled pickers, rollback, post-commit finalization, unknown outcomes, preserved shared images and concurrent metadata/progress updates. The user’s exact intermittent finalization message remains unconfirmed on Android.

The library now opens as home, omits the tagline, and uses one guide card with long-press Rename / Artwork / Delete actions. Import is inline when empty and otherwise opens from a button into its own view. Rename persistence retains identity, cover, indexed text and progress; replacement imports retain the display title. Notices are dismissible overlays with six-second expiry. Reader page buttons have been removed in favor of swipes and outer-20% edge taps; touch-to-click suppression prevents duplicate turns, vertical drags do not navigate, and image/diagram buttons take priority. Controller shoulders remain supported.

Artwork requests identify the app and query Wikipedia game images plus Commons, with relevance ordering, image previews, source metadata, empty-input validation and partial-provider failure handling. A live lookup ranked The Legend of Zelda: The Minish Cap first and downloaded its PNG cover successfully (HTTP 200, 137749 bytes). Native Android artwork selection/caching and long-press/keyboard interaction still require device verification.

The page stride now comes from the rendered single-column width plus its gutter, including fractional CSS pixels. The reading viewport clips at the inner margins. A fractional-width regression checks the first 18 sword matches and page 71 for consistent column alignment and empty outer gutters. Close search clears the query, highlight, and result controls while restoring the current passage; its state transitions are covered by the app harness. This layout/search-only update requires a reload, not a rebuild or reimport.

The Climbing Mountains regression extracts underlined location names as display headings and moves left/right item-found and fusion callouts into separate fixed-width blocks. The parser uses each row’s actual borders, retains adjacent prose from both sides, and preserves the artwork for the full viewer. Tests cover the exact Minish Village / Bomb Bag passage and a right-side Kinstone Bag callout. Display-only location headings do not change the author’s main TOC hierarchy. Reimport text guides to apply this parser change.

Page turns now translate the book inside a fixed clipped viewport instead of scrolling the native document; the section/status area has a fixed height. Native commands carry monotonic IDs to reject duplicate delivery. A fresh-document browser test verifies every opening prose character across 35 consecutive page turns, including duplicate message events. The browser fixture setup now navigates to a fresh JavaScript context before loading a replacement reader.

Search executes on submission, memoizes results, and renders 25 matches initially with a Show more action. Typing no longer rebuilds reader HTML or renders 16,900 buttons for the fixture’s single-letter “s” query. App event-handler tests verify the actual “sword” submission shows 111 matches, the native result list stays bounded initially, and position reports do not regenerate HTML. The app hook harness does not emulate Android native views or React scheduling. These changes need a reload, not an APK rebuild or reimport.

The user-provided `fixtures/minishcapwalkthrough.txt` is now a regression fixture: 111 case-insensitive “sword” matches agree with the original text; all 11 main sections and 12 subsections resolve to named destinations. Tests compare source and parsed word occurrence counts (words containing lowercase letters), exclude inventory/location metadata from fixed-width previews, check every rendered non-space prose character against the full guide’s page bounds with the bundled font, and navigate early/middle/late search anchors. This still does not substitute for native Android WebView testing.

- Indented, justified and boxed FAQ prose now reflows, while diagrams and aligned tables remain fixed-width. A representative FAQ fixture resolves named Roman-numbered sections and nested bracketed labels. Generated “Section N” entries have been removed.
- Browser regressions cover wide diagram bounds, bubbling Android-style messages turning only once, swipe/button navigation, final-page alignment, and reachability of prose using the bundled font at a shorter viewport height.
- Successful text imports clear stale errors and immediately open the saved guide. Local URI input uses file reading, with generic file permission guidance for content URIs. The document picker explicitly copies selections to cache.
- Android controls use `react-native-safe-area-context`; rebuild the development APK, then reimport existing text guides to apply the new parser.
- Replacing a guide now requires confirmation and resets progress explicitly. Library deletion removes its content index, navigation and last-opened reference. Search trims the query, offers an explicit Search action, and keeps buttons tappable while the keyboard is open. List controls no longer use duplicate labels as React keys.
- Follow-up changes after the safe-area APK rebuild are JavaScript-only: reload and reimport text to apply the new parser.
- Still requires phone verification: Spark attachment grants and picker access, visible import confirmation, menu hit targets around status/navigation bars, and native WebView swipes/page buttons.

## Physical Android checks — pending

No Android SDK, Java runtime, connected device or signing credentials were available in the implementation environment.

1. Build/install the development APK. Pair a controller. Confirm D-pad and stick focus, A confirmation, B back, L1/R1 page turns and Start/Menu hamburger on a physical device.
2. Navigate a long library, every menu entry, nested TOC and search results using only the controller. Confirm offscreen focus scrolls into view. Use the phone keyboard for text entry.
3. Import a representative multi-section GameFAQs guide and a static HTML guide. Compare wording, lists, ASCII diagrams, tables, author navigation and image order against sources. Verify blocked-page reports, cancel, retry and incomplete-import acceptance.
4. Compare the end/start of every page through portrait/landscape and minimum/maximum type sizes. Check long headings, very large paragraphs, fixed blocks and oversized images. Confirm no missing/duplicated words and restored passage after layout changes.
5. Search repeated text across source files. Verify active highlights, counts, snippets, next/previous and first/last announcements. Confirm no wrap.
6. Open images/maps using the controller. Pan with D-pad/stick, zoom with shoulders/A, close with B. Verify touch scroll and zoom controls too.
7. Switch to Lemuroid and back. Confirm input and saved passage are restored; repeat after Android backgrounds/kills the reader.
8. Build a bundled release APK, import guides/artwork, enable airplane mode, force-stop and cold launch. Verify library, saved passage, search, images, attribution, typography and all color modes. Capture network traffic and confirm zero reader requests.
9. With automatic color mode, change Android's system preference. Verify manual Light/Dark persist across relaunch and override system settings.
10. Configure external signing secrets and run the release workflow on an intended release tag. Install the signed artifact and verify signature with `apksigner verify --print-certs`.

## Known limits

- Static extraction cannot recover content that requires scripts, authentication or source-site challenges. Generic guide crawling conservatively follows the same pathname; GameFAQs also follows paths under the selected FAQ id. Imports stop at 100 pages and disclose that limit.
- Local HTML images require review as missing content; remote URL imports download images. Unsupported document versions are rejected.
- Android WebView layout/controller behavior, airplane-mode cold launch and Lemuroid switching remain unverified until the physical checks above.
- The pinned Expo SDK dependency tree still reports transitive npm advisories after compatible patching. A forced audit fix proposes incompatible SDK changes; review the SDK/build-tool upgrade separately before distribution.
- The signed APK and a live GitHub Release have not been produced. The repository contains the build/sign/release workflow and instructions.
