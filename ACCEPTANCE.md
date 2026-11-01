# Acceptance record

## Automated checks

Verified locally: 24 core/import/storage tests, 5 browser reader tests, strict TypeScript check, Android JavaScript export (including the bundled font), Android prebuild, and controller autolinking. Native APK compilation was not run.

- Core/document/import/storage suite: preservation of prose, lists, preformatted content and maps; stable anchors; generated TOC and nested sibling positions; original Unicode search offsets; repeated/cross-file/empty search and nonwrapping boundaries; color preference fallback/overrides.
- Imports: stage before save; selected-guide confinement; GameFAQs section links; missing page/image disclosure and acceptance; cancellation cleanup; downloaded image placement and local references.
- Storage: SQLite-backed persistence and progress; artwork update preserves position; failed transaction retains previous content and cleans up its replacement file.
- Browser reader suite: every text character lies on a reachable page; rotation restores passage; cross-file search anchors; local image placement and content security policy; no HTTP requests while reading/navigating/resizing.
- TypeScript strict check, Expo Android JavaScript export, native Android prebuild, Expo controller autolinking.

These checks do not establish that the Kotlin module compiles or that device interactions work.

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
