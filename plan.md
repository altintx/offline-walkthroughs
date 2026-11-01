# Offline Walkthroughs

## Summary

Build an Android-first, offline walkthrough reader using React Native, TypeScript, and Expo development builds. Preserve imported wording and images while presenting guides as phone-sized, controller-navigable pages.

The first implementation action is to write this approved plan to `plan.md`. File creation and implementation remain pending while Plan Mode is active.

## Experience

- Start with a skeuomorphic, SNES-inspired theme: molded-plastic panels, subtly recessed controls, purple accents, tactile borders, and readable manual-style typography. Bundle visual assets and fonts locally.
- Separate visual themes from color mode. Follow the system light/dark preference initially; use dark when no system preference is available. Offer System, Light, and Dark settings.
- Provide a theme interface with light/dark palettes and shared typography, spacing, and surface tokens. Ship one visual theme initially.
- Resume the last guide at its saved passage. Support landscape and portrait, adjustable typography, and screen-sized page turns.
- Keep a visible, controller-focusable hamburger button in reading mode. Its menu contains **Back to Library**, **Search**, **Table of Contents**, and **Reading Settings**.
- Search the entire imported guide locally, across all its files. Use case-insensitive literal text matching, show result counts and snippets, and support next/previous occurrence directly in the reader. Highlight the active match, cross section boundaries automatically, and announce the first/last result without wrapping.
- Always construct a TOC. Combine source structure, author TOC links, and headings into a deduplicated navigation tree. For unstructured text, recognize section markers conservatively; otherwise provide source-file entries and generated numbered sections.
- Retain source-file and heading navigation views. Show breadcrumbs with sibling positions, including deeply nested headings such as “4 of 7.”

## Implementation

- Use SQLite for library metadata, navigation, search data, and progress; app-private files for guide content and artwork.
- Define a versioned guide document with ordered source files, stable content blocks, headings, TOC entries, source anchors, attribution, and local assets.
- Store reading position as file/block/text offset. Calculate pages from the current layout and restore the same passage after typography or orientation changes.
- Import on-device with a dedicated GameFAQs adapter and best-effort static HTML extraction. Follow only pages belonging to the selected guide.
- Reflow hard-wrapped prose while preserving wording, lists, ASCII art, maps, and aligned tables. Download images, remove source scripts and trackers, and rewrite references locally.
- Stage imports before committing. Support cancellation and retry; disclose missing content before accepting incomplete imports. Report blocked pages without challenge bypasses.
- Offer Wikimedia artwork selection during import, cache attribution, and allow local artwork replacement. Fall back to a styled title.
- Render sanitized local content in a WebView with bundled pagination code. Provide controller-accessible zoom/pan for images and oversized fixed-width blocks.
- Confine network access to explicit imports and artwork lookup. Reader, search, themes, and library browsing operate offline.
- Handle Android controller input through a local Kotlin Expo module. Map D-pad/stick to focus, A to confirm, B to back, shoulders to page turns, and Start/Menu to the hamburger menu. Search results expose focusable next/previous controls.
- Deliver local builds, then a signed APK and GitHub Releases workflow. Keep signing credentials outside the repository; defer store submissions and iOS.

## TDD and acceptance

- Write small behavioral tests before implementation, observe expected failures, and implement until they pass. Once written, tests remain unchanged. Stop and ask if a test forces incorrect behavior or poor design.
- Focus automated tests on content preservation, constructed TOC behavior, import integrity, stable reading anchors, full-guide search, and system/manual color-mode selection. Avoid cosmetic snapshots and implementation-mirroring tests.
- Validate pagination for missing/duplicated content and restoration after layout changes.
- Test search matches across files, repeated occurrences, next/previous boundaries, empty results, and navigation to the correct passage.
- Validate native controller input and pagination early on a physical Android device.
- Complete controller-only library/reader navigation, hamburger-menu use, search-result navigation, image viewing, and switching to/from Lemuroid.
- Verify cold launch, reading, search, images, and theme changes in airplane mode with zero reader network requests.

## Defaults

Android first; one SNES-inspired visual theme with light/dark variants. No backend, accounts, AI rewriting, cloud sync, index, automatic guide updates, or controller remapping in v1. URL and search text entry may use the phone keyboard.
