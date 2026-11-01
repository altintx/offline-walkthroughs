# Offline Walkthroughs

## Summary
Build an Android-first, offline walkthrough reader using React Native, TypeScript, and Expo development builds. Preserve imported wording and images while presenting guides as phone-sized, controller-navigable pages.

## Experience
- Ship a locally bundled SNES-inspired theme: molded-plastic panels, recessed controls, purple accents, tactile borders, readable manual typography.
- Separate visual themes from color mode. System by default, dark if unavailable; System, Light, Dark settings.
- Theme interface with light/dark palettes, typography, spacing, surfaces.
- Resume the last guide at its saved passage. Portrait/landscape, adjustable typography, screen-sized page turns.
- Visible controller-focusable hamburger: Back to Library, Search, Table of Contents, Reading Settings.
- Local full-guide case-insensitive literal search, counts/snippets, next/previous, active highlight, cross-section navigation, boundary announcements without wrapping.
- Always construct a deduplicated TOC from structure, author links, headings; conservative text markers, source files and generated numbered sections as fallback.
- Source-file and heading views, breadcrumbs with sibling positions at every depth.

## Implementation
- SQLite metadata/navigation/search/progress; private files for content/artwork.
- Versioned guide documents with ordered files, stable blocks/headings/TOC/anchors, attribution and assets.
- Positions use file/block/text offset; repaginate and restore passage on layout changes.
- On-device GameFAQs adapter and best-effort static HTML extraction; follow only selected-guide pages.
- Reflow hard-wrapped prose preserving words, lists, ASCII art, maps, tables. Sanitize scripts/trackers; download and localize images.
- Stage imports; cancellation/retry, missing-content disclosure and explicit acceptance; report blocked pages without bypasses.
- Wikimedia artwork selection with cached attribution; local replacement; styled title fallback.
- Sanitized local WebView with bundled pagination; controller zoom/pan for images/fixed blocks.
- Network only during explicit imports/artwork lookup; all reading/library/search/theme operation offline.
- Local Kotlin Expo module: D-pad/stick focus, A confirm, B back, shoulders page turns, Start/Menu hamburger; focusable search controls.
- Local builds, signed APK and GitHub Releases workflow. Signing secrets outside repository; defer store/iOS.

## TDD and acceptance
- Write small behavioral tests first, observe failures, implement to pass; tests remain unchanged. Ask if a test forces wrong behavior/design.
- Test preservation, TOC, import integrity, stable anchors, full-guide search, color modes; no cosmetic snapshots.
- Validate pagination coverage/restoration and search cross-file/repeated/boundary/empty/correct-passage behavior.
- Validate native controller and pagination early on physical Android hardware.
- Controller-only library/reader/menu/search/image navigation and switching to/from Lemuroid.
- Airplane-mode cold launch/reading/search/images/themes, zero reader network requests.

## Defaults
Android first; one SNES visual theme with light/dark variants. No backend, accounts, AI rewriting, cloud sync, index, automatic updates or controller remapping in v1. Phone keyboard allowed for URLs/search.
