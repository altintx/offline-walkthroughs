import "react-native-url-polyfill/auto";
import { Asset } from "expo-asset";
import { useFonts } from "expo-font";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  Keyboard,
  Modal,
  BackHandler,
  Image,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useColorScheme,
  useWindowDimensions,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { readAsStringAsync } from "expo-file-system/legacy";
import { WebView } from "react-native-webview";
import * as Picker from "expo-document-picker";
import { File, Directory, Paths } from "expo-file-system";
import Controller from "walkthrough-controller";
import {
  breadcrumbs,
  colorMode,
  resolveAnchor,
  search,
  stepMatch,
  makeGuide,
} from "./src/core.cjs";
import { theme, themes } from "./src/theme";
import {
  Anchor,
  Guide,
  library,
  loadGuide,
  progress,
  saveGuide,
  deleteGuide,
  renameGuide,
  setting,
} from "./src/storage";
import {
  Stage,
  ImportProgress,
  stageImport,
  commitImport,
  discardStage,
  stageArtwork,
} from "./src/importer";
import { artwork, artworkHeaders, saveGuideArtwork } from "./src/artwork";
import {
  gameFAQsSearchURL,
  isGameFAQsURL,
  isGameFAQsGuide,
  guideBrowserScript,
  BrowserPage,
} from "./src/guideBrowser";
import { readerHTML } from "./src/reader";
function suggestArtworkQuery(g: Guide) {
  if (g.artworkQuery) return g.artworkQuery;
  if (!/\.(txt|html?)$/i.test(g.title)) return g.title;
  const intro = g.files[0].blocks
    .slice(0, 12)
    .map((b) => b.text)
    .join(" ");
  return (
    intro.match(/\bguide for ([^.!?\n]{4,120})/i)?.[1]?.trim() ||
    g.title
      .replace(/\.[^.]+$/, "")
      .replace(/walkthrough|faq/gi, " ")
      .trim()
  );
}
function confirmAction(title: string, message: string, label: string) {
  return new Promise<boolean>((resolve) =>
    Alert.alert(
      title,
      message,
      [
        { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
        { text: label, style: "destructive", onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    ),
  );
}
export default function App() {
  return (
    <SafeAreaProvider>
      <WalkthroughApp />
    </SafeAreaProvider>
  );
}
function WalkthroughApp() {
  const [fontsLoaded] = useFonts({
    ManualMono: require("./assets/ManualMono.ttf"),
  });
  const { width: windowWidth } = useWindowDimensions();
  const system = useColorScheme(),
    [themeId, setThemeId] = useState("super-manual"),
    [showSettings, setShowSettings] = useState(false),
    [gridWidth, setGridWidth] = useState<number>(),
    [fontUri, setFontUri] = useState<string>(),
    [readingPosition, setReadingPosition] = useState<
      Anchor & { page: number; pages: number }
    >(),
    [mode, setMode] = useState("system"),
    [font, setFont] = useState(18),
    [rows, setRows] = useState<Awaited<ReturnType<typeof library>>>([]),
    [showImport, setShowImport] = useState(false),
    [gameSearch, setGameSearch] = useState(""),
    [browserURL, setBrowserURL] = useState<string>(),
    [browserPage, setBrowserPage] = useState({
      url: "",
      title: "",
      loading: false,
      canGoBack: false,
      canGoForward: false,
    }),
    [libraryAction, setLibraryAction] =
      useState<Awaited<ReturnType<typeof library>>[number]>(),
    [renaming, setRenaming] = useState(false),
    [renameValue, setRenameValue] = useState(""),
    [artBusy, setArtBusy] = useState(false),
    [artSaving, setArtSaving] = useState(false),
    [guide, setGuide] = useState<Guide>(),
    [anchor, setAnchor] = useState<Anchor>(),
    [panel, setPanel] = useState(""),
    [url, setUrl] = useState(""),
    [query, setQuery] = useState(""),
    [draftQuery, setDraftQuery] = useState(""),
    [resultLimit, setResultLimit] = useState(25),
    [artQuery, setArtQuery] = useState(""),
    [index, setIndex] = useState(0),
    [notice, setNotice] = useState(""),
    [stage, setStage] = useState<Stage>(),
    [busy, setBusy] = useState(false),
    [importProgress, setImportProgress] = useState<ImportProgress>(),
    [artMessage, setArtMessage] = useState(""),
    [focus, setFocus] = useState(0),
    [tocMode, setTocMode] = useState("headings"),
    [art, setArt] = useState<any[]>([]),
    [zoom, setZoom] = useState<string>(),
    [fixed, setFixed] = useState<string>(),
    [scale, setScale] = useState(1),
    [pan, setPan] = useState({ x: 0, y: 0 });
  const gridActions = useRef(new Set<number>());
  gridActions.current.clear();
  const availableWidth = gridWidth || windowWidth;
  const libraryColumns = availableWidth >= 360 ? 4 : 3;
  const libraryCardWidth = Math.floor(
    (availableWidth - 24 - (libraryColumns - 1) * 8) / libraryColumns,
  );
  const brandFontSize = windowWidth < 360 ? 24 : 30;
  const selectedTheme = themes[themeId] || theme;
  const browser = useRef<WebView>(null);
  const browserImportInFlight = useRef(false);
  const saveImportInFlight = useRef(false);
  const artworkLookupSequence = useRef(0);
  const browserSearchTerm = useRef("");
  const browserRequests = useRef(
    new Map<
      string,
      { resolve: (page: BrowserPage) => void; reject: (error: Error) => void }
    >(),
  );
  const browserSource = useMemo(
    () => (browserURL ? { uri: browserURL } : undefined),
    [browserURL],
  );
  const artworkSelectionInFlight = useRef(false);
  const web = useRef<WebView>(null),
    abort = useRef<AbortController | undefined>(undefined),
    position = useRef<Anchor | undefined>(undefined),
    actions = useRef<(() => void)[]>([]),
    longActions = useRef<((() => void) | undefined)[]>([]);
  actions.current = [];
  longActions.current = [];
  const scroll = useRef<ScrollView>(null);
  const buttonY = useRef(new Map<number, number>());
  useEffect(() => {
    Controller?.start();
  }, []);
  useEffect(() => {
    scroll.current?.scrollTo({
      y: Math.max(0, (buttonY.current.get(focus) || 0) - 120),
      animated: true,
    });
  }, [focus]);
  useEffect(() => {
    if (fontsLoaded) {
      const a = Asset.fromModule(require("./assets/ManualMono.ttf"));
      if (a.localUri) {
        const f = new File(Paths.document, "ManualMono.ttf");
        if (!f.exists) new File(a.localUri).copy(f);
        setFontUri(f.uri);
      }
    }
  }, [fontsLoaded]);
  useEffect(() => {
    setFocus(0);
  }, [
    panel,
    guide?.id,
    zoom,
    fixed,
    libraryAction?.id,
    renaming,
    showImport,
    showSettings,
  ]);
  const colors = selectedTheme[colorMode(mode, system) as "light" | "dark"];
  const results = useMemo(
    () => (guide ? search(guide, query) : []),
    [guide, query],
  );
  const refresh = async () => setRows(await library());
  const open = async (row: (typeof rows)[number], imported?: Guide) => {
    const g = imported || (await loadGuide(row.path));
    setNotice("");
    setGuide(g);
    setShowImport(false);
    setShowSettings(false);
    setReadingPosition(undefined);
    const a = resolveAnchor(
      g,
      row.position ? JSON.parse(row.position) : undefined,
    );
    position.current = a;
    setAnchor(a);
    setPanel("");
    setQuery("");
    setDraftQuery("");
    setResultLimit(25);
  };
  useEffect(() => {
    (async () => {
      try {
        const storedTheme = await setting("theme");
        if (storedTheme && themes[storedTheme]) setThemeId(storedTheme);
        setMode((await setting("mode")) || "system");
        setFont(Number(await setting("font")) || 18);
        const r = await library();
        setRows(r);
      } catch (e) {
        setNotice(String(e));
      }
    })();
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 6000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => setNotice(""), [panel]);
  const announce = (s: string) => {
    setNotice(s);
    AccessibilityInfo.announceForAccessibility(s);
  };
  const commandSequence = useRef(0);
  const sendCommand = (command: object) =>
    web.current?.postMessage(
      JSON.stringify({ ...command, commandId: ++commandSequence.current }),
    );
  const turn = (direction: number) => sendCommand({ type: "turn", direction });
  const jump = (a: Anchor) => {
    Keyboard.dismiss();
    position.current = a;
    setAnchor(a);
    sendCommand({ type: "anchor", anchor: a });
    setPanel("");
  };
  function openHomePage(page: "library" | "settings" | "import") {
    setShowSettings(page === "settings");
    setShowImport(page === "import");
    setNotice("");
    setFocus(0);
    scroll.current?.scrollTo({ y: 0, animated: false });
  }
  function closeGuideBrowser() {
    abort.current?.abort();
    for (const pending of browserRequests.current.values())
      pending.reject(Error("Import cancelled"));
    setBrowserURL(undefined);
    openHomePage("import");
  }
  function searchGameFAQs() {
    if (browserImportInFlight.current) return;
    const target = gameFAQsSearchURL(gameSearch);
    browserSearchTerm.current = gameSearch.trim();
    Keyboard.dismiss();
    setNotice("");
    setBrowserPage({
      url: target,
      title: "GameFAQs",
      loading: true,
      canGoBack: false,
      canGoForward: false,
    });
    if (target === browserURL)
      browser.current?.injectJavaScript(
        `location.href=${JSON.stringify(target)};true;`,
      );
    else setBrowserURL(target);
  }
  function requestBrowserPage(
    signal: AbortSignal,
    url?: string,
  ): Promise<BrowserPage> {
    if (signal.aborted) return Promise.reject(Error("Import cancelled"));
    if (!browser.current)
      return Promise.reject(Error("The browser is not ready yet"));
    return new Promise((resolve, reject) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", cancel);
        browserRequests.current.delete(id);
      };
      const cancel = () => {
        const pending = browserRequests.current.get(id);
        pending?.reject(Error("Import cancelled"));
      };
      const timer = setTimeout(
        () =>
          browserRequests.current
            .get(id)
            ?.reject(
              Error(
                "The browser did not return this page. Open it and try again.",
              ),
            ),
        30000,
      );
      const pending = {
        resolve: (page: BrowserPage) => {
          cleanup();
          resolve(page);
        },
        reject: (error: Error) => {
          cleanup();
          reject(error);
        },
      };
      browserRequests.current.set(id, pending);
      signal.addEventListener("abort", cancel, { once: true });
      if (signal.aborted) {
        cancel();
        return;
      }
      try {
        browser.current!.injectJavaScript(guideBrowserScript(id, url));
      } catch (error) {
        pending.reject(error instanceof Error ? error : Error(String(error)));
      }
    });
  }
  useEffect(
    () => () => {
      for (const pending of browserRequests.current.values())
        pending.reject(Error("Browser closed"));
    },
    [],
  );
  async function captureBrowserGuide() {
    if (browserImportInFlight.current) return;
    if (!isGameFAQsGuide(browserPage.url)) {
      announce("Open a GameFAQs guide before importing");
      return;
    }
    if (browserPage.loading) {
      announce("Wait for the guide to finish loading");
      return;
    }
    browserImportInFlight.current = true;
    setImportProgress({ phase: "pages", completed: 0, total: 1 });
    setBusy(true);
    setNotice("");
    const controller = new AbortController();
    abort.current = controller;
    const artworkTerm = browserSearchTerm.current;
    setArtQuery(artworkTerm);
    setArt([]);
    setArtMessage("");
    if (artworkTerm)
      void searchArtwork(artworkTerm, true, controller.signal, browserPage.url);
    try {
      if (stage) discardStage(stage);
      setStage(undefined);
      const captured = await requestBrowserPage(controller.signal);
      if (!isGameFAQsGuide(captured.url))
        throw Error("The selected page is not a GameFAQs guide");
      const next = await stageImport(captured.url, controller.signal, {
        initialPage: captured,
        onProgress: setImportProgress,
        fetchPage: (url, signal) => requestBrowserPage(signal, url),
      });
      if (!next.files.length) {
        discardStage(next);
        throw Error(next.missing[0] || "No readable guide content found");
      }
      next.artworkQuery = artworkTerm || undefined;
      setStage(next);
      setBrowserURL(undefined);
      openHomePage("import");
      announce(`Ready to review ${next.title}`);
    } catch (error) {
      announce(String(error));
    } finally {
      browserImportInFlight.current = false;
      setImportProgress(undefined);
      setBusy(false);
    }
  }
  const back = () => {
    if (importProgress) {
      if (importProgress.phase !== "saving") abort.current?.abort();
      return true;
    }
    if (browserURL) {
      if (browserPage.canGoBack && !browserImportInFlight.current)
        browser.current?.goBack();
      else closeGuideBrowser();
      return true;
    }
    if (libraryAction) {
      setLibraryAction(undefined);
      setRenaming(false);
    } else if (!guide && (showSettings || showImport)) {
      if (showImport) abort.current?.abort();
      openHomePage("library");
    } else if (zoom || fixed) {
      setZoom(undefined);
      setFixed(undefined);
    } else if (panel) setPanel("");
    else if (guide) {
      setGuide(undefined);
      refresh();
    }
    return true;
  };
  useEffect(() => {
    const s = BackHandler.addEventListener("hardwareBackPress", back);
    return () => s.remove();
  });
  useEffect(() => {
    const sub = Controller?.addListener(
      "onInput",
      ({ action }: { action: string }) => {
        if (importProgress) {
          if (action === "back") back();
          return;
        }
        if (action === "back") back();
        else if (action === "menu") {
          if (!guide) {
            if (libraryAction) setLibraryAction(undefined);
            else longActions.current[focus]?.();
            return;
          }
          setPanel((p) => (p ? "" : "menu"));
          setFocus(0);
        } else if (zoom || fixed) {
          if (action === "confirm" || action === "next")
            setScale((s) => Math.min(5, s + 0.5));
          else if (action === "previous")
            setScale((s) => Math.max(0.5, s - 0.5));
          else
            setPan((p) => ({
              x: p.x + (action === "right" ? 30 : action === "left" ? -30 : 0),
              y: p.y + (action === "down" ? 30 : action === "up" ? -30 : 0),
            }));
        } else if (action === "next" || action === "previous")
          turn(action === "next" ? 1 : -1);
        else if (action === "confirm") actions.current[focus]?.();
        else if (["up", "down", "left", "right"].includes(action))
          setFocus((f) =>
            Math.max(
              0,
              Math.min(
                actions.current.length - 1,
                f +
                  (["down", "right"].includes(action) ? 1 : -1) *
                    (!guide &&
                    !showSettings &&
                    !showImport &&
                    !libraryAction &&
                    gridActions.current.has(f) &&
                    ["up", "down"].includes(action)
                      ? libraryColumns
                      : 1),
              ),
            ),
          );
      },
    );
    return () => sub?.remove();
  });
  const button = (
    label: string,
    fn: () => void,
    cover?: string | null,
    onLongPress?: () => void,
    options?: {
      compact?: boolean;
      tone?: "accent" | "secondaryAccent" | "tertiaryAccent";
      accessibilityLabel?: string;
      icon?: boolean;
      toolbar?: boolean;
      cardWidth?: number;
    },
  ) => {
    const i = actions.current.length;
    const action = () => {
      try {
        Promise.resolve(fn()).catch((e) => announce(String(e)));
      } catch (e) {
        announce(String(e));
      }
    };
    actions.current.push(action);
    longActions.current[i] = onLongPress;
    if (options?.cardWidth) gridActions.current.add(i);
    return (
      <Pressable
        key={`control-${i}`}
        accessibilityRole="button"
        accessibilityLabel={options?.accessibilityLabel || label}
        focusable
        onLayout={(e) => buttonY.current.set(i, e.nativeEvent.layout.y)}
        onPress={action}
        onLongPress={onLongPress}
        accessibilityHint={
          onLongPress ? "Long press for guide actions" : undefined
        }
        accessibilityActions={
          onLongPress
            ? [{ name: "longpress", label: "Guide actions" }]
            : undefined
        }
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === "longpress") onLongPress?.();
        }}
        onFocus={() => setFocus(i)}
        style={{
          padding: 12,
          margin: 4,
          borderRadius: selectedTheme.radius,
          borderWidth: 2,
          borderTopColor: focus === i ? colors.accent : colors.highlight,
          borderBottomWidth: 4,
          elevation: colors.glow ? 6 : 3,
          ...(colors.glow
            ? {
                shadowColor: colors.glow,
                shadowOpacity: 0.45,
                shadowRadius: 10,
                shadowOffset: { width: 0, height: 0 },
              }
            : {}),
          borderColor: focus === i ? colors.accent : colors.border,
          backgroundColor: colors.surface,
          ...(options?.toolbar
            ? {
                minHeight: 56,
                alignSelf: "stretch" as const,
                justifyContent: "center" as const,
              }
            : {}),
          ...(options?.icon
            ? {
                width: 52,
                minHeight: 56,
                alignSelf: "stretch" as const,
                padding: 6,
                alignItems: "center" as const,
                justifyContent: "center" as const,
              }
            : {}),
          ...(options?.cardWidth
            ? { width: options.cardWidth, margin: 0, padding: 6, elevation: 2 }
            : {}),
          ...(options?.compact
            ? {
                flex: 1,
                height: 56,
                padding: 8,
                margin: 0,
                borderRadius: 0,
                borderBottomWidth: 2,
                elevation: 0,
                justifyContent: "center" as const,
                backgroundColor: colors.background,
                borderColor: focus === i ? colors.accent : colors.background,
                borderTopColor: focus === i ? colors.accent : colors.background,
              }
            : {}),
        }}
      >
        {cover ? (
          <Image
            source={{
              uri: cover,
              headers: cover.startsWith("https://")
                ? artworkHeaders
                : undefined,
            }}
            style={
              options?.cardWidth
                ? { width: "100%", aspectRatio: 0.8, marginBottom: 8 }
                : { width: 64, height: 80, marginBottom: 8 }
            }
            resizeMode="contain"
          />
        ) : options?.cardWidth ? (
          <View
            style={{
              width: "100%",
              aspectRatio: 0.8,
              marginBottom: 8,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: colors.background,
              borderRadius: 4,
            }}
          >
            <Image
              accessible={false}
              source={require("./assets/strattome-map-icon.png")}
              style={{ width: "75%", height: "75%" }}
              resizeMode="contain"
            />
          </View>
        ) : null}
        <Text
          allowFontScaling={!options?.icon}
          numberOfLines={
            options?.compact ? 2 : options?.cardWidth ? 3 : undefined
          }
          style={{
            color: options?.tone
              ? colors[options.tone] || colors.text
              : colors.text,
            fontFamily: options?.icon ? undefined : selectedTheme.font,
            ...(options?.icon
              ? {
                  fontSize: 24,
                  lineHeight: 32,
                  includeFontPadding: false,
                  textAlign: "center" as const,
                }
              : {}),
            ...(options?.cardWidth
              ? { fontSize: 12, lineHeight: 16, minHeight: 48 }
              : {}),
          }}
        >
          {label}
        </Text>
      </Pressable>
    );
  };
  const input = (
    value: string,
    onChangeText: (s: string) => void,
    placeholder: string,
    onSubmit?: () => void,
  ) => (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      accessibilityLabel={placeholder}
      returnKeyType={onSubmit ? "search" : "done"}
      onSubmitEditing={onSubmit || Keyboard.dismiss}
      placeholderTextColor={colors.border}
      autoCapitalize="none"
      autoCorrect={false}
      spellCheck={false}
      style={{
        color: colors.text,
        padding: 14,
        borderWidth: 1,
        borderColor: colors.border,
        margin: 8,
      }}
    />
  );
  async function runImport() {
    const value = url.trim();
    if (/^(content|file):\/\//i.test(value)) {
      await localImport(value);
      return;
    }
    setNotice("");
    abort.current = new AbortController();
    setBusy(true);
    if (stage) discardStage(stage);
    setStage(undefined);
    setImportProgress({ phase: "pages", completed: 0, total: 1 });
    try {
      setStage(
        await stageImport(value, abort.current.signal, {
          onProgress: setImportProgress,
        }),
      );
    } catch (e) {
      announce(String(e));
    } finally {
      setImportProgress(undefined);
      setBusy(false);
    }
  }
  async function finish(accept: boolean) {
    if (!stage || saveImportInFlight.current) return;
    saveImportInFlight.current = true;
    setImportProgress({
      phase: "saving",
      completed: 0,
      total: 1,
      detail: "Preparing guide",
    });
    setBusy(true);
    abort.current = new AbortController();
    setNotice("");
    try {
      const candidate = makeGuide(stage.title, stage.files) as Guide;
      const existing = (await library()).find((row) => row.id === candidate.id);
      if (
        existing &&
        !(await confirmAction(
          "Replace existing guide?",
          `“${existing.title}” is already in your library. Replace its imported content and restart at the beginning?`,
          "Replace",
        ))
      )
        return;
      const g = await commitImport(
        stage,
        accept,
        abort.current.signal,
        true,
        existing?.title,
        setImportProgress,
      );
      setStage(undefined);
      await refresh();
      await open(
        { id: g.id, title: g.title, path: "", position: null, cover: null },
        g,
      );
      announce(`${existing ? "Replaced" : "Imported"} ${g.title}`);
    } catch (e) {
      announce(String(e));
    } finally {
      saveImportInFlight.current = false;
      setImportProgress(undefined);
      setBusy(false);
    }
  }
  async function localImport(uri?: string) {
    setNotice("");
    setBusy(true);
    if (stage) discardStage(stage);
    setStage(undefined);
    try {
      let asset: { uri: string; name: string; mimeType?: string };
      if (uri) {
        asset = {
          uri,
          name: decodeURIComponent(uri.split("/").pop() || "Imported guide"),
        };
      } else {
        const r = await Picker.getDocumentAsync({
          type: ["text/plain", "text/html", "application/octet-stream"],
          copyToCacheDirectory: true,
        });
        if (r.canceled) return;
        asset = r.assets[0];
      }
      let contents: string;
      try {
        contents = asset.uri.startsWith("content://")
          ? await readAsStringAsync(asset.uri)
          : await new File(asset.uri).text();
      } catch (e) {
        if (asset.uri.startsWith("content://"))
          throw Error(
            "Cannot access this file. A pasted content:// address does not grant permission to read it. Choose Import local text / HTML and select the file to grant access. If it is unavailable in the picker, save a copy to Downloads first.",
          );
        throw e;
      }
      if (!contents.trim()) throw Error("This file contains no readable text");
      const { extractHTML } = require("./src/core.cjs");
      if (asset.mimeType === "text/html" || /\.html?$/i.test(asset.name)) {
        const extracted = extractHTML(contents);
        const directory = new Directory(
          Paths.cache,
          `import-local-${Date.now()}`,
        );
        directory.create({ intermediates: true });
        setStage({
          title: asset.name,
          files: [{ id: "local", name: asset.name, ...extracted }],
          missing: extracted.images.map(
            (x: string) => `Local HTML image not bundled: ${x}`,
          ),
          images: [],
          assets: [],
          directory: directory.uri,
        });
        announce(`Ready to review ${asset.name}`);
        return;
      }
      setImportProgress({
        phase: "saving",
        completed: 0,
        total: 1,
        detail: "Preparing text and table of contents",
      });
      const g = makeGuide(asset.name, [
        { id: "local", name: asset.name, text: contents },
      ]);
      const existing = (await library()).find((row) => row.id === g.id);
      if (
        existing &&
        !(await confirmAction(
          "Replace existing guide?",
          `“${existing.title}” is already in your library. Replace its imported content and restart at the beginning?`,
          "Replace",
        ))
      )
        return;
      if (existing) g.title = existing.title;
      setImportProgress({
        phase: "saving",
        completed: 0,
        total: 1,
        detail:
          "Saving text, search index and table of contents. Large guides can take a minute.",
      });
      await saveGuide(g, true);
      await refresh();
      await open(
        { id: g.id, title: g.title, path: "", position: null, cover: null },
        g,
      );
      announce(`${existing ? "Replaced" : "Imported"} ${g.title}`);
    } catch (e) {
      announce(String(e));
    } finally {
      setImportProgress(undefined);
      setBusy(false);
    }
  }
  const heading = (s: string) => (
    <Text
      style={{
        color: colors.accent,
        fontFamily: selectedTheme.font,
        fontSize: 23,
        padding: 12,
        fontWeight: "bold",
      }}
    >
      {s}
    </Text>
  );
  const text = (s: string) => (
    <Text
      style={{
        color: colors.text,
        padding: 10,
        fontFamily: selectedTheme.font,
      }}
    >
      {s}
    </Text>
  );
  async function searchArtwork(
    term: string,
    automatic = false,
    signal?: AbortSignal,
    sourceURL?: string,
  ) {
    const sequence = ++artworkLookupSequence.current;
    setArtBusy(true);
    setArt([]);
    setArtMessage("");
    if (!automatic) setNotice("");
    try {
      const found = await artwork(
        term,
        sourceURL || guide?.files[0]?.source || stage?.files[0]?.source,
      );
      if (sequence !== artworkLookupSequence.current || signal?.aborted) return;
      setArt(found);
      if (!found.length) {
        const message =
          "No artwork found. You can save without artwork or try another game title.";
        setArtMessage(message);
        if (!automatic) announce(message);
      }
    } catch (e) {
      if (sequence !== artworkLookupSequence.current || signal?.aborted) return;
      const message =
        "Artwork search unavailable. You can save without artwork and try again later.";
      setArtMessage(message);
      if (!automatic) announce(String(e));
    } finally {
      if (sequence === artworkLookupSequence.current) setArtBusy(false);
    }
  }
  async function lookupArtwork() {
    if (artBusy) return;
    return searchArtwork(artQuery);
  }
  async function runArtworkSelection(
    work: () => Promise<boolean | void>,
    success: string,
  ) {
    if (artworkSelectionInFlight.current) return;
    artworkSelectionInFlight.current = true;
    setArtSaving(true);
    setNotice("");
    try {
      if ((await work()) !== false) announce(success);
    } catch (error) {
      announce(String(error));
    } finally {
      artworkSelectionInFlight.current = false;
      setArtSaving(false);
    }
  }
  function selectArtwork(item: any) {
    return runArtworkSelection(
      async () => {
        if (guide) {
          const updated = await saveGuideArtwork(
            guide.id,
            { item },
            new AbortController().signal,
          );
          setGuide((current) =>
            current?.id === updated.id ? updated : current,
          );
        } else if (stage) {
          abort.current = new AbortController();
          setStage(await stageArtwork(stage, item, abort.current.signal));
        } else throw Error("Choose a guide before selecting artwork");
      },
      guide ? "Artwork saved" : "Artwork ready to save",
    );
  }
  function selectLocalArtwork() {
    return runArtworkSelection(async () => {
      if (!guide) return false;
      const result = await Picker.getDocumentAsync({
        type: "image/*",
        copyToCacheDirectory: true,
      });
      if (result.canceled) return false;
      const updated = await saveGuideArtwork(
        guide.id,
        { localUri: result.assets[0].uri },
        new AbortController().signal,
      );
      setGuide((current) => (current?.id === updated.id ? updated : current));
    }, "Artwork saved");
  }
  function renderArtworkResults() {
    return art.map((item) =>
      button(
        item.title,
        () => selectArtwork(item),
        item.imageinfo?.[0]?.thumburl || item.imageinfo?.[0]?.url,
      ),
    );
  }
  function renderAppearanceOptions() {
    return ["system", "light", "dark"].map((m) =>
      button(`Color: ${m}${m === mode ? " ✓" : ""}`, async () => {
        await setting("mode", m);
        setMode(m);
      }),
    );
  }
  const closeSearch = () => {
    Keyboard.dismiss();
    if (position.current) setAnchor({ ...position.current });
    setQuery("");
    setDraftQuery("");
    setIndex(0);
    setResultLimit(25);
    setPanel("");
    setNotice("");
  };
  const changeMatch = (d: number) => {
    const next = stepMatch(results, index, d);
    setIndex(next.index);
    if (next.message) announce(next.message);
    if (results[next.index]) jump(results[next.index]);
  };
  const trail =
    guide && anchor ? breadcrumbs(guide, position.current || anchor) : [];
  const openContents = () => {
    Keyboard.dismiss();
    setTocMode("headings");
    setPanel("toc");
    setFocus(0);
  };
  const sections = trail
    .filter((t: any) => t.level > 0)
    .map((t: any) => t.title);
  const breadcrumbLabel = [
    ...(sections.length ? sections : ["Beginning of guide"]),
    readingPosition
      ? `Page ${readingPosition.page} of ${readingPosition.pages}`
      : "Laying out pages…",
  ].join(" › ");
  const source = useMemo(
    () =>
      guide && anchor && !panel && !zoom && !fixed
        ? {
            html: readerHTML(
              guide,
              position.current || anchor,
              font,
              colors,
              results[index],
              fontUri,
            ),
            baseUrl: Paths.document.uri,
          }
        : undefined,
    [guide, anchor, font, colors, query, index, fontUri, panel, zoom, fixed],
  );

  if (!fontsLoaded)
    return (
      <SafeAreaView>
        <Text>Loading manual…</Text>
      </SafeAreaView>
    );
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      {browserURL ? (
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            {button(
              "‹",
              () => {
                if (!busy && browserPage.canGoBack) browser.current?.goBack();
              },
              undefined,
              undefined,
              { icon: true, accessibilityLabel: "Browser back" },
            )}
            {button(
              "›",
              () => {
                if (!busy && browserPage.canGoForward)
                  browser.current?.goForward();
              },
              undefined,
              undefined,
              { icon: true, accessibilityLabel: "Browser forward" },
            )}
            <Text numberOfLines={1} style={{ color: colors.text, flex: 1 }}>
              GameFAQs
            </Text>
            {button("Close", closeGuideBrowser)}
          </View>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <View style={{ flex: 1 }}>
              {input(
                gameSearch,
                setGameSearch,
                "Search GameFAQs for a game",
                searchGameFAQs,
              )}
            </View>
            {button("Search", searchGameFAQs)}
          </View>
          <Text
            numberOfLines={1}
            style={{
              color: colors.text,
              paddingHorizontal: 12,
              paddingBottom: 6,
            }}
          >
            {browserPage.title || browserPage.url}
          </Text>
          <View style={{ flex: 1 }} pointerEvents={busy ? "none" : "auto"}>
            <WebView
              ref={browser}
              source={browserSource!}
              style={{ flex: 1 }}
              originWhitelist={["https://*"]}
              javaScriptEnabled
              domStorageEnabled
              thirdPartyCookiesEnabled
              allowFileAccess={false}
              allowFileAccessFromFileURLs={false}
              allowUniversalAccessFromFileURLs={false}
              mixedContentMode="never"
              setSupportMultipleWindows={false}
              onShouldStartLoadWithRequest={(request) => {
                if (request.isTopFrame === false)
                  return request.url.startsWith("https://");
                return (
                  isGameFAQsURL(request.url) &&
                  (!browserImportInFlight.current ||
                    request.url === browserPage.url)
                );
              }}
              onNavigationStateChange={(state) => {
                if (isGameFAQsURL(state.url)) {
                  const location = new URL(state.url);
                  const searched =
                    location.pathname === "/search"
                      ? location.searchParams.get("game")?.trim()
                      : undefined;
                  if (searched) {
                    browserSearchTerm.current = searched;
                    setGameSearch(searched);
                  }
                  setBrowserPage({
                    url: state.url,
                    title: state.title,
                    loading: state.loading,
                    canGoBack: state.canGoBack,
                    canGoForward: state.canGoForward,
                  });
                }
              }}
              onLoadEnd={() =>
                setBrowserPage((current) => ({ ...current, loading: false }))
              }
              onError={(event) =>
                announce(
                  `Browser could not load this page: ${event.nativeEvent.description}`,
                )
              }
              onMessage={(event) => {
                try {
                  if (
                    event.nativeEvent.url &&
                    !isGameFAQsURL(event.nativeEvent.url)
                  )
                    return;
                  if (event.nativeEvent.data.length > 5500000)
                    throw Error("This guide page is too large to capture");
                  const data = JSON.parse(event.nativeEvent.data);
                  if (
                    data.type !== "strattome-guide-page" ||
                    typeof data.requestId !== "string"
                  )
                    return;
                  const pending = browserRequests.current.get(data.requestId);
                  if (!pending) return;
                  if (data.error) {
                    pending.reject(Error(String(data.error).slice(0, 300)));
                    return;
                  }
                  if (
                    typeof data.html !== "string" ||
                    data.html.length > 5000000 ||
                    !isGameFAQsGuide(data.url)
                  ) {
                    pending.reject(
                      Error("The browser did not return a readable guide page"),
                    );
                    return;
                  }
                  pending.resolve({ url: data.url, html: data.html });
                } catch (error) {
                  for (const pending of browserRequests.current.values())
                    pending.reject(
                      error instanceof Error ? error : Error(String(error)),
                    );
                }
              }}
            />
          </View>
          {isGameFAQsGuide(browserPage.url)
            ? button(
                busy ? "Importing guide…" : "Import this guide",
                captureBrowserGuide,
              )
            : text(
                browserPage.loading
                  ? "Loading GameFAQs…"
                  : "Find a game, open its Guides page, and choose a guide to import.",
              )}
        </View>
      ) : zoom || fixed ? (
        <>
          <ScrollView horizontal>
            <ScrollView>
              {fixed ? (
                <Text
                  style={{
                    color: colors.text,
                    fontFamily: selectedTheme.font,
                    fontSize: 18 * scale,
                    transform: [{ translateX: pan.x }, { translateY: pan.y }],
                  }}
                >
                  {fixed}
                </Text>
              ) : (
                <Image
                  source={{ uri: zoom }}
                  style={{
                    width: 600 * scale,
                    height: 600 * scale,
                    transform: [{ translateX: pan.x }, { translateY: pan.y }],
                  }}
                  resizeMode="contain"
                />
              )}
            </ScrollView>
          </ScrollView>
          {button("Zoom +", () => setScale((s) => Math.min(5, s + 0.5)))}
          {button("Zoom −", () => setScale((s) => Math.max(0.5, s - 0.5)))}
          {button("Close image", () => {
            setZoom(undefined);
            setFixed(undefined);
          })}
        </>
      ) : guide && anchor ? (
        <>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            {button("☰", () => {
              setPanel(panel ? "" : "menu");
              setFocus(0);
            })}
            {button(breadcrumbLabel, openContents, undefined, undefined, {
              compact: true,
              accessibilityLabel: "Open table of contents",
            })}
          </View>
          {panel ? (
            <ScrollView ref={scroll} keyboardShouldPersistTaps="handled">
              {panel === "menu" ? (
                <>
                  {button("Back to Library", () => {
                    setGuide(undefined);
                    setPanel("");
                    refresh();
                  })}
                  {button("Search", () => setPanel("search"))}
                  {button("Table of Contents", openContents)}
                  {button("Reading Settings", () => setPanel("settings"))}
                  {button("Images and maps", () => setPanel("images"))}
                  {button("Artwork", () => {
                    setArtQuery(suggestArtworkQuery(guide));
                    setArt([]);
                    setPanel("artwork");
                  })}
                </>
              ) : panel === "search" ? (
                <>
                  {heading("Search entire guide")}
                  {button("Close search", closeSearch)}
                  {input(draftQuery, setDraftQuery, "Search guide text", () => {
                    Keyboard.dismiss();
                    setQuery(draftQuery.trim());
                    setIndex(0);
                    setResultLimit(25);
                  })}
                  {button("Search", () => {
                    Keyboard.dismiss();
                    setQuery(draftQuery.trim());
                    setIndex(0);
                    setResultLimit(25);
                  })}
                  {text(
                    query
                      ? `${results.length} matches for “${query}”`
                      : "Enter a word or phrase, then tap Search.",
                  )}
                  {button("Show first match", () => {
                    Keyboard.dismiss();
                    if (results[0]) {
                      setIndex(0);
                      jump(results[0]);
                    } else announce("No matches in this imported guide");
                  })}
                  {button("Previous occurrence", () => changeMatch(-1))}
                  {button("Next occurrence", () => changeMatch(1))}
                  {results.slice(0, resultLimit).map((r: any, i: number) =>
                    button(`${i + 1}: ${r.snippet}`, () => {
                      setIndex(i);
                      jump(r);
                    }),
                  )}
                  {results.length > resultLimit
                    ? button(
                        `Show more matches (${Math.min(resultLimit, results.length)} of ${results.length} shown)`,
                        () => setResultLimit((n) => n + 25),
                      )
                    : null}
                </>
              ) : panel === "toc" ? (
                <>
                  {heading(guide.title)}
                  {text("Table of Contents")}
                  {button("Source files", () => setTocMode("files"))}
                  {button("Headings", () => setTocMode("headings"))}
                  {tocMode === "headings"
                    ? button("Beginning of guide", () =>
                        jump(resolveAnchor(guide, undefined)),
                      )
                    : null}
                  {tocMode === "headings" && !guide.toc.some((t) => t.level > 0)
                    ? text(
                        "No section headings found. Use search, swipe, or tap the page edges to navigate.",
                      )
                    : null}
                  {guide.toc
                    .filter((t) =>
                      tocMode === "files" ? t.level === 0 : t.level > 0,
                    )
                    .map((t) =>
                      button(`${"  ".repeat(t.level)}${t.title}`, () =>
                        jump(t),
                      ),
                    )}
                </>
              ) : panel === "images" ? (
                <>
                  {guide.files
                    .flatMap((f) => f.blocks)
                    .filter((b) => b.kind === "pre")
                    .map((b) =>
                      button(b.text.slice(0, 50), () => {
                        setFixed(b.text);
                        setScale(1);
                        setPan({ x: 0, y: 0 });
                      }),
                    )}
                  {guide.assets.map((a, i) =>
                    button(`Image ${i + 1}`, () => {
                      setZoom(a.uri);
                      setScale(1);
                      setPan({ x: 0, y: 0 });
                    }),
                  )}
                </>
              ) : panel === "artwork" ? (
                <>
                  {input(artQuery, setArtQuery, "Game title for box art")}
                  {button(
                    artBusy ? "Looking up artwork…" : "Look up artwork online",
                    lookupArtwork,
                  )}
                  {renderArtworkResults()}
                  {artSaving ? text("Saving artwork…") : null}
                  {button("Choose local artwork", selectLocalArtwork)}
                  {guide.attribution.map((value, i) => (
                    <React.Fragment key={`credit-${i}`}>
                      {text(value)}
                    </React.Fragment>
                  ))}
                </>
              ) : (
                <>
                  {heading("Reading Settings")}
                  {renderAppearanceOptions()}
                  {button("Larger type", () => {
                    setFont(Math.min(32, font + 2));
                    setting("font", String(Math.min(32, font + 2)));
                  })}
                  {button("Smaller type", () => {
                    setFont(Math.max(12, font - 2));
                    setting("font", String(Math.max(12, font - 2)));
                  })}
                </>
              )}
              {button("Return to reader", () => {
                Keyboard.dismiss();
                setPanel("");
              })}
            </ScrollView>
          ) : (
            <>
              <WebView
                ref={web}
                originWhitelist={["file://*", "about:blank"]}
                source={source!}
                allowFileAccess
                allowingReadAccessToURL={Paths.document.uri}
                javaScriptEnabled
                style={{ flex: 1, backgroundColor: colors.surface }}
                scrollEnabled={false}
                scalesPageToFit={false}
                textZoom={100}
                showsHorizontalScrollIndicator={false}
                showsVerticalScrollIndicator={false}
                overScrollMode="never"
                bounces={false}
                onShouldStartLoadWithRequest={(r) =>
                  r.url === "about:blank" || r.url.startsWith("file://")
                }
                onMessage={(e) => {
                  try {
                    const m = JSON.parse(e.nativeEvent.data);
                    if (m.type === "position") {
                      position.current = m;
                      setReadingPosition(m);
                      progress(guide.id, m).catch((e) => announce(String(e)));
                    } else if (m.type === "image") {
                      setZoom(m.uri);
                      setScale(1);
                      setPan({ x: 0, y: 0 });
                    } else if (m.type === "fixed") {
                      setFixed(
                        guide.files
                          .flatMap((f) => f.blocks)
                          .find((b) => b.id === m.blockId)?.text,
                      );
                      setScale(1);
                      setPan({ x: 0, y: 0 });
                    } else if (m.message) announce(m.message);
                  } catch {}
                }}
              />
              <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                {query ? button("Close search", closeSearch) : null}
                {query ? button("Previous match", () => changeMatch(-1)) : null}
                {query
                  ? button(
                      `${results.length ? index + 1 : 0}/${results.length} Next match`,
                      () => changeMatch(1),
                    )
                  : null}
              </View>
            </>
          )}
        </>
      ) : (
        <View style={{ flex: 1 }}>
          {!guide && !libraryAction && !showImport && !showSettings ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                paddingHorizontal: 8,
              }}
            >
              <View
                accessible
                accessibilityRole="header"
                accessibilityLabel="StratTome"
                style={{
                  flexDirection: "row",
                  alignItems: "baseline",
                  paddingHorizontal: 4,
                  flex: 1,
                  minWidth: 0,
                  paddingVertical: 8,
                }}
              >
                <Text
                  accessible={false}
                  style={{
                    color: colors.text,
                    fontFamily: selectedTheme.font,
                    fontSize: brandFontSize,
                    lineHeight: brandFontSize + 10,
                    fontWeight: "bold",
                  }}
                >
                  StratT
                </Text>
                <Image
                  accessible={false}
                  source={require("./assets/strattome-map-icon.png")}
                  style={{
                    width: brandFontSize * 0.82,
                    height: brandFontSize * 0.82,
                    marginHorizontal: 1,
                    transform: [{ translateY: 3 }],
                  }}
                  resizeMode="contain"
                />
                <Text
                  accessible={false}
                  style={{
                    color: colors.tertiaryAccent || colors.text,
                    fontFamily: selectedTheme.font,
                    fontSize: brandFontSize,
                    lineHeight: brandFontSize + 10,
                    fontWeight: "bold",
                  }}
                >
                  me
                </Text>
              </View>
              {button(
                "Import",
                () => openHomePage("import"),
                undefined,
                undefined,
                {
                  toolbar: true,
                  tone: colors.secondaryAccent ? "accent" : undefined,
                },
              )}
              {button(
                "⚙︎",
                () => openHomePage("settings"),
                undefined,
                undefined,
                {
                  icon: true,
                  toolbar: true,
                  accessibilityLabel: "Settings",
                  tone: "secondaryAccent",
                },
              )}
            </View>
          ) : null}
          <ScrollView ref={scroll} keyboardShouldPersistTaps="handled">
            {showSettings ? (
              <>
                {heading("Settings")}
                {heading("Theme")}
                {Object.entries(themes).map(([id, value]) =>
                  button(
                    `${value.name}${themeId === id ? " ✓" : ""}`,
                    async () => {
                      await setting("theme", id);
                      setThemeId(id);
                    },
                  ),
                )}
                {Object.keys(themes).length === 1
                  ? text("No other themes are available yet.")
                  : null}
                {heading("Appearance")}
                {renderAppearanceOptions()}
                {button("Back to library", () => openHomePage("library"))}
              </>
            ) : (
              <>
                {!libraryAction && (!showImport || rows.length === 0) ? (
                  <>
                    <View
                      onLayout={(e) => setGridWidth(e.nativeEvent.layout.width)}
                      style={{
                        flexDirection: "row",
                        flexWrap: "wrap",
                        gap: 8,
                        padding: 12,
                      }}
                    >
                      {!libraryAction &&
                        rows.map((r) =>
                          button(
                            r.title,
                            () => open(r),
                            r.cover,
                            () => {
                              setNotice("");
                              setLibraryAction(r);
                              setRenaming(false);
                              setRenameValue(r.title);
                            },
                            { cardWidth: libraryCardWidth },
                          ),
                        )}
                    </View>
                  </>
                ) : null}
                {rows.length === 0 || showImport ? (
                  <>
                    {stage ? (
                      <>
                        {heading("Review guide")}
                        {text(stage.title)}
                        {text(
                          "Captured and ready to save. This guide is not in your library yet.",
                        )}
                        {text(
                          `${stage.files.length} readable ${stage.files.length === 1 ? "file" : "files"}; ${stage.missing.length} missing pages`,
                        )}
                        {stage.missing.map((message, i) => (
                          <React.Fragment key={`missing-${i}`}>
                            {text(message)}
                          </React.Fragment>
                        ))}
                        {button(
                          stage.missing.length
                            ? "Accept incomplete guide and save"
                            : "Save guide offline",
                          () => finish(!!stage.missing.length),
                        )}
                        {heading("Artwork (optional)")}
                        {text(
                          "You can save without artwork and add it later from your library.",
                        )}
                        {input(
                          artQuery,
                          setArtQuery,
                          "Optional game title for artwork",
                        )}
                        {button(
                          artBusy
                            ? "Looking up artwork…"
                            : "Look up artwork online",
                          lookupArtwork,
                        )}
                        {artMessage ? text(artMessage) : null}
                        {renderArtworkResults()}
                        {artSaving ? text("Saving artwork…") : null}
                        {stage.artwork ? text(stage.artwork.attribution) : null}
                      </>
                    ) : null}
                    {heading("Import a guide")}
                    {input(
                      gameSearch,
                      setGameSearch,
                      "Search GameFAQs for a game",
                      searchGameFAQs,
                    )}
                    {button("Search GameFAQs", searchGameFAQs)}
                    {text("Or import a URL or local file")}

                    {input(url, setUrl, "Guide URL or local file URI")}
                    {button(busy ? "Importing…" : "Import URL", () => {
                      if (!busy) runImport();
                    })}
                    {button("Import local text / HTML", () => {
                      if (!busy) localImport();
                    })}
                    {busy
                      ? button("Cancel import", () => abort.current?.abort())
                      : null}
                    {rows.length > 0 || showImport
                      ? button("Close import", () => {
                          if (busy) abort.current?.abort();
                          openHomePage("library");
                        })
                      : null}
                  </>
                ) : null}
              </>
            )}
          </ScrollView>
        </View>
      )}
      {importProgress ? (
        <Modal
          visible
          presentationStyle="fullScreen"
          onRequestClose={() => {
            if (importProgress.phase !== "saving") abort.current?.abort();
          }}
        >
          <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
            <View
              style={{ flex: 1, justifyContent: "center", padding: 24 }}
              accessibilityViewIsModal
            >
              <ActivityIndicator size="large" color={colors.text} />
              {heading(
                importProgress.phase === "saving"
                  ? "Saving guide to your library"
                  : "Capturing guide",
              )}
              <Text
                accessibilityLiveRegion="polite"
                style={{ color: colors.text, padding: 10 }}
              >
                {importProgress.phase === "pages"
                  ? `Reading page ${Math.min(importProgress.completed + 1, importProgress.total)} of ${importProgress.total} discovered pages…`
                  : importProgress.phase === "images"
                    ? `Downloading offline images: ${importProgress.completed} of ${importProgress.total}`
                    : importProgress.detail || "Saving guide…"}
              </Text>
              {text(
                importProgress.phase === "saving"
                  ? "Keep StratTome open while the guide is saved. Large guides can take a minute."
                  : "Following chapter links and collecting content for offline reading. This can take a minute.",
              )}
              {importProgress.phase !== "saving"
                ? button("Cancel import", () => abort.current?.abort())
                : null}
            </View>
          </SafeAreaView>
        </Modal>
      ) : null}
      {libraryAction ? (
        <Modal
          transparent
          visible
          onRequestClose={() => setLibraryAction(undefined)}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            style={{ flex: 1, backgroundColor: "#0009" }}
            contentContainerStyle={{
              flexGrow: 1,
              justifyContent: "center",
              padding: 24,
            }}
          >
            <View
              style={{
                backgroundColor: colors.background,
                borderRadius: 12,
                padding: 12,
              }}
            >
              {heading(renaming ? "Rename guide" : libraryAction.title)}
              {renaming ? (
                <>
                  {input(renameValue, setRenameValue, "Guide name")}
                  {button("Save name", async () => {
                    const g = await renameGuide(libraryAction.id, renameValue);
                    await refresh();
                    setLibraryAction(undefined);
                    setRenaming(false);
                    if (guide?.id === g.id) setGuide(g);
                    announce(`Renamed to ${g.title}`);
                  })}
                </>
              ) : (
                <>
                  {button("Rename", () => setRenaming(true))}
                  {button("Artwork", async () => {
                    const row = libraryAction;
                    setLibraryAction(undefined);
                    const g = await loadGuide(row.path);
                    await open(row, g);
                    setArtQuery(suggestArtworkQuery(g));
                    setArt([]);
                    setPanel("artwork");
                  })}
                  {button("Delete", async () => {
                    const row = libraryAction;
                    setLibraryAction(undefined);
                    if (
                      !(await confirmAction(
                        "Delete guide?",
                        `Remove “${row.title}” and its reading progress from this device?`,
                        "Delete",
                      ))
                    )
                      return;
                    await deleteGuide(row.id);
                    await refresh();
                    announce(`Deleted ${row.title}`);
                  })}
                </>
              )}
              {button("Cancel", () => {
                setLibraryAction(undefined);
                setRenaming(false);
                setNotice("");
              })}
              {notice ? text(notice) : null}
            </View>
          </ScrollView>
        </Modal>
      ) : null}
      {notice ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss message"
          onPress={() => setNotice("")}
          style={{
            position: "absolute",
            left: 12,
            right: 12,
            bottom: 12,
            padding: 12,
            borderRadius: 8,
            backgroundColor: colors.surface,
            borderColor: colors.accent,
            borderWidth: 1,
            elevation: 6,
          }}
        >
          <Text style={{ color: colors.text }}>{notice}</Text>
        </Pressable>
      ) : null}
    </SafeAreaView>
  );
}
