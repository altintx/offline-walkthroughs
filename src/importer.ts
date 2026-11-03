import { Directory, File, Paths } from "expo-file-system";
import { parseDocument, DomUtils } from "htmlparser2";
import {
  plainBlocks,
  belongsToGuide,
  guidePageURL,
  extractHTML,
  makeGuide,
  validateImport,
} from "./core.cjs";
import { Guide, saveGuide } from "./storage";
import { cacheArtwork, downloadImage } from "./artwork";
function checkAbort(signal: AbortSignal) {
  if (signal.aborted) {
    const e = new Error("Import cancelled");
    e.name = "AbortError";
    throw e;
  }
}
export type Source = {
  id: string;
  name: string;
  text: string;
  source?: string;
  blocks?: any[];
  links?: any[];
};
export type Stage = {
  files: Source[];
  missing: string[];
  images: string[];
  assets: { uri: string; source: string }[];
  title: string;
  directory: string;
  artworkQuery?: string;
  artwork?: { uri: string; attribution: string };
};
export function discardStage(stage: Stage) {
  const dir = new Directory(stage.directory);
  if (dir.exists) dir.delete();
}
function adapter(html: string, url: string) {
  const doc = parseDocument(html),
    a = DomUtils.findOne((n) => n.name === "title", doc.children, true);
  // GameFAQs exposes FAQ prose under #faqtext / .faqtext. The shared extractor
  // prioritizes that container; challenge pages are reported, never bypassed.
  const gamefaqs = /(^|\.)gamefaqs\.gamespot\.com$/.test(new URL(url).hostname);
  const title = a
    ? DomUtils.textContent(a)
        .replace(/\s+-\s+GameFAQs.*$/i, "")
        .trim()
    : undefined;
  const extracted = extractHTML(html);
  if (
    gamefaqs &&
    extracted.blocks
      .filter((b) => b.kind !== "image")
      .reduce((sum, b) => sum + b.text.trim().length, 0) < 80
  )
    throw Error("GameFAQs page contains no readable guide");
  if (gamefaqs)
    extracted.blocks = extracted.blocks.flatMap((b) =>
      b.kind === "pre"
        ? plainBlocks(b.text).map(
            (
              part: {
                kind: string;
                text: string;
                level: number;
                sourceIds?: string[];
              },
              i: number,
            ) => ({
              ...part,
              sourceIds: [
                ...new Set([
                  ...(i === 0 ? b.sourceIds || [] : []),
                  ...(part.sourceIds || []),
                ]),
              ],
            }),
          )
        : [b],
    );
  return { ...extracted, title };
}
export type ImportPage = { url: string; html: string };
export type ImportProgress = {
  phase: "pages" | "images" | "saving";
  completed: number;
  total: number;
  detail?: string;
};
export type ImportTransport = {
  onProgress?: (progress: ImportProgress) => void;
  initialPage?: ImportPage;
  fetchPage?: (url: string, signal: AbortSignal) => Promise<ImportPage>;
};
export async function stageImport(
  url: string,
  signal: AbortSignal,
  transport: ImportTransport = {},
): Promise<Stage> {
  const root = new URL(guidePageURL(url, url)!);
  if (root.protocol !== "https:") throw Error("Use an HTTPS guide URL");
  root.hash = "";
  if (transport.initialPage) {
    const initial = new URL(
      guidePageURL(transport.initialPage.url, url) || transport.initialPage.url,
    );
    initial.hash = "";
    if (initial.href !== root.href)
      throw Error("Captured page does not match the selected guide");
  }
  const directory = new Directory(
    Paths.cache,
    `import-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  directory.create({ intermediates: true });
  const queue = [root.href],
    seen = new Set<string>(),
    stage: Stage = {
      files: [],
      missing: [],
      images: [],
      assets: [],
      title: root.pathname.split("/").pop() || "Walkthrough",
      directory: directory.uri,
    };
  try {
    while (queue.length) {
      checkAbort(signal);
      const page = queue.shift()!;
      if (seen.has(page)) continue;
      seen.add(page);
      if (seen.size > 100) {
        stage.missing.push("Guide exceeds 100 pages");
        break;
      }
      transport.onProgress?.({
        phase: "pages",
        completed: seen.size - 1,
        total: seen.size + queue.length,
        detail: page,
      });
      try {
        let loaded: ImportPage;
        if (page === root.href && transport.initialPage)
          loaded = transport.initialPage;
        else if (transport.fetchPage)
          loaded = await transport.fetchPage(page, signal);
        else {
          const response = await fetch(page, { signal });
          if (!response.ok) throw Error(`HTTP ${response.status}`);
          loaded = { url: response.url || page, html: await response.text() };
        }
        checkAbort(signal);
        if (!belongsToGuide(loaded.url, url))
          throw Error("Redirect left selected guide");
        const html = loaded.html;
        if (/cf-chl-|verify you are human|g-recaptcha|hcaptcha/i.test(html))
          throw Error("Site challenge blocked this page");
        const extracted = adapter(html, page);
        if (!extracted.text.trim()) throw Error("No readable text");
        if (!stage.files.length && extracted.title)
          stage.title = extracted.title;
        for (const b of extracted.blocks)
          if (b.kind === "image") b.text = new URL(b.text, page).href;
        const headings = extracted.blocks.filter((b) => b.kind === "heading");
        const chapterName =
          headings[0]?.text === "Appendix" && headings[1]?.level === 3
            ? `Appendix: ${headings[1].text}`
            : headings[0]?.text;
        stage.files.push({
          id: `file-${stage.files.length}`,
          name: chapterName || extracted.title || "Guide",
          source: page,
          ...extracted,
        });
        for (const image of extracted.images)
          stage.images.push(new URL(image, page).href);
        const dom = parseDocument(html);
        const anchors = DomUtils.findAll(
          (n) => n.name === "a" && !!n.attribs.href,
          dom.children,
        );
        for (const a of anchors) {
          const normalized = guidePageURL(
            new URL(a.attribs.href, page).href,
            root.href,
          );
          if (!normalized) continue;
          const next = new URL(normalized);
          if (
            belongsToGuide(next.href, url) &&
            !seen.has(next.href) &&
            !queue.includes(next.href)
          )
            queue.push(next.href);
        }
      } catch (e) {
        if (signal.aborted) throw e;
        stage.missing.push(`${page}: ${String(e)}`);
      }
    }
    // Next/Last/TOC links can discover page 8 before page 3. Preserve the
    // document's numeric page order rather than link-discovery order.
    if (
      /(^|\.)gamefaqs\.gamespot\.com$/.test(root.hostname) &&
      stage.files.every((file) => {
        const location = new URL(file.source!);
        return (
          location.pathname === root.pathname &&
          /^(?:\d+)?$/.test(location.searchParams.get("page") || "")
        );
      })
    )
      stage.files.sort(
        (a, b) =>
          Number(new URL(a.source!).searchParams.get("page") || 0) -
          Number(new URL(b.source!).searchParams.get("page") || 0),
      );
    const images = [...new Set(stage.images)];
    for (const [i, url] of images.entries()) {
      transport.onProgress?.({
        phase: "images",
        completed: i,
        total: images.length,
        detail: url,
      });
      checkAbort(signal);
      try {
        const uri = await downloadImage(
          url,
          new File(directory, `image-${i}`),
          signal,
        );
        stage.assets.push({ uri, source: url });
      } catch (e) {
        if (signal.aborted) throw e;
        stage.missing.push(`Image ${url}: ${String(e)}`);
      }
    }
    transport.onProgress?.({
      phase: "images",
      completed: images.length,
      total: images.length,
    });
    return stage;
  } catch (e) {
    discardStage(stage);
    throw e;
  }
}
export async function commitImport(
  stage: Stage,
  accept: boolean,
  signal: AbortSignal,
  resetProgress = false,
  displayTitle?: string,
  onProgress?: (progress: ImportProgress) => void,
) {
  validateImport(stage, accept);
  checkAbort(signal);
  onProgress?.({
    phase: "saving",
    completed: 0,
    total: stage.assets.length + 2,
    detail: "Preparing guide and table of contents",
  });
  // Let the progress screen paint before parsing a large guide.
  await new Promise((resolve) => setTimeout(resolve, 20));
  checkAbort(signal);
  const g = makeGuide(stage.title, stage.files) as Guide;
  if (stage.artworkQuery) g.artworkQuery = stage.artworkQuery;
  if (displayTitle) g.title = displayTitle;
  const dir = new Directory(Paths.document, "guides", g.id);
  dir.create({ intermediates: true, idempotent: true });
  const created: File[] = [];
  const nonce = Date.now() + "-" + Math.random().toString(36).slice(2);
  try {
    for (const [i, asset] of stage.assets.entries()) {
      checkAbort(signal);
      onProgress?.({
        phase: "saving",
        completed: i + 1,
        total: stage.assets.length + 2,
        detail: `Copying offline images: ${i + 1} of ${stage.assets.length}`,
      });
      const destination = new File(dir, `image-${nonce}-${i}`);
      created.push(destination);
      new File(asset.uri).copy(destination);
      g.assets.push({ uri: destination.uri, source: asset.source });
      if (i % 8 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    if (stage.artwork) {
      const destination = new File(dir, `cover-${nonce}`);
      created.push(destination);
      new File(stage.artwork.uri).copy(destination);
      g.cover = destination.uri;
      g.attribution.push(stage.artwork.attribution);
    }
    g.attribution.push(
      ...stage.missing.map((x) => "Missing content accepted: " + x),
    );
    checkAbort(signal);
    onProgress?.({
      phase: "saving",
      completed: stage.assets.length + 1,
      total: stage.assets.length + 2,
      detail:
        "Saving text, search index and table of contents. Large guides can take a minute.",
    });
    await saveGuide(g, resetProgress);
    onProgress?.({
      phase: "saving",
      completed: stage.assets.length + 2,
      total: stage.assets.length + 2,
      detail: "Saved",
    });
  } catch (e) {
    for (const file of created) if (file.exists) file.delete();
    throw e;
  }
  try {
    discardStage(stage);
  } catch {
    /* Cache cleanup must not invalidate the committed library record. */
  }
  return g;
}

export async function stageArtwork(
  stage: Stage,
  item: any,
  signal: AbortSignal,
) {
  const file = new File(
    new Directory(stage.directory),
    `cover-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const selection = await cacheArtwork({ item }, file, signal);
  return { ...stage, artwork: selection };
}
