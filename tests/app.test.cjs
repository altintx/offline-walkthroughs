const { test } = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path"),
  Module = require("node:module"),
  ts = require("typescript");
const { makeGuide } = require("../src/core.cjs");
// Exercise the app's event handlers and hook dependencies without native views.
function appHarness(options = {}) {
  const slots = [];
  const settings = new Map(Object.entries(options.settings || {}));
  const htmlCalls = [];
  const artworkSaves = [],
    savedGuides = [],
    announcements = [];
  class MockFile {
    constructor(...parts) {
      this.uri = parts.map((part) => part.uri || part).join("/");
    }
  }
  let cursor = 0,
    effects = [],
    htmlBuilds = 0;
  const node = (type, props, ...children) => ({
    type,
    props: props || {},
    children: children.flat(Infinity),
  });
  const hooks = {
    useState(initial) {
      const i = cursor++;
      if (!slots[i]) slots[i] = { value: initial };
      return [
        slots[i].value,
        (v) => {
          slots[i].value = typeof v === "function" ? v(slots[i].value) : v;
        },
      ];
    },
    useRef(initial) {
      const i = cursor++;
      return slots[i] || (slots[i] = { current: initial });
    },
    useMemo(fn, deps) {
      const i = cursor++,
        prev = slots[i];
      if (!prev || deps.some((v, j) => v !== prev.deps[j]))
        slots[i] = { deps, value: fn() };
      return slots[i].value;
    },
    useEffect(fn, deps) {
      const i = cursor++,
        prev = slots[i];
      if (!prev || !deps || deps.some((v, j) => v !== prev[j]))
        effects.push(fn);
      slots[i] = deps;
    },
  };
  const React = { ...hooks, createElement: node, Fragment: "Fragment" };
  const guide = makeGuide(options.title || "Minish Cap", [
    {
      id: "local",
      name: "minishcapwalkthrough.txt",
      text: fs.readFileSync("fixtures/minishcapwalkthrough.txt", "utf8"),
    },
  ]);
  const libraryRows = options.empty
    ? []
    : [
        {
          id: guide.id,
          title: guide.title,
          path: "guide",
          position: null,
          cover: null,
        },
      ];
  const alerts = [],
    timers = [],
    controllerInputs = [];
  const native = Object.fromEntries(
    [
      "Image",
      "ActivityIndicator",
      "Modal",
      "Pressable",
      "ScrollView",
      "Text",
      "TextInput",
      "View",
    ].map((name) => [name, name]),
  );
  Object.assign(native, {
    AccessibilityInfo: {
      announceForAccessibility: (value) => announcements.push(value),
    },
    Keyboard: { dismiss() {} },
    Alert: { alert: (...args) => alerts.push(args) },
    BackHandler: { addEventListener: () => ({ remove() {} }) },
    useColorScheme: () => "dark",
    useWindowDimensions: () => ({
      width: 390,
      height: 844,
      scale: 1,
      fontScale: 1,
    }),
  });
  const mocks = {
    "test:timers": {
      setTimeout: (fn, delay) => {
        timers.push({ fn, delay });
        return timers.length;
      },
      clearTimeout() {},
    },
    "./src/theme": require("./load-ts.cjs")("src/theme.ts"),
    "./src/guideBrowser": require("./load-ts.cjs")("src/guideBrowser.ts"),
    react: { ...React, default: React },
    "react-native": native,
    "react-native-url-polyfill/auto": {},
    "expo-font": { useFonts: () => [true] },
    "expo-asset": { Asset: { fromModule: () => ({}) } },
    "react-native-safe-area-context": {
      SafeAreaProvider: "Provider",
      SafeAreaView: "SafeArea",
    },
    "expo-file-system/legacy": {},
    "react-native-webview": { WebView: "WebView" },
    "expo-document-picker": {
      getDocumentAsync: async () => options.pickerResult || { canceled: true },
    },
    "expo-file-system": {
      File: MockFile,
      Paths: { document: { uri: "file:///private/" } },
    },
    "walkthrough-controller": {
      default: {
        start() {},
        addListener: (_, fn) => {
          controllerInputs.push(fn);
          return { remove() {} };
        },
      },
    },
    "./assets/ManualMono.ttf": 1,
    "./assets/strattome-map-icon.png": 2,
    "./src/storage": {
      library: async () => [...libraryRows],
      renameGuide: async (id, name) => {
        if (!name.trim()) throw Error("Enter a guide name");
        Object.assign(guide, { title: name.trim() });
        Object.assign(
          libraryRows.find((row) => row.id === id),
          { title: name.trim() },
        );
        return { ...guide };
      },
      deleteGuide: async (id) => {
        const i = libraryRows.findIndex((row) => row.id === id);
        if (i >= 0) libraryRows.splice(i, 1);
      },
      loadGuide: async () => guide,
      setting: async (key, value) => {
        if (value !== undefined) settings.set(key, value);
        return (
          settings.get(key) || (key === "lastGuide" ? guide.id : undefined)
        );
      },
      progress: async () => {},
      saveGuide: async (g) => {
        savedGuides.push(g);
      },
    },
    "./src/importer": {
      stageImport: async (...args) => {
        options.onStageImport?.(...args);
        if (options.waitForStage) await options.waitForStage;
        return {
          files: [{ id: "captured", name: "Guide", text: "Captured prose." }],
          missing: [],
          images: [],
          assets: [],
          title: "Captured guide",
          directory: "cache/browser",
        };
      },
      commitImport: async (...args) => {
        options.onCommitImport?.(...args);
        if (options.waitForCommit) await options.waitForCommit;
        return { ...guide, artworkQuery: args[0].artworkQuery };
      },
      discardStage() {},
    },
    "./src/artwork": {
      saveGuideArtwork: async (id, source, signal) => {
        artworkSaves.push({ id, source, signal });
        const updated = options.artworkSave
          ? await options.artworkSave(id, source)
          : {
              ...guide,
              cover: "file:///private/cached-cover",
              attribution: ["Cover credit and source"],
            };
        savedGuides.push(updated);
        return updated;
      },
      artwork: async (query, source) => {
        options.onArtworkSearch?.(query, source);
        if (options.artworkSearch) return options.artworkSearch(query);
        return [
          {
            title: "Minish Cap cover",
            imageinfo: [{ url: "https://upload.wikimedia.org/cover.png" }],
          },
        ];
      },
      artworkHeaders: { "User-Agent": "StratTome/0.1" },
      artworkAttribution: () => "Cover credit and source",
    },
    "./src/reader": {
      readerHTML: (...args) => {
        htmlCalls.push(args);
        htmlBuilds++;
        return "<html></html>";
      },
    },
  };
  const filename = path.resolve("App.tsx"),
    mod = new Module(filename);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = mod.require.bind(mod);
  mod.require = (id) => (Object.hasOwn(mocks, id) ? mocks[id] : original(id));
  mod._compile(
    'const {setTimeout, clearTimeout} = require("test:timers");\n' +
      ts.transpileModule(fs.readFileSync(filename, "utf8"), {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          jsx: ts.JsxEmit.React,
        },
      }).outputText,
    filename,
  );
  const component = mod.exports.default().children[0].type;
  const render = () => {
    cursor = 0;
    return component();
  };
  const walk = (root) =>
    root && typeof root === "object"
      ? [root, ...(root.children || []).flatMap(walk)]
      : [];
  const button = (root, label) =>
    walk(root).find(
      (n) => n.type === "Pressable" && n.props.accessibilityLabel === label,
    );
  return {
    render,
    walk,
    button,
    htmlBuilds: () => htmlBuilds,
    htmlCalls,
    artworkSaves,
    savedGuides,
    settings,
    announcements,
    guide,
    libraryRows,
    alerts,
    timers,
    controllerInput: (action) => controllerInputs.at(-1)({ action }),
    flushEffects() {
      const pending = effects;
      effects = [];
      for (const effect of pending) effect();
    },
    async boot() {
      render();
      const pending = effects;
      effects = [];
      for (const effect of pending) effect();
      await new Promise(setImmediate);
      let root = render();
      if (!options.home && !options.empty) {
        button(root, guide.title).props.onPress();
        await new Promise(setImmediate);
        root = render();
      }
      return root;
    },
  };
}
test("submitted sword search finds 111 results without building reader HTML while typing", async () => {
  const h = appHarness();
  let root = await h.boot();
  h.button(root, "☰").props.onPress();
  root = h.render();
  h.button(root, "Search").props.onPress();
  root = h.render();
  const builds = h.htmlBuilds();
  for (const value of ["s", "sw", "swo", "swor", "sword"]) {
    h.walk(root)
      .find((n) => n.type === "TextInput")
      .props.onChangeText(value);
    root = h.render();
    assert.equal(h.htmlBuilds(), builds);
    assert.ok(h.walk(root).filter((n) => n.type === "Pressable").length < 40);
  }
  h.button(root, "Search").props.onPress();
  root = h.render();
  assert.ok(
    h
      .walk(root)
      .some(
        (n) =>
          n.type === "Text" && n.children.includes("111 matches for “sword”"),
      ),
  );
  assert.equal(h.htmlBuilds(), builds);
  assert.ok(h.walk(root).filter((n) => n.type === "Pressable").length < 40);
});
test("common-letter searches bound the initial native result list", async () => {
  const h = appHarness();
  let root = await h.boot();
  h.button(root, "☰").props.onPress();
  root = h.render();
  h.button(root, "Search").props.onPress();
  root = h.render();
  h.walk(root)
    .find((n) => n.type === "TextInput")
    .props.onChangeText("s");
  root = h.render();
  h.button(root, "Search").props.onPress();
  root = h.render();
  assert.ok(h.walk(root).filter((n) => n.type === "Pressable").length < 40);
  assert.ok(
    h
      .walk(root)
      .some(
        (n) =>
          n.type === "Pressable" &&
          n.props.accessibilityLabel.startsWith("Show more matches"),
      ),
  );
});
test("position reports do not rebuild the reader and each page press sends one identified command", async () => {
  const h = appHarness();
  let root = await h.boot(),
    view = h.walk(root).find((n) => n.type === "WebView");
  const builds = h.htmlBuilds();
  view.props.onMessage({
    nativeEvent: {
      data: JSON.stringify({
        type: "position",
        fileId: "local",
        blockId: "test",
        offset: 10,
        page: 2,
        pages: 100,
      }),
    },
  });
  root = h.render();
  assert.equal(h.htmlBuilds(), builds);
  view = h.walk(root).find((n) => n.type === "WebView");
  const commands = [];
  view.props.ref.current = {
    postMessage: (message) => commands.push(JSON.parse(message)),
  };
  h.controllerInput("next");
  assert.deepEqual(commands, [{ type: "turn", direction: 1, commandId: 1 }]);
  h.controllerInput("previous");
  assert.deepEqual(commands.at(-1), {
    type: "turn",
    direction: -1,
    commandId: 2,
  });
  assert.equal(h.htmlBuilds(), builds);
});

test("Close search clears results and highlight while preserving the reading passage", async () => {
  const h = appHarness();
  let root = await h.boot();
  h.button(root, "☰").props.onPress();
  root = h.render();
  h.button(root, "Search").props.onPress();
  root = h.render();
  h.walk(root)
    .find((n) => n.type === "TextInput")
    .props.onChangeText("sword");
  root = h.render();
  h.button(root, "Search").props.onPress();
  root = h.render();
  h.button(root, "Show first match").props.onPress();
  root = h.render();
  assert.ok(h.button(root, "Close search"));
  const a = {
    fileId: "local",
    blockId: h.guide.files[0].blocks[100].id,
    offset: 3,
  };
  h.walk(root)
    .find((n) => n.type === "WebView")
    .props.onMessage({
      nativeEvent: {
        data: JSON.stringify({ type: "position", ...a, page: 58, pages: 500 }),
      },
    });
  root = h.render();
  h.button(root, "Close search").props.onPress();
  root = h.render();
  assert.equal(h.button(root, "Previous match"), undefined);
  assert.equal(h.button(root, "Close search"), undefined);
  const args = h.htmlCalls.at(-1);
  assert.equal(args[1].blockId, a.blockId);
  assert.equal(args[1].offset, a.offset);
  assert.equal(args[4], undefined);
});
test("populated home has one guide card, long-press actions and a separate import form", async () => {
  const h = appHarness({ home: true });
  let root = await h.boot();
  assert.equal(h.walk(root).filter((n) => n.type === "TextInput").length, 0);
  assert.equal(h.button(root, "Delete Minish Cap"), undefined);
  assert.ok(
    !h
      .walk(root)
      .some(
        (n) =>
          n.type === "Text" &&
          n.children.some(
            (x) => typeof x === "string" && x.includes("SUPER MANUAL"),
          ),
      ),
  );
  assert.ok(h.button(root, "Minish Cap").props.onLongPress);
  h.button(root, "Import").props.onPress();
  root = h.render();
  assert.ok(
    h
      .walk(root)
      .some(
        (n) =>
          n.type === "TextInput" &&
          n.props.placeholder === "Guide URL or local file URI",
      ),
  );
  assert.equal(h.button(root, "Minish Cap"), undefined);
  h.button(root, "Close import").props.onPress();
  root = h.render();
  h.button(root, "Minish Cap").props.onLongPress();
  root = h.render();
  assert.ok(h.button(root, "Rename"));
  assert.ok(h.button(root, "Delete"));
  h.button(root, "Rename").props.onPress();
  root = h.render();
  h.walk(root)
    .find((n) => n.type === "TextInput")
    .props.onChangeText("The Minish Cap");
  root = h.render();
  h.button(root, "Save name").props.onPress();
  await new Promise(setImmediate);
  root = h.render();
  assert.ok(h.button(root, "The Minish Cap"));
  assert.equal(h.guide.title, "The Minish Cap");
  assert.equal(h.walk(root).filter((n) => n.type === "Modal").length, 0);
});
test("empty home shows import inline and deletion is offered only in the guide menu", async () => {
  const empty = appHarness({ home: true, empty: true }),
    view = await empty.boot();
  assert.ok(empty.button(view, "Import local text / HTML"));
  const h = appHarness({ home: true });
  let root = await h.boot();
  h.button(root, "Minish Cap").props.onLongPress();
  root = h.render();
  h.button(root, "Delete").props.onPress();
  assert.equal(h.libraryRows.length, 1);
  h.alerts
    .at(-1)[2]
    .find((b) => b.text === "Delete")
    .onPress();
  await new Promise(setImmediate);
  root = h.render();
  assert.equal(h.libraryRows.length, 0);
  assert.ok(h.button(root, "Import local text / HTML"));
});
test("status messages can be dismissed and expire after six seconds without shrinking the reader", async () => {
  const h = appHarness({ home: true });
  let root = await h.boot();
  h.button(root, "Minish Cap").props.onLongPress();
  root = h.render();
  h.button(root, "Rename").props.onPress();
  root = h.render();
  h.walk(root)
    .find((n) => n.type === "TextInput")
    .props.onChangeText("New name");
  root = h.render();
  h.button(root, "Save name").props.onPress();
  await new Promise(setImmediate);
  root = h.render();
  assert.equal(
    h.button(root, "Dismiss message").props.style.position,
    "absolute",
  );
  h.flushEffects();
  const timer = h.timers.find((t) => t.delay === 6000);
  assert.ok(timer);
  timer.fn();
  root = h.render();
  assert.equal(h.button(root, "Dismiss message"), undefined);
});
test("reader no longer renders previous/next page buttons", async () => {
  const h = appHarness(),
    root = await h.boot();
  assert.equal(h.button(root, "◀ Page"), undefined);
  assert.equal(h.button(root, "Page ▶"), undefined);
  assert.ok(h.walk(root).some((n) => n.type === "WebView"));
});

test("artwork search suggests the game title and previews carry the app identity", async () => {
  const h = appHarness({ title: "minishcapwalkthrough.txt" });
  let root = await h.boot();
  h.button(root, "☰").props.onPress();
  root = h.render();
  h.button(root, "Artwork").props.onPress();
  root = h.render();
  const field = h.walk(root).find((n) => n.type === "TextInput");
  assert.equal(field.props.value, "The Legend of Zelda: The Minish Cap");
  h.button(root, "Look up artwork online").props.onPress();
  await new Promise(setImmediate);
  root = h.render();
  const image = h.walk(root).find((n) => n.type === "Image");
  assert.match(image.props.source.headers["User-Agent"], /StratTome/);
  assert.equal(image.props.resizeMode, "contain");
});

async function artworkResults(h) {
  let root = await h.boot();
  h.button(root, "☰").props.onPress();
  root = h.render();
  h.button(root, "Artwork").props.onPress();
  root = h.render();
  h.button(root, "Look up artwork online").props.onPress();
  await new Promise(setImmediate);
  return h.render();
}
test("selecting artwork delegates to the shared save service and reports one completion", async () => {
  const h = appHarness();
  let root = await artworkResults(h);
  h.button(root, "Minish Cap cover").props.onPress();
  await new Promise(setImmediate);
  root = h.render();
  assert.equal(h.artworkSaves.length, 1);
  assert.equal(h.artworkSaves[0].id, h.guide.id);
  assert.equal(h.savedGuides[0].cover, "file:///private/cached-cover");
  assert.deepEqual(h.announcements, ["Artwork saved"]);
});
test("rapid artwork selections start one save even before the first rerender", async () => {
  let finish;
  const pending = new Promise((resolve) => (finish = resolve));
  const h = appHarness({ artworkSave: () => pending });
  let root = await artworkResults(h);
  const choose = h.button(root, "Minish Cap cover");
  choose.props.onPress();
  choose.props.onPress();
  assert.equal(h.artworkSaves.length, 1);
  root = h.render();
  assert.ok(
    h
      .walk(root)
      .some((n) => n.type === "Text" && n.children.includes("Saving artwork…")),
  );
  finish({ ...h.guide, cover: "file:///private/cover" });
  await new Promise(setImmediate);
  root = h.render();
  assert.deepEqual(h.announcements, ["Artwork saved"]);
  assert.equal(h.savedGuides.length, 1);
});
test("a failed artwork selection reports only failure and permits an explicit retry", async () => {
  let attempts = 0;
  const h = appHarness({
    artworkSave: () => {
      if (++attempts === 1) throw Error("save failed");
      return { ...h.guide, cover: "file:///private/cover" };
    },
  });
  let root = await artworkResults(h);
  h.button(root, "Minish Cap cover").props.onPress();
  await new Promise(setImmediate);
  root = h.render();
  assert.deepEqual(h.announcements, ["Error: save failed"]);
  assert.equal(h.savedGuides.length, 0);
  h.button(root, "Minish Cap cover").props.onPress();
  await new Promise(setImmediate);
  assert.deepEqual(h.announcements, ["Error: save failed", "Artwork saved"]);
  assert.equal(h.savedGuides.length, 1);
});
test("canceling the local artwork picker neither saves nor announces success", async () => {
  const h = appHarness();
  const root = await artworkResults(h);
  h.button(root, "Choose local artwork").props.onPress();
  await new Promise(setImmediate);
  assert.equal(h.artworkSaves.length, 0);
  assert.deepEqual(h.announcements, []);
});
test("GameFAQs browsing is a third import path with exclusive progress, automatic artwork and review before saving", async () => {
  let imported, finishCapture, finishSave, saved;
  const searches = [],
    artworkSources = [];
  const waitForStage = new Promise((resolve) => (finishCapture = resolve));
  const waitForCommit = new Promise((resolve) => (finishSave = resolve));
  const h = appHarness({
    home: true,
    waitForStage,
    waitForCommit,
    onArtworkSearch: (query, source) => {
      searches.push(query);
      artworkSources.push(source);
    },
    onCommitImport: (...args) => (saved = args),
    onStageImport: (...args) => {
      imported = args;
    },
  });
  let root = await h.boot();
  h.button(root, "Import").props.onPress();
  root = h.render();
  assert.ok(h.button(root, "Import URL"));
  assert.ok(h.button(root, "Import local text / HTML"));
  h.walk(root)
    .find(
      (n) =>
        n.type === "TextInput" &&
        n.props.placeholder === "Search GameFAQs for a game",
    )
    .props.onChangeText("super mario world");
  root = h.render();
  h.button(root, "Search GameFAQs").props.onPress();
  root = h.render();
  let view = h.walk(root).find((n) => n.type === "WebView");
  assert.equal(
    new URL(view.props.source.uri).searchParams.get("game"),
    "super mario world",
  );
  const source = view.props.source,
    guideURL = "https://gamefaqs.gamespot.com/snes/123-mario/faqs/456";
  // Searching again inside GameFAQs should update the artwork query too.
  view.props.onNavigationStateChange({
    url: "https://gamefaqs.gamespot.com/search?game=super+mario+world+snes",
    title: "Search",
    loading: false,
    canGoBack: true,
    canGoForward: false,
  });
  view.props.onNavigationStateChange({
    url: guideURL,
    title: "Mario walkthrough",
    loading: false,
    canGoBack: true,
    canGoForward: false,
  });
  root = h.render();
  view = h.walk(root).find((n) => n.type === "WebView");
  assert.equal(view.props.source, source);
  const vm = require("node:vm");
  view.props.ref.current = {
    injectJavaScript: (script) => {
      const element = (tag) => ({
        textContent: "",
        get outerHTML() {
          return "<" + tag + ">" + this.textContent + "</" + tag + ">";
        },
      });
      vm.runInNewContext(script, {
        URL,
        location: { href: guideURL, origin: "https://gamefaqs.gamespot.com" },
        document: {
          title: "Mario walkthrough",
          querySelector: () => ({
            textContent: "Loaded guide prose.",
            outerHTML: '<div id="faqtext">Loaded guide prose.</div>',
          }),
          querySelectorAll: () => [],
          createElement: element,
        },
        window: {
          ReactNativeWebView: {
            postMessage: (data) =>
              view.props.onMessage({ nativeEvent: { data, url: guideURL } }),
          },
        },
      });
    },
  };
  h.button(root, "Import this guide").props.onPress();
  await new Promise(setImmediate);
  root = h.render();
  let progressScreen = h
    .walk(root)
    .find((n) => n.type === "Modal" && n.props.visible);
  assert.ok(progressScreen);
  assert.equal(progressScreen.props.presentationStyle, "fullScreen");
  assert.ok(h.walk(progressScreen).some((n) => n.type === "ActivityIndicator"));
  assert.deepEqual(searches, ["super mario world snes"]);
  assert.deepEqual(artworkSources, [guideURL]);
  imported[2].onProgress({ phase: "pages", completed: 7, total: 38 });
  root = h.render();
  assert.ok(JSON.stringify(root).includes("Reading page 8 of 38"));
  finishCapture();
  await new Promise(setImmediate);
  root = h.render();
  assert.equal(
    h.walk(root).some((n) => n.type === "Modal" && n.props.visible),
    false,
  );
  assert.equal(imported[0], guideURL);
  assert.match(imported[2].initialPage.html, /Loaded guide prose/);
  assert.equal(typeof imported[2].fetchPage, "function");
  assert.ok(h.button(root, "Import URL"));
  assert.ok(h.button(root, "Import local text / HTML"));
  assert.ok(h.button(root, "Save guide offline"));
  assert.ok(
    JSON.stringify(root).includes("This guide is not in your library yet."),
  );
  assert.ok(JSON.stringify(root).includes("You can save without artwork"));
  assert.equal(
    h
      .walk(root)
      .some((n) => n.props?.title === "Retry" || n.props?.children === "Retry"),
    false,
  );

  assert.equal(
    h.walk(root).find((n) => n.type === "WebView"),
    undefined,
  );
  const save = h.button(root, "Save guide offline");
  save.props.onPress();
  save.props.onPress();
  await new Promise(setImmediate);
  root = h.render();
  progressScreen = h
    .walk(root)
    .find((n) => n.type === "Modal" && n.props.visible);
  assert.ok(
    JSON.stringify(progressScreen).includes("Saving guide to your library"),
  );
  assert.equal(h.button(progressScreen, "Cancel import"), undefined);
  assert.equal(saved[0].artworkQuery, "super mario world snes");
  finishSave();
  await new Promise(setImmediate);
  root = h.render();
  assert.equal(
    h.walk(root).some((n) => n.type === "Modal" && n.props.visible),
    false,
  );
  // A later artwork lookup must retain the original search, not the verbose title.
  h.button(root, "☰").props.onPress();
  root = h.render();
  h.button(root, "Artwork").props.onPress();
  root = h.render();
  assert.ok(
    h
      .walk(root)
      .some(
        (n) =>
          n.type === "TextInput" && n.props.value === "super mario world snes",
      ),
  );
});
test("closing browser capture cancels its pending request and retains both original import paths", async () => {
  let staged = 0;
  const h = appHarness({ home: true, onStageImport: () => staged++ });
  let root = await h.boot();
  h.button(root, "Import").props.onPress();
  root = h.render();
  h.walk(root)
    .find(
      (n) =>
        n.type === "TextInput" &&
        n.props.placeholder === "Search GameFAQs for a game",
    )
    .props.onChangeText("mario");
  root = h.render();
  h.button(root, "Search GameFAQs").props.onPress();
  root = h.render();
  let view = h.walk(root).find((n) => n.type === "WebView");
  assert.equal(
    view.props.onShouldStartLoadWithRequest({
      url: "file:///private/guide",
      isTopFrame: true,
    }),
    false,
  );
  assert.equal(
    view.props.onShouldStartLoadWithRequest({
      url: "https://other.example/",
      isTopFrame: true,
    }),
    false,
  );
  view.props.onNavigationStateChange({
    url: "https://gamefaqs.gamespot.com/game/faqs/123",
    title: "Guide",
    loading: false,
    canGoBack: false,
    canGoForward: false,
  });
  root = h.render();
  view = h.walk(root).find((n) => n.type === "WebView");
  view.props.ref.current = { injectJavaScript: () => {} };
  h.button(root, "Import this guide").props.onPress();
  root = h.render();
  h.button(root, "Close").props.onPress();
  await new Promise(setImmediate);
  root = h.render();
  assert.equal(staged, 0);
  assert.equal(
    h.walk(root).find((n) => n.type === "WebView"),
    undefined,
  );
  assert.ok(h.button(root, "Import URL"));
  assert.ok(h.button(root, "Import local text / HTML"));
  assert.ok(h.announcements.some((text) => /Import cancelled/.test(text)));
});
test("all console themes can be selected, persist, and supply their palette to the reader", async () => {
  const { themes } = require("./load-ts.cjs")("src/theme.ts");
  const h = appHarness({ home: true });
  let root = await h.boot();
  for (const id of ["read-cube", "read-station", "read-box"]) {
    h.button(root, "Settings").props.onPress();
    root = h.render();
    assert.ok(
      !JSON.stringify(root).includes("No other themes are available yet."),
    );
    for (const name of ["Read Cube", "Read Station", "Read Box"])
      assert.ok(
        h
          .walk(root)
          .some(
            (n) =>
              n.type === "Pressable" &&
              n.props.accessibilityLabel.startsWith(name),
          ),
      );
    h.button(root, themes[id].name).props.onPress();
    await new Promise(setImmediate);
    root = h.render();
    assert.equal(h.settings.get("theme"), id);
    assert.ok(h.button(root, themes[id].name + " ✓"));
    assert.equal(root.props.style.backgroundColor, themes[id].dark.background);
    h.button(root, "Back to library").props.onPress();
    root = h.render();
    h.button(root, h.guide.title).props.onPress();
    await new Promise(setImmediate);
    root = h.render();
    assert.deepEqual(h.htmlCalls.at(-1)[3], themes[id].dark);
    // The native reader's Library action also works without controller hardware.
    root = h.render();
    h.button(root, "☰").props.onPress();
    root = h.render();
    h.button(root, "Back to Library").props.onPress();
    root = h.render();
  }
  const restored = appHarness({ home: true, settings: { theme: "read-box" } });
  const restoredRoot = await restored.boot();
  assert.equal(
    restoredRoot.props.style.backgroundColor,
    themes["read-box"].dark.background,
  );
});
