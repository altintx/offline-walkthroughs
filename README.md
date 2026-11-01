# StratTome

The circular map emblem replaces the “o” in the home-screen wordmark and serves as the configured app icon. The transparent PNG is `assets/strattome-map-icon.png`; its generation prompt is recorded alongside it. Reload to update the wordmark; rebuilding the APK updates the Android launcher icon.

Android-first Expo development-build app for importing and reading walkthroughs offline. Includes a locally bundled manual font, a purple molded-panel theme, system/manual color modes, SQLite library and progress, text/HTML imports, full-guide search, a constructed TOC, and local WebView pagination.

## Run

Node is pinned in `.tool-versions` for asdf; ordinary `node`, `npm` and `npx` commands resolve to Node 24 in this directory. Use JDK 17, Android Studio/SDK and an Android device with USB debugging. Expo Go does not contain the local controller module.

```sh
npm ci
npm test
npm run typecheck
npm run android
npm start
```

`npm run android` generates the native project and installs a development build. For cold launch without Metro, build a release APK (below). Android native files are generated and ignored; the controller module is checked in under `modules/controller`.

```sh
npx playwright install chromium
npm run test:reader
```

Browser checks exercise the actual reader HTML, character coverage, page boundaries, resize restoration and cross-file anchors. Set `CHROMIUM_EXECUTABLE_PATH` to use an existing compatible Chromium executable. Unit tests include native-file/SQLite adapters; they do not replace Android device testing.

## Reading and importing

The app keeps controls inside Android safe areas. Changes adding `react-native-safe-area-context` require rebuilding the development APK. After updating from the original text parser, reimport existing `.txt` guides to apply prose reflow. Text imports open the saved guide immediately and clear prior errors.

Paste HTTPS guide URLs or local `file://` / `content://` addresses, or use **Import local text / HTML**. Local content addresses work only when Android has granted access; if access is denied, select the file through the file picker or save it to Downloads. The picker copies the selection into app cache before reading.

Swipe horizontally or tap the outer 20% at the left/right edge to turn pages. Center taps leave the page in place; artwork buttons and images keep their own actions. Controller shoulders still turn pages. Pages move inside a fixed viewport clipped to the reading margins, using measured column spacing including fractional pixels; the native document does not scroll. Fixed-width diagrams stay within the page as clipped previews; tap them to open the full pan/zoom viewer. Ordinary indented FAQ paragraphs reflow to the reader width. Justified and boxed prose is also reflowed. Underlined location names become headings. Item-found and fusion callouts beside prose are moved into separate fixed-width blocks after the paragraph, retaining the original artwork without threading its border characters through sentences. Bracketed FAQ contents labels are resolved to the corresponding section banners, preserving author titles and hierarchy; the app does not invent numbered sections. The top bar shows section breadcrumbs and “Page X of Y”. Tap the breadcrumbs to open the table of contents, where the guide title is shown; the title is hidden while reading.

Reimporting identical content asks before replacing the existing guide and resetting reading progress. The library is the home screen. Long-press a guide card for Rename, Artwork, or Delete; deletion asks for confirmation. Renaming preserves the saved passage and cover. Rename and cover changes use metadata-only database updates, retaining the text and navigation indexes. Artwork selection allows one save at a time; local and online artwork share caching and cleanup code. The app reports success after a confirmed commit, and cleanup errors do not invalidate a saved cover. Import is shown inline only for an empty library; otherwise the Import button opens a separate import view. Messages dismiss on tap or after six seconds and do not resize the reader. Search runs when submitted, has a visible match count, and shows 25 result buttons initially with a Show more action. Typing does not rebuild the reader; result buttons respond while the keyboard is open. **Close search** in the reader or search panel clears the results and highlight while keeping the current passage.

Import an HTTPS URL or local text/HTML file. URL imports follow query pagination on the same static page; GameFAQs imports also follow section paths within the selected numeric FAQ id. Imports do not execute source JavaScript. Sites that need JavaScript, login, or challenge completion may be incomplete or blocked. Review missing pages/images before explicitly accepting an incomplete import. Cancel or retry from the library. Temporary imports live in cache; committed content and images live in the app's document directory.

Online artwork lookup is explicit and searches Wikipedia game images (including box art) and Wikimedia Commons. Requests identify the app, previews show complete images, and downloads preserve source/credit metadata. Select an optional cover during import, or open Artwork in the reader menu to replace it with Wikimedia or local artwork. Attribution is cached and available from that panel. Local HTML imports retain structure and show placeholders for images whose files are not included; URL imports download images.

The document format is version 1: ordered files, stable block IDs, source anchors, hierarchical TOC levels, attribution and private asset URIs. Progress stores file ID, block ID and UTF-16 text offset. Pages are derived from the current viewport and font size. SQLite contains library records, TOC entries, block text, settings and progress; the active guide is searched in memory with escaped literal, Unicode-aware, case-insensitive matching.

The reader uses a restrictive content-security policy and blocks navigation away from local content. Its generated HTML contains no remote assets or original scripts. Network calls belong to import and explicit artwork lookup/download operations. A development build additionally needs its development server; use a bundled release build for offline acceptance.

## Controller

- D-pad / left stick: move focus; A: activate; B: back.
- L1/R1: previous/next page; Start/Menu: open/close hamburger.
- Images and maps viewer: D-pad/stick pans, A/R1 zooms in, L1 zooms out, B closes.
- URL/search entry can use the phone keyboard.

Input is intercepted by the Android window callback without moving text focus. The module detaches on background and reattaches on resume, including when returning from Lemuroid. Physical-device acceptance is still required.

## Signed local APK

Create a keystore outside the repository. Supply these environment variables from your local secret manager:
`ANDROID_KEYSTORE_PATH`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.

```sh
npx expo prebuild --platform android --no-install
node scripts/configure-signing.cjs
cd android
./gradlew assembleRelease
```

Output: `android/app/build/outputs/apk/release/app-release.apk`. Do not commit keystores or credentials. `eas.json` also describes development and release APK profiles; EAS project/account setup is separate.

The manually triggered GitHub release workflow builds a supplied existing tag, runs tests/type checks, signs the APK, uploads it as a workflow artifact, then publishes a GitHub Release. Configure repository secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. Running the workflow publishes externally; no workflow has been run from this workspace.

## Verification status

See [ACCEPTANCE.md](ACCEPTANCE.md) for passed automated checks and the remaining Android/device checks. No signed APK has been produced in this environment: it has no Java, Android SDK, device or signing credentials.

Font attribution/license is bundled in `assets/FONT-LICENSE.txt`. Implementation follows the [Expo module API](https://docs.expo.dev/modules/module-api/) and [Expo SDK 54 file API](https://docs.expo.dev/versions/v54.0.0/sdk/filesystem/).
