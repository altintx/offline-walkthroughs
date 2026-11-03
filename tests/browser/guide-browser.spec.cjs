const { test, expect } = require("@playwright/test");
const fs = require("node:fs"),
  load = require("../load-ts.cjs");
const { guideBrowserScript } = load("src/guideBrowser.ts");
const { extractHTML } = require("../../src/core.cjs");
const root = "https://gamefaqs.gamespot.com/snes/123-mario/faqs/456";
const escape = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
test("capture reads the visible FAQ and keeps same-guide section links outside its body", async ({
  page,
}) => {
  const text = fs.readFileSync("fixtures/minishcapwalkthrough.txt", "utf8");
  await page.addInitScript(() => {
    window.captured = [];
    window.ReactNativeWebView = {
      postMessage: (data) => window.captured.push(JSON.parse(data)),
    };
  });
  await page.route("https://gamefaqs.gamespot.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body:
        '<title>Loaded guide</title><script>window.siteScriptRan=true</script><div id="faqtext"><pre>' +
        escape(text) +
        '</pre></div><a href="' +
        root +
        '/chapter-2">Next</a><a href="https://other.example/faqs/456">Outside</a>',
    }),
  );
  await page.goto(root);
  await page.evaluate(guideBrowserScript("capture"));
  const captured = await page.evaluate(() => window.captured[0]);
  expect(captured.error).toBeUndefined();
  expect(captured.url).toBe(root);
  expect(captured.html).toContain(root + "/chapter-2");
  expect(captured.html).not.toContain("other.example");
  expect(captured.html).not.toContain("window.siteScriptRan");
  const parsed = extractHTML(captured.html);
  expect((parsed.text.match(/sword/gi) || []).length).toBe(111);
});
test("linked section capture uses browser cookies and does not execute fetched scripts", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.captured = [];
    window.ReactNativeWebView = {
      postMessage: (data) => window.captured.push(JSON.parse(data)),
    };
  });
  let cookie = "";
  await page.route("https://gamefaqs.gamespot.com/**", async (route) => {
    if (route.request().url().endsWith("/chapter-2")) {
      cookie = route.request().headers().cookie || "";
      await route.fulfill({
        contentType: "text/html",
        body: '<title>Second section</title><div id="faqtext"><p>More guide prose.</p><script>window.fetchedScriptRan=true</script></div>',
      });
    } else
      await route.fulfill({
        contentType: "text/html",
        headers: {
          "set-cookie": "guide_session=visible; Path=/; Secure; SameSite=Lax",
        },
        body: '<div id="faqtext">Current loaded page</div>',
      });
  });
  await page.goto(root);
  await page.evaluate(guideBrowserScript("section", root + "/chapter-2"));
  await page.waitForFunction(() => window.captured.length > 0);
  const captured = await page.evaluate(() => window.captured[0]);
  expect(cookie).toContain("guide_session=visible");
  expect(captured.error).toBeUndefined();
  expect(captured.url).toBe(root + "/chapter-2");
  expect(extractHTML(captured.html).text).toContain("More guide prose.");
  expect(await page.evaluate(() => window.fetchedScriptRan)).toBeUndefined();
});
test("HTML guide capture retains all formatted sections, headings and anchor destinations", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.captured = [];
    window.ReactNativeWebView = {
      postMessage: (data) => window.captured.push(JSON.parse(data)),
    };
  });
  await page.route("https://gamefaqs.gamespot.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<title>Formatted guide</title><header>Site navigation</header><div id="faqspan-1"><h1 id="intro">Introduction</h1><p>First guide section.</p></div><div id="faqspan-2"><h2 id="castle">The Castle</h2><p>Second guide section.</p></div>',
    }),
  );
  await page.goto(root);
  await page.evaluate(guideBrowserScript("html"));
  const capture = await page.evaluate(() => window.captured[0]);
  expect(capture.error).toBeUndefined();
  const extracted = extractHTML(capture.html);
  expect(
    extracted.blocks.filter((b) => b.kind === "heading").map((b) => b.text),
  ).toEqual(["Introduction", "The Castle"]);
  expect(extracted.text).toContain("Second guide section.");
  expect(extracted.text).not.toContain("Site navigation");
  expect(
    extracted.blocks.some((b) => b.sourceIds.includes("castle")),
  ).toBeTruthy();
});
test("an unsupported guide layout is not mislabeled as a browser challenge", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.captured = [];
    window.ReactNativeWebView = {
      postMessage: (data) => window.captured.push(JSON.parse(data)),
    };
  });
  await page.route("https://gamefaqs.gamespot.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<title>Guide</title><div>Unrecognized layout</div>",
    }),
  );
  await page.goto(root);
  await page.evaluate(guideBrowserScript("unsupported"));
  const capture = await page.evaluate(() => window.captured[0]);
  expect(capture.error).toContain("no recognized guide content");
  expect(capture.error).not.toContain("browser check");
});
test("formatted chapter capture matches the page title to its prose container without importing site chrome", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.captured = [];
    window.ReactNativeWebView = {
      postMessage: (data) => window.captured.push(JSON.parse(data)),
    };
  });
  await page.route("https://gamefaqs.gamespot.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body:
        '<title>Chapter guide</title><header><h1>Introduction</h1><p>Site controls</p></header><aside><a href="' +
        root +
        '/prologue">Prologue</a></aside><div class="formatted-chapter"><h2>Introduction</h2><p>' +
        "Explore this chapter and keep the important details. ".repeat(8) +
        '</p><h4 id="saving">Continuing and Saving</h4><p>Save your progress.</p></div><footer>Site footer</footer>',
    }),
  );
  await page.goto(root);
  await page.evaluate(guideBrowserScript("chapter"));
  const capture = await page.evaluate(() => window.captured[0]);
  expect(capture.error).toBeUndefined();
  const extracted = extractHTML(capture.html);
  expect(
    extracted.blocks.filter((b) => b.kind === "heading").map((b) => b.text),
  ).toEqual(["Introduction", "Continuing and Saving"]);
  expect(extracted.text).not.toContain("Site controls");
  expect(extracted.text).not.toContain("Site footer");
  expect(capture.html).toContain(root + "/prologue");
});
for (const chapter of ["Pieces of Heart", "Treasure Chests"])
  test(
    "captures appendix " +
      chapter +
      " when the chapter label is a subheading and content is a table",
    async ({ page }) => {
      await page.addInitScript(() => {
        window.captured = [];
        window.ReactNativeWebView = {
          postMessage: (data) => window.captured.push(JSON.parse(data)),
        };
      });
      const rows = Array.from(
        { length: 8 },
        (_, i) =>
          "<tr><td>Location " +
          (i + 1) +
          "</td><td>Follow the path and check the marked spot for this collectible.</td></tr>",
      ).join("");
      await page.route("https://gamefaqs.gamespot.com/**", (route) =>
        route.fulfill({
          contentType: "text/html",
          body:
            "<title>" +
            chapter +
            " - Guide</title><header><h1>" +
            chapter +
            '</h1></header><aside><h3>Table of Contents</h3><ul><li><a href="' +
            root +
            '/pieces-of-heart">Pieces of Heart</a></li><li><a href="' +
            root +
            '/treasure-chests">Treasure Chests</a></li></ul></aside><div class="formatted-guide"><h2>Appendix</h2><h3>' +
            chapter +
            "</h3><table>" +
            rows +
            "</table></div><footer>Site footer</footer>",
        }),
      );
      await page.goto(root);
      await page.evaluate(guideBrowserScript("appendix"));
      const capture = await page.evaluate(() => window.captured[0]);
      expect(capture.error).toBeUndefined();
      const extracted = extractHTML(capture.html);
      expect(
        extracted.blocks.filter((b) => b.kind === "heading").map((b) => b.text),
      ).toEqual(["Appendix", chapter]);
      expect(extracted.text).toContain("Location 8");
      expect(extracted.text).not.toContain("Table of Contents");
      expect(extracted.text).not.toContain("Site footer");
    },
  );
test('paginated HTML capture keeps chapter structure and excludes alternative full-guide views',async({page})=>{
 await page.addInitScript(()=>{window.captured=[];window.ReactNativeWebView={postMessage:data=>window.captured.push(JSON.parse(data))};});
 await page.route('https://gamefaqs.gamespot.com/**',route=>route.fulfill({contentType:'text/html',body:'<title>HTML Guide</title><header><h1>HTML Guide</h1></header><div><h2 id="intro">Introduction</h2><p>'+('Readable introductory guide content. '.repeat(8))+'</p><h3 id="controls">Controls</h3><table><tr><td>A</td><td>Confirm</td></tr></table></div><nav><a href="?page=1#route">Next</a><a href="?page=7">Last</a><a href="?page=0">First</a><a href="?single=1">Single page</a><a href="?print=1">Print</a></nav>'}));
 await page.goto(root);await page.evaluate(guideBrowserScript('paged'));const capture=await page.evaluate(()=>window.captured[0]);expect(capture.error).toBeUndefined();expect(capture.html).toContain('?page=1');expect(capture.html).toContain('?page=7');expect(capture.html).not.toContain('?page=0');expect(capture.html).not.toContain('single=1');expect(capture.html).not.toContain('print=1');const extracted=extractHTML(capture.html);expect(extracted.blocks.filter(b=>b.kind==='heading').map(b=>b.text)).toEqual(['Introduction','Controls']);
});
