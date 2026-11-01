import { Directory, File, Paths } from "expo-file-system";
import { parseDocument, DomUtils } from "htmlparser2";
import {
  plainBlocks,
  belongsToGuide,
  extractHTML,
  makeGuide,
  validateImport,
} from "./core.cjs";
import { Guide, saveGuide } from "./storage";
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
  artwork?: { uri: string; attribution: string };
};
export function discardStage(stage: Stage) {
  const dir = new Directory(stage.directory);
  if (dir.exists) dir.delete();
}
async function download(url: string, destination: File, signal: AbortSignal) {
  if (new URL(url).protocol !== "https:")
    throw Error("Only HTTPS images are supported");
  const r = await fetch(url, { signal });
  if (!r.ok) throw Error(`HTTP ${r.status}`);
  if (!r.headers.get("content-type")?.startsWith("image/"))
    throw Error("Not an image");
  const bytes = new Uint8Array(await r.arrayBuffer());
  checkAbort(signal);
  destination.write(bytes);
  return destination.uri;
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
  if (gamefaqs && !extracted.blocks.some((b) => b.text.length > 200))
    throw Error("GameFAQs page contains no readable guide");
  if (gamefaqs)
    extracted.blocks = extracted.blocks.flatMap((b) =>
      b.kind === "pre"
        ? plainBlocks(b.text).map(
            (
              part: { kind: string; text: string; level: number },
              i: number,
            ) => ({ ...part, sourceIds: i === 0 ? b.sourceIds : [] }),
          )
        : [b],
    );
  return { ...extracted, title };
}
export async function stageImport(
  url: string,
  signal: AbortSignal,
): Promise<Stage> {
  const root = new URL(url);
  if (root.protocol !== "https:") throw Error("Use an HTTPS guide URL");
  root.hash = "";
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
      try {
        const response = await fetch(page, { signal });
        if (!response.ok) throw Error(`HTTP ${response.status}`);
        if (!belongsToGuide(response.url || page, url))
          throw Error("Redirect left selected guide");
        const html = await response.text();
        if (/cf-chl-|verify you are human|g-recaptcha|hcaptcha/i.test(html))
          throw Error("Site challenge blocked this page");
        const extracted = adapter(html, page);
        if (!extracted.text.trim()) throw Error("No readable text");
        if (!stage.files.length && extracted.title)
          stage.title = extracted.title;
        for (const b of extracted.blocks)
          if (b.kind === "image") b.text = new URL(b.text, page).href;
        stage.files.push({
          id: `file-${stage.files.length}`,
          name: new URL(page).search || "Guide",
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
          const next = new URL(a.attribs.href, page);
          next.hash = "";
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
    for (const [i, url] of [...new Set(stage.images)].entries()) {
      checkAbort(signal);
      try {
        const uri = await download(
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
) {
  validateImport(stage, accept);
  checkAbort(signal);
  const g = makeGuide(stage.title, stage.files) as Guide;
  const dir = new Directory(Paths.document, "guides", g.id);
  dir.create({ intermediates: true, idempotent: true });
  const created: File[] = [];
  const nonce = Date.now() + "-" + Math.random().toString(36).slice(2);
  try {
    for (const [i, asset] of stage.assets.entries()) {
      checkAbort(signal);
      const destination = new File(dir, `image-${nonce}-${i}`);
      created.push(destination);
      new File(asset.uri).copy(destination);
      g.assets.push({ uri: destination.uri, source: asset.source });
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
    await saveGuide(g);
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

export async function artwork(query: string) {
  const u =
    "https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=8&prop=imageinfo&iiprop=url|extmetadata&gsrsearch=" +
    encodeURIComponent(query);
  const response = await fetch(u);
  if (!response.ok) throw Error(`Artwork lookup: HTTP ${response.status}`);
  const data = await response.json();
  return Object.values(data.query?.pages || {}) as any[];
}
export async function stageArtwork(
  stage: Stage,
  item: any,
  signal: AbortSignal,
) {
  const info = item.imageinfo[0],
    file = new File(new Directory(stage.directory), "cover");
  const uri = await download(info.url, file, signal);
  const attribution = artworkAttribution(item);
  return { ...stage, artwork: { uri, attribution } };
}

export function artworkAttribution(item: any) {
  const info = item.imageinfo[0];
  const metadata = info.extmetadata || {};
  const plain = (s: string) => DomUtils.textContent(parseDocument(s || ""));
  return [
    item.title,
    plain(metadata.Artist?.value),
    plain(metadata.Credit?.value),
    plain(metadata.LicenseShortName?.value),
    metadata.LicenseUrl?.value,
    info.descriptionurl,
  ]
    .filter(Boolean)
    .join(" · ");
}
