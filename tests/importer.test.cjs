const { test } = require("node:test"),
  assert = require("node:assert/strict");
const load = require("./load-ts.cjs");
const files = new Map(),
  dirs = new Set();
let committed = [];
class Directory {
  constructor(...parts) {
    this.uri = parts.map((p) => p.uri || p).join("/");
  }
  create() {
    dirs.add(this.uri);
  }
  get exists() {
    return dirs.has(this.uri);
  }
  delete() {
    dirs.delete(this.uri);
    for (const key of files.keys())
      if (key.startsWith(this.uri + "/")) files.delete(key);
  }
}
class File {
  constructor(...parts) {
    this.uri = parts.map((p) => p.uri || p).join("/");
  }
  write(x) {
    files.set(this.uri, x);
  }
  get exists() {
    return files.has(this.uri);
  }
  copy(f) {
    files.set(f.uri, files.get(this.uri));
  }
  delete() {
    files.delete(this.uri);
  }
}
const artwork = load("src/artwork.ts", {
  "expo-file-system": {
    Directory,
    File,
    Paths: { document: "private", cache: "cache" },
  },
  "./storage": {},
});
const importer = load("src/importer.ts", {
  "expo-file-system": {
    Directory,
    File,
    Paths: { document: "private", cache: "cache" },
  },
  "./storage": { saveGuide: async (g) => committed.push(g) },
  "./artwork": artwork,
});
const base = "https://example.org/guide";
test("stages all selected pages, keeps images inline, commits only after review", async () => {
  committed = [];
  const requested = [];
  global.fetch = async (url) => {
    requested.push(url);
    return url.endsWith(".png")
      ? {
          ok: true,
          headers: new Headers({ "content-type": "image/png" }),
          arrayBuffer: async () => new Uint8Array([1, 2]).buffer,
        }
      : {
          ok: true,
          url,
          text: async () =>
            url.includes("page=2")
              ? "<main><p>Last passage.</p></main>"
              : '<main><h1>Manual</h1><p>First passage.</p><img src="/map.png"><p>After map.</p><a href="?page=2">Next</a><a href="https://evil.org/guide">Escape</a></main>',
        };
  };
  const s = await importer.stageImport(base, new AbortController().signal);
  assert.equal(s.files.length, 2);
  assert.equal(committed.length, 0);
  assert.ok(!requested.some((u) => u.includes("evil.org")));
  const g = await importer.commitImport(s, false, new AbortController().signal);
  assert.equal(committed.length, 1);
  assert.ok(
    g.files[0].blocks.some(
      (b) => b.kind === "image" && b.text === "https://example.org/map.png",
    ),
  );
  assert.equal(g.assets.length, 1);
  assert.ok(!dirs.has(s.directory));
});
test("blocked pages and missing images require acceptance with attribution", async () => {
  committed = [];
  global.fetch = async (url) =>
    url.includes("page=2") || url.endsWith(".png")
      ? { ok: false, status: 403 }
      : {
          ok: true,
          url,
          text: async () =>
            '<main><p>Readable prose.</p><img src="/missing.png"><a href="?page=2">Next</a></main>',
        };
  const s = await importer.stageImport(base, new AbortController().signal);
  assert.equal(s.missing.length, 2);
  await assert.rejects(
    importer.commitImport(s, false, new AbortController().signal),
  );
  assert.equal(committed.length, 0);
  const g = await importer.commitImport(s, true, new AbortController().signal);
  assert.equal(
    g.attribution.filter((x) => x.includes("Missing content accepted")).length,
    2,
  );
});
test("cancellation removes staging files and never commits", async () => {
  committed = [];
  const c = new AbortController();
  global.fetch = async () => {
    c.abort();
    throw Error("aborted");
  };
  await assert.rejects(importer.stageImport(base, c.signal));
  assert.equal(committed.length, 0);
  assert.ok(![...dirs].some((x) => x.startsWith("cache/import-")));
});
test("GameFAQs preformatted prose reflows while maps stay fixed", async () => {
  global.fetch = async (url) => ({
    ok: true,
    url,
    text: async () =>
      '<div id="faqtext"><pre>INTRODUCTION\n\n' +
      "Preserve these exact words and punctuation.\n".repeat(8) +
      "\n  +---+\n  | X |\n  +---+</pre></div>",
  });
  const s = await importer.stageImport(
    "https://gamefaqs.gamespot.com/pc/123-game/faqs/456",
    new AbortController().signal,
  );
  assert.equal(s.files.length, 1);
  assert.ok(
    s.files[0].blocks.some(
      (b) => b.kind === "paragraph" && !b.text.includes("\n"),
    ),
  );
  assert.ok(
    s.files[0].blocks.some((b) => b.kind === "pre" && b.text.includes("| X |")),
  );
  importer.discardStage(s);
});
test("imports support React Native AbortSignal without throwIfAborted", async () => {
  const c = new (require("abort-controller").AbortController)();
  global.fetch = async (url) => ({
    ok: true,
    url,
    text: async () => "<main><p>Native signal passage.</p></main>",
  });
  const s = await importer.stageImport(base, c.signal);
  assert.equal(s.files.length, 1);
  importer.discardStage(s);
});
test("artwork identifies the app and returns Wikipedia box art in search order when Commons rejects the request", async () => {
  const requests = [];
  global.fetch = async (raw, options) => {
    const url = new URL(raw);
    requests.push({ url, options });
    assert.match(options.headers["User-Agent"], /StratTome/);
    if (url.hostname === "commons.wikimedia.org")
      return { ok: false, status: 403 };
    if (url.searchParams.has("generator"))
      return {
        ok: true,
        json: async () => ({
          query: {
            pages: {
              1: {
                title: "Other game",
                index: 2,
                pageimage: "Other_cover.jpg",
              },
              2: {
                title: "The Minish Cap",
                index: 1,
                pageimage: "Minish_cover.jpg",
              },
            },
          },
        }),
      };
    return {
      ok: true,
      json: async () => ({
        query: {
          pages: {
            3: {
              title: "File:Other cover.jpg",
              imageinfo: [{ url: "https://upload.wikimedia.org/other.jpg" }],
            },
            4: {
              title: "File:Minish cover.jpg",
              imageinfo: [
                {
                  url: "https://upload.wikimedia.org/original.jpg",
                  thumburl: "https://upload.wikimedia.org/500px-cover.jpg",
                  descriptionurl:
                    "https://en.wikipedia.org/wiki/File:Minish_cover.jpg",
                  extmetadata: {
                    Artist: { value: "Nintendo" },
                    LicenseShortName: { value: "Non-free cover" },
                  },
                },
              ],
            },
          },
        },
      }),
    };
  };
  const items = await artwork.artwork("The Minish Cap");
  assert.equal(items[0].title, "The Minish Cap");
  assert.equal(
    items[0].imageinfo[0].url,
    "https://upload.wikimedia.org/500px-cover.jpg",
  );
  assert.match(
    artwork.artworkAttribution(items[0]),
    /Nintendo.*Non-free cover/,
  );
  assert.ok(
    requests.some((r) => r.url.searchParams.get("pilicense") === "any"),
  );
});
test("artwork validates empty input and reports a rejected provider with local-image guidance", async () => {
  let called = 0;
  global.fetch = async () => {
    called++;
    return { ok: false, status: 403 };
  };
  await assert.rejects(artwork.artwork(" "), /Enter the game's title/);
  assert.equal(called, 0);
  await assert.rejects(
    artwork.artwork("Minish Cap"),
    /HTTP 403.*choose a local image/,
  );
});
test("replacing an imported guide can preserve its renamed display title without changing identity", async () => {
  const stage = {
    title: "file.txt",
    files: [{ id: "local", name: "file.txt", text: "Keep this passage." }],
    missing: [],
    images: [],
    assets: [],
    directory: "cache/renamed",
  };
  new Directory(stage.directory).create();
  const expected = require("../src/core.cjs").makeGuide(
    stage.title,
    stage.files,
  );
  const g = await importer.commitImport(
    stage,
    false,
    new AbortController().signal,
    true,
    "The Minish Cap",
  );
  assert.equal(g.id, expected.id);
  assert.equal(g.title, "The Minish Cap");
});
test("browser capture uses loaded guide HTML and its session for linked sections without refetching the root", async () => {
  const root = "https://gamefaqs.gamespot.com/snes/123-game/faqs/456";
  const calls = [];
  global.fetch = async () => {
    throw Error("native fetch must not be used");
  };
  const html =
    '<title>Mario guide</title><div id="faqtext"><p>' +
    "Explore the first level carefully. ".repeat(12) +
    '</p><a href="' +
    root +
    '/chapter-2">Next section</a></div>';
  const s = await importer.stageImport(
    root + "#intro",
    new AbortController().signal,
    {
      initialPage: { url: root + "#intro", html },
      fetchPage: async (url) => {
        calls.push(url);
        return {
          url,
          html:
            '<div id="faqtext"><p>' +
            "Continue through the second level. ".repeat(12) +
            "</p></div>",
        };
      },
    },
  );
  assert.deepEqual(calls, [root + "/chapter-2"]);
  assert.equal(s.files.length, 2);
  assert.equal(s.missing.length, 0);
  assert.equal(s.title, "Mario guide");
  assert.ok(s.files[0].text.includes("first level"));
  assert.ok(s.files[1].text.includes("second level"));
  importer.discardStage(s);
});
test("browser import discloses blocked linked sections and rejects a mismatched captured page", async () => {
  const root = "https://gamefaqs.gamespot.com/snes/123-game/faqs/456",
    html =
      '<div id="faqtext"><p>' +
      "Readable browser guide content. ".repeat(12) +
      '</p><a href="' +
      root +
      '/chapter-2">Next</a></div>';
  global.fetch = async () => {
    throw Error("unexpected native fetch");
  };
  const s = await importer.stageImport(root, new AbortController().signal, {
    initialPage: { url: root, html },
    fetchPage: async () => {
      throw Error("Linked page needs a browser check");
    },
  });
  assert.equal(s.files.length, 1);
  assert.match(s.missing[0], /chapter-2.*browser check/);
  await assert.rejects(
    importer.commitImport(s, false, new AbortController().signal),
  );
  importer.discardStage(s);
  await assert.rejects(
    importer.stageImport(root, new AbortController().signal, {
      initialPage: { url: root.replace("/456", "/999"), html },
    }),
    /does not match/,
  );
});
test("formatted browser chapters retain readable file names and heading destinations", async () => {
  const root =
    "https://gamefaqs.gamespot.com/snes/588436-the-legend-of-zelda-a-link-to-the-past/faqs/77032";
  const prose = "Explore the chapter carefully and save your progress. ".repeat(
    8,
  );
  global.fetch = async () => {
    throw Error("unexpected native fetch");
  };
  const s = await importer.stageImport(root, new AbortController().signal, {
    initialPage: {
      url: root,
      html:
        '<title>Chapter guide</title><article class="faqtext"><h2>Introduction</h2><p>' +
        prose +
        '</p><h4 id="saving">Continuing and Saving</h4><p>Keep your progress.</p></article><nav><a href="' +
        root +
        '/prologue">Prologue</a></nav>',
    },
    fetchPage: async (url) => ({
      url,
      html:
        '<article class="faqtext"><h2>Prologue</h2><h4>A Hidden Path</h4><p>' +
        prose +
        "</p></article>",
    }),
  });
  assert.deepEqual(
    s.files.map((f) => f.name),
    ["Introduction", "Prologue"],
  );
  const g = require("../src/core.cjs").makeGuide(s.title, s.files);
  assert.ok(g.toc.some((t) => t.title === "Continuing and Saving"));
  assert.ok(g.toc.some((t) => t.title === "A Hidden Path"));
  assert.equal(s.missing.length, 0);
  importer.discardStage(s);
});
test("short structured HTML blocks count together as readable guide content and progress reports both capture and save", async () => {
  const root = "https://gamefaqs.gamespot.com/snes/588436-zelda/faqs/77032";
  const reports = [],
    savedReports = [];
  const html =
    '<article class="faqtext"><h2>Appendix</h2><h3>Pieces of Heart</h3>' +
    Array.from(
      { length: 6 },
      (_, i) => "<p>Location " + i + ": Search beside the marked path.</p>",
    ).join("") +
    "</article>";
  global.fetch = async () => {
    throw Error("unexpected native fetch");
  };
  const s = await importer.stageImport(root, new AbortController().signal, {
    initialPage: { url: root, html },
    onProgress: (p) => reports.push(p),
  });
  assert.equal(s.files.length, 1);
  assert.equal(s.missing.length, 0);
  assert.ok(reports.some((p) => p.phase === "pages" && p.total === 1));
  assert.ok(
    reports.some((p) => p.phase === "images" && p.completed === p.total),
  );
  assert.equal(s.files[0].name, "Appendix: Pieces of Heart");
  s.artworkQuery = "link to the past";
  const g = await importer.commitImport(
    s,
    false,
    new AbortController().signal,
    false,
    undefined,
    (p) => savedReports.push(p),
  );
  assert.equal(g.artworkQuery, "link to the past");
  assert.equal(savedReports[0].phase, "saving");
  assert.equal(savedReports.at(-1).completed, savedReports.at(-1).total);
});
test('GameFAQs HTML text imports use wrapped decimal-colon heading rules for the full TOC',async()=>{
 const text=require('node:fs').readFileSync('tests/guide-fixtures/supermetroid-heading-style.txt','utf8');
 const html='<title>Super Metroid - Guide - GameFAQs</title><pre id="faqtext">'+text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</pre>';
 const root='https://gamefaqs.gamespot.com/snes/588741-super-metroid/faqs/39375';
 const s=await importer.stageImport(root,new AbortController().signal,{initialPage:{url:root,html}});
 assert.equal(s.missing.length,0);const g=require('../src/core.cjs').makeGuide(s.title,s.files);const entries=g.toc.filter(t=>t.level>0 && /^\d/.test(t.title));
 assert.equal(entries.length,28);assert.equal(entries.filter(t=>t.level===1).length,10);assert.equal(entries.filter(t=>t.level===2).length,18);assert.ok(entries.some(t=>t.title==='4.9 1/2: Ending.'));
 importer.discardStage(s);
});
test('GameFAQs imports retain framed section titles and Roman numeral subsection destinations',async()=>{
 const text=require('node:fs').readFileSync('tests/guide-fixtures/oracle-heading-style.txt','utf8');
 const html='<title>Oracle guide - GameFAQs</title><pre id="faqtext">'+text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</pre>';
 const root='https://gamefaqs.gamespot.com/gbc/198972-the-legend-of-zelda-oracle-of-seasons/faqs/10780';
 const s=await importer.stageImport(root,new AbortController().signal,{initialPage:{url:root,html}});
 assert.equal(s.missing.length,0);const g=require('../src/core.cjs').makeGuide(s.title,s.files),entries=g.toc.filter(t=>t.level>0);
 assert.equal(entries.filter(t=>t.level===1).length,16);assert.equal(entries.filter(t=>t.level===2).length,7);assert.ok(entries.some(t=>t.title==='ii) Link Cable'));
 importer.discardStage(s);
});
test('GameFAQs bracket-code imports retain chapter anchors and both console walkthrough labels',async()=>{
 const text=require('node:fs').readFileSync('tests/guide-fixtures/twilight-heading-style.txt','utf8'),root='https://gamefaqs.gamespot.com/gamecube/920769-the-legend-of-zelda-twilight-princess/faqs/46100';
 const html='<title>Indexed guide - GameFAQs</title><pre id="faqtext">'+text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</pre>';
 const s=await importer.stageImport(root,new AbortController().signal,{initialPage:{url:root,html}});assert.equal(s.missing.length,0);
 const g=require('../src/core.cjs').makeGuide(s.title,s.files),entries=g.toc.filter(t=>t.level>0);assert.equal(entries.length,18);assert.equal(g.files[0].anchors.filter(a=>/^\d{4}$/.test(a.sourceId)).length,18);assert.ok(entries.some(t=>t.title==='Wii Walkthrough — Example route'));assert.ok(g.files[0].anchors.some(a=>a.sourceId==='0401'));
 importer.discardStage(s);
});
test('Superstar-style HTML preformatted guide imports preserve find-code heading hierarchy',async()=>{
 const text=require('node:fs').readFileSync('tests/guide-fixtures/superstar-heading-style.txt','utf8'),root='https://gamefaqs.gamespot.com/gba/914980-mario-and-luigi-superstar-saga/faqs/28142';
 const html='<title>Example guide - GameFAQs</title><pre id="faqtext">'+text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</pre>';
 const s=await importer.stageImport(root,new AbortController().signal,{initialPage:{url:root,html}});assert.equal(s.missing.length,0);const g=require('../src/core.cjs').makeGuide(s.title,s.files),entries=g.toc.filter(t=>t.level>0);assert.equal(entries.length,44);assert.equal(entries.filter(t=>t.level===2).length,31);assert.ok(g.files[0].anchors.some(a=>a.sourceId==='8BNS'));importer.discardStage(s);
});
test('eight-page GameFAQs HTML guide imports in page order and excludes single-page/print duplicates',async()=>{
 const root='https://gamefaqs.gamespot.com/snes/588739-super-mario-rpg-legend-of-the-seven-stars/faqs/8365',calls=[];
 const page=i=>'<title>HTML Guide - GameFAQs</title><article class="faqtext"><h2 id="chapter-'+i+'">Chapter '+i+'</h2><h3>Nested topic '+i+'</h3><p>'+('Keep every page in order for coherent offline reading. '.repeat(5))+'</p></article><nav><a href="?page=1">Next</a><a href="?page=7">Last</a>'+Array.from({length:8},(_,n)=>'<a href="?page='+n+'#chapter-'+n+'">Chapter</a>').join('')+'<a href="?single=1">Single page</a><a href="?print=1">Print</a></nav>';
 global.fetch=async()=>{throw Error('unexpected native fetch');};
 const s=await importer.stageImport(root,new AbortController().signal,{initialPage:{url:root,html:page(0)},fetchPage:async url=>{calls.push(url);return {url,html:page(Number(new URL(url).searchParams.get('page')||0))}}});
 assert.equal(s.missing.length,0);assert.equal(s.files.length,8);assert.deepEqual(s.files.map(f=>Number(new URL(f.source).searchParams.get('page')||0)),[0,1,2,3,4,5,6,7]);assert.equal(calls.length,7);assert.ok(!calls.some(url=>/single|print|page=0/.test(url)));const g=require('../src/core.cjs').makeGuide(s.title,s.files);assert.equal(g.toc.filter(t=>t.level===2).length,8);assert.equal(g.toc.filter(t=>t.level===3).length,8);importer.discardStage(s);
});
