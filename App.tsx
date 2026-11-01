import "react-native-url-polyfill/auto";
import { Asset } from "expo-asset";
import { useFonts } from "expo-font";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  BackHandler,
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  Text,
  TextInput,
  View,
  useColorScheme,
} from "react-native";
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
import { theme } from "./src/theme";
import {
  Anchor,
  Guide,
  library,
  loadGuide,
  progress,
  saveGuide,
  setting,
} from "./src/storage";
import {
  Stage,
  stageImport,
  commitImport,
  artwork,
  discardStage,
  stageArtwork,
  artworkAttribution,
} from "./src/importer";
import { readerHTML } from "./src/reader";
export default function App() {
  const [fontsLoaded] = useFonts({
    ManualMono: require("./assets/ManualMono.ttf"),
  });
  const system = useColorScheme(),
    [fontUri, setFontUri] = useState<string>(),
    [readingPosition, setReadingPosition] = useState<Anchor>(),
    [mode, setMode] = useState("system"),
    [font, setFont] = useState(18),
    [rows, setRows] = useState<Awaited<ReturnType<typeof library>>>([]),
    [guide, setGuide] = useState<Guide>(),
    [anchor, setAnchor] = useState<Anchor>(),
    [panel, setPanel] = useState(""),
    [url, setUrl] = useState(""),
    [query, setQuery] = useState(""),
    [artQuery, setArtQuery] = useState(""),
    [index, setIndex] = useState(0),
    [notice, setNotice] = useState(""),
    [stage, setStage] = useState<Stage>(),
    [busy, setBusy] = useState(false),
    [focus, setFocus] = useState(0),
    [tocMode, setTocMode] = useState("headings"),
    [art, setArt] = useState<any[]>([]),
    [zoom, setZoom] = useState<string>(),
    [fixed, setFixed] = useState<string>(),
    [scale, setScale] = useState(1),
    [pan, setPan] = useState({ x: 0, y: 0 });
  const web = useRef<WebView>(null),
    abort = useRef<AbortController | undefined>(undefined),
    position = useRef<Anchor | undefined>(undefined),
    actions = useRef<(() => void)[]>([]);
  actions.current = [];
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
  }, [panel, guide?.id, zoom, fixed]);
  const colors = theme[colorMode(mode, system) as "light" | "dark"];
  const results = guide ? search(guide, query) : [];
  const refresh = async () => setRows(await library());
  const open = async (row: (typeof rows)[number]) => {
    const g = await loadGuide(row.path);
    setGuide(g);
    const a = resolveAnchor(
      g,
      row.position ? JSON.parse(row.position) : undefined,
    );
    position.current = a;
    setAnchor(a);
    setPanel("");
    setQuery("");
  };
  useEffect(() => {
    (async () => {
      try {
        setMode((await setting("mode")) || "system");
        setFont(Number(await setting("font")) || 18);
        const r = await library();
        setRows(r);
        const last = await setting("lastGuide");
        const row = r.find((x) => x.id === last);
        if (row) await open(row);
      } catch (e) {
        setNotice(String(e));
      }
    })();
  }, []);
  const announce = (s: string) => {
    setNotice(s);
    AccessibilityInfo.announceForAccessibility(s);
  };
  const turn = (direction: number) =>
    web.current?.postMessage(JSON.stringify({ type: "turn", direction }));
  const jump = (a: Anchor) => {
    position.current = a;
    setAnchor(a);
    web.current?.postMessage(JSON.stringify({ type: "anchor", anchor: a }));
    setPanel("");
  };
  const back = () => {
    if (zoom || fixed) {
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
        if (action === "back") back();
        else if (action === "menu") {
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
                f + (["down", "right"].includes(action) ? 1 : -1),
              ),
            ),
          );
      },
    );
    return () => sub?.remove();
  });
  const button = (label: string, fn: () => void, cover?: string | null) => {
    const i = actions.current.length;
    const action = () => {
      try {
        Promise.resolve(fn()).catch((e) => announce(String(e)));
      } catch (e) {
        announce(String(e));
      }
    };
    actions.current.push(action);
    return (
      <Pressable
        key={label}
        accessibilityRole="button"
        accessibilityLabel={label}
        focusable
        onLayout={(e) => buttonY.current.set(i, e.nativeEvent.layout.y)}
        onPress={action}
        onFocus={() => setFocus(i)}
        style={{
          padding: 12,
          margin: 4,
          borderRadius: 8,
          borderWidth: 2,
          borderTopColor: focus === i ? colors.accent : colors.highlight,
          borderBottomWidth: 4,
          elevation: 3,
          borderColor: focus === i ? colors.accent : colors.border,
          backgroundColor: colors.surface,
        }}
      >
        {cover ? (
          <Image
            source={{ uri: cover }}
            style={{ width: 64, height: 80, marginBottom: 8 }}
            resizeMode="cover"
          />
        ) : null}
        <Text style={{ color: colors.text, fontFamily: theme.font }}>
          {label}
        </Text>
      </Pressable>
    );
  };
  const input = (
    value: string,
    onChangeText: (s: string) => void,
    placeholder: string,
  ) => (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={colors.border}
      autoCapitalize="none"
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
    abort.current = new AbortController();
    setBusy(true);
    if (stage) discardStage(stage);
    setStage(undefined);
    try {
      setStage(await stageImport(url, abort.current.signal));
    } catch (e) {
      announce(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function finish(accept: boolean) {
    if (!stage) return;
    setBusy(true);
    abort.current = new AbortController();
    try {
      await commitImport(stage, accept, abort.current.signal);
      setStage(undefined);
      await refresh();
      announce("Guide saved offline");
    } catch (e) {
      announce(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function localImport() {
    try {
      const r = await Picker.getDocumentAsync({
        type: ["text/plain", "text/html"],
      });
      if (r.canceled) return;
      const text = await new File(r.assets[0].uri).text();
      const { extractHTML } = require("./src/core.cjs");
      if (r.assets[0].mimeType === "text/html") {
        if (stage) discardStage(stage);
        const extracted = extractHTML(text);
        const directory = new Directory(
          Paths.cache,
          `import-local-${Date.now()}`,
        );
        directory.create({ intermediates: true });
        setStage({
          title: r.assets[0].name,
          files: [{ id: "local", name: r.assets[0].name, ...extracted }],
          missing: extracted.images.map(
            (x: string) => `Local HTML image not bundled: ${x}`,
          ),
          images: [],
          assets: [],
          directory: directory.uri,
        });
        return;
      }
      const g = makeGuide(r.assets[0].name, [
        {
          id: "local",
          name: r.assets[0].name,
          ...(r.assets[0].mimeType === "text/html"
            ? extractHTML(text)
            : { text }),
        },
      ]);
      await saveGuide(g);
      await refresh();
    } catch (e) {
      announce(String(e));
    }
  }
  const heading = (s: string) => (
    <Text
      style={{
        color: colors.text,
        fontFamily: theme.font,
        fontSize: 23,
        padding: 12,
        fontWeight: "bold",
      }}
    >
      {s}
    </Text>
  );
  const text = (s: string) => (
    <Text style={{ color: colors.text, padding: 10, fontFamily: theme.font }}>
      {s}
    </Text>
  );
  const changeMatch = (d: number) => {
    const next = stepMatch(results, index, d);
    setIndex(next.index);
    if (next.message) announce(next.message);
    if (results[next.index]) jump(results[next.index]);
  };
  const trail =
    guide && anchor ? breadcrumbs(guide, position.current || anchor) : [];
  const source = useMemo(
    () =>
      guide && anchor
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
      {zoom || fixed ? (
        <>
          <ScrollView horizontal>
            <ScrollView>
              {fixed ? (
                <Text
                  style={{
                    color: colors.text,
                    fontFamily: theme.font,
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
            <Text style={{ color: colors.text, flex: 1 }}>{guide.title}</Text>
          </View>
          {panel ? (
            <ScrollView ref={scroll}>
              {panel === "menu" ? (
                <>
                  {button("Back to Library", () => {
                    setGuide(undefined);
                    setPanel("");
                    refresh();
                  })}
                  {button("Search", () => setPanel("search"))}
                  {button("Table of Contents", () => setPanel("toc"))}
                  {button("Reading Settings", () => setPanel("settings"))}
                  {button("Images and maps", () => setPanel("images"))}
                  {button("Artwork", () => setPanel("artwork"))}
                </>
              ) : panel === "search" ? (
                <>
                  {heading("Search entire guide")}
                  {input(
                    query,
                    (s) => {
                      setQuery(s);
                      setIndex(0);
                    },
                    "Literal search",
                  )}
                  {text(`${results.length} results`)}
                  {button("Previous occurrence", () => changeMatch(-1))}
                  {button("Next occurrence", () => changeMatch(1))}
                  {results.map((r: any, i: number) =>
                    button(`${i + 1}: ${r.snippet}`, () => {
                      setIndex(i);
                      jump(r);
                    }),
                  )}
                </>
              ) : panel === "toc" ? (
                <>
                  {button("Source files", () => setTocMode("files"))}
                  {button("Headings", () => setTocMode("headings"))}
                  {guide.toc
                    .filter((t) => tocMode !== "files" || t.level === 0)
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
                  {input(artQuery, setArtQuery, "Wikimedia artwork search")}
                  {button("Look up artwork online", async () => {
                    try {
                      setArt(await artwork(artQuery));
                    } catch (e) {
                      announce(String(e));
                    }
                  })}
                  {art.map((a) =>
                    button(a.title, async () => {
                      try {
                        const info = a.imageinfo[0];
                        const f = await File.downloadFileAsync(
                          info.url,
                          new File(
                            Paths.document,
                            `art-${guide.id}-${Date.now()}`,
                          ),
                          { idempotent: true },
                        );
                        const g = {
                          ...guide,
                          cover: f.uri,
                          attribution: [
                            ...guide.attribution,
                            artworkAttribution(a),
                          ],
                        };
                        await saveGuide(g);
                        setGuide(g);
                        announce("Artwork cached with attribution");
                      } catch (e) {
                        announce(String(e));
                      }
                    }),
                  )}
                  {button("Choose local artwork", async () => {
                    const r = await Picker.getDocumentAsync({
                      type: "image/*",
                    });
                    if (!r.canceled) {
                      const f = new File(
                        Paths.document,
                        `art-${guide.id}-${Date.now()}`,
                      );
                      new File(r.assets[0].uri).copy(f);
                      const g = {
                        ...guide,
                        cover: f.uri,
                      };
                      await saveGuide(g);
                      setGuide(g);
                    }
                  })}
                  {guide.attribution.map(text)}
                </>
              ) : (
                <>
                  {heading("Reading Settings")}
                  {["system", "light", "dark"].map((m) =>
                    button(`Color: ${m}${m === mode ? " ✓" : ""}`, () => {
                      setMode(m);
                      setting("mode", m);
                    }),
                  )}
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
              {button("Return to reader", () => setPanel(""))}
            </ScrollView>
          ) : (
            <>
              <Text style={{ color: colors.text, padding: 6 }}>
                {trail
                  .map((t: any) => `${t.title} (${t.position} of ${t.total})`)
                  .join(" › ")}
              </Text>
              <WebView
                ref={web}
                originWhitelist={["file://*", "about:blank"]}
                source={source!}
                allowFileAccess
                allowingReadAccessToURL={Paths.document.uri}
                javaScriptEnabled
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
                {button("◀ Page", () => turn(-1))}
                {button("Page ▶", () => turn(1))}
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
        <ScrollView ref={scroll}>
          {heading("OFFLINE\nWALKTHROUGHS")}
          {text("SUPER MANUAL · Your library, anywhere")}
          {rows.map((r) => button(r.title, () => open(r), r.cover))}
          {heading("Import a guide")}
          {input(url, setUrl, "https://… guide URL")}
          {button(busy ? "Importing…" : "Import URL", () => {
            if (!busy) runImport();
          })}
          {button("Import local text / HTML", localImport)}
          {busy ? button("Cancel import", () => abort.current?.abort()) : null}
          {stage ? (
            <>
              {text(
                `${stage.files.length} readable files; ${stage.missing.length} missing pages`,
              )}
              {stage.missing.map(text)}
              {input(artQuery, setArtQuery, "Optional Wikimedia artwork")}
              {button("Look up artwork online", async () => {
                try {
                  setArt(await artwork(artQuery));
                } catch (e) {
                  announce(String(e));
                }
              })}
              {art.map((a) =>
                button(a.title, async () => {
                  try {
                    abort.current = new AbortController();
                    setStage(
                      await stageArtwork(stage, a, abort.current.signal),
                    );
                    announce("Artwork selected with attribution");
                  } catch (e) {
                    announce(String(e));
                  }
                }),
              )}
              {stage.artwork ? text(stage.artwork.attribution) : null}
              {button(
                stage.missing.length
                  ? "Accept incomplete guide and save"
                  : "Save guide offline",
                () => finish(!!stage.missing.length),
              )}
              {button("Retry", runImport)}
            </>
          ) : null}
        </ScrollView>
      )}
      {notice ? text(notice) : null}
    </SafeAreaView>
  );
}
