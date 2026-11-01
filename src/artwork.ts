import { Directory, File, Paths } from "expo-file-system";
import { parseDocument, DomUtils } from "htmlparser2";
import { Guide, updateGuideMetadata } from "./storage";
export const artworkHeaders = {
  "User-Agent": "StratTome/0.1 (Android; com.altintx.walkthroughs)",
  "Api-User-Agent":
    "StratTome/0.1 (Android; com.altintx.walkthroughs)",
};
function checkAbort(signal: AbortSignal) {
  if (signal.aborted) {
    const e = new Error("Artwork selection cancelled");
    e.name = "AbortError";
    throw e;
  }
}
export async function downloadImage(
  url: string,
  destination: File,
  signal: AbortSignal,
) {
  if (new URL(url).protocol !== "https:")
    throw Error("Only HTTPS images are supported");
  const r = await fetch(url, {
    signal,
    headers: /(^|\.)(wikimedia|wikipedia)\.org$/.test(new URL(url).hostname)
      ? artworkHeaders
      : undefined,
  });
  if (!r.ok) throw Error(`HTTP ${r.status}`);
  if (!r.headers.get("content-type")?.startsWith("image/"))
    throw Error("Not an image");
  const bytes = new Uint8Array(await r.arrayBuffer());
  checkAbort(signal);
  destination.write(bytes);
  return destination.uri;
}
async function artworkJSON(host: string, params: Record<string, string>) {
  const response = await fetch(
    `https://${host}/w/api.php?` +
      new URLSearchParams({ action: "query", format: "json", ...params }),
    { headers: { ...artworkHeaders, Accept: "application/json" } },
  );
  if (!response.ok) throw Error(`${host}: HTTP ${response.status}`);
  const data = await response.json();
  if (data.error)
    throw Error(
      data.error.info || "Artwork service could not complete the search",
    );
  return Object.values(data.query?.pages || {}) as any[];
}
export async function artwork(query: string) {
  const name = query.trim();
  if (!name) throw Error("Enter the game's title to look up artwork");
  const sources = await Promise.allSettled([
    (async () => {
      const games = await artworkJSON("en.wikipedia.org", {
        generator: "search",
        gsrsearch: name,
        gsrnamespace: "0",
        gsrlimit: "8",
        prop: "pageimages",
        piprop: "name|thumbnail|original",
        pilicense: "any",
        pithumbsize: "500",
      });
      const names = [
        ...new Set(games.map((page) => page.pageimage).filter(Boolean)),
      ];
      if (!names.length) return [];
      const images = await artworkJSON("en.wikipedia.org", {
        titles: names.map((title) => "File:" + title).join("|"),
        prop: "imageinfo",
        iiprop: "url|extmetadata",
        iiurlwidth: "500",
      });
      const normalize = (value: string) => value.replace(/_/g, " ");
      return games
        .sort((a, b) => (a.index ?? 999) - (b.index ?? 999))
        .flatMap((game) => {
          const item = images.find(
            (image) =>
              normalize(image.title) === normalize("File:" + game.pageimage),
          );
          return item?.imageinfo?.[0]?.url
            ? [
                {
                  ...item,
                  title: game.title,
                  imageinfo: [
                    {
                      ...item.imageinfo[0],
                      url: item.imageinfo[0].thumburl || item.imageinfo[0].url,
                    },
                  ],
                },
              ]
            : [];
        });
    })(),
    artworkJSON("commons.wikimedia.org", {
      generator: "search",
      gsrsearch: '"' + name.replace(/"/g, "") + '"',
      gsrnamespace: "6",
      gsrlimit: "8",
      prop: "imageinfo",
      iiprop: "url|extmetadata",
      iiurlwidth: "500",
    }),
  ]);
  const found = sources
    .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
    .filter((item) => item.imageinfo?.[0]?.url)
    .map((item) => ({
      ...item,
      imageinfo: [
        {
          ...item.imageinfo[0],
          url: item.imageinfo[0].thumburl || item.imageinfo[0].url,
        },
      ],
    }));
  if (!found.length && sources.some((result) => result.status === "rejected")) {
    const reasons = sources
      .filter(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      )
      .map((result) => String(result.reason))
      .join("; ");
    throw Error(
      `Artwork lookup failed (${reasons}). Try again or choose a local image.`,
    );
  }
  return found.filter(
    (item, i) =>
      found.findIndex(
        (other) => other.imageinfo[0].url === item.imageinfo[0].url,
      ) === i,
  );
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

export type ArtworkSource =
  { item: any; localUri?: never } | { localUri: string; item?: never };
export async function cacheArtwork(
  source: ArtworkSource,
  file: File,
  signal: AbortSignal,
) {
  checkAbort(signal);
  try {
    if (source.localUri !== undefined) {
      new File(source.localUri).copy(file);
      checkAbort(signal);
      return { uri: file.uri, attribution: "Local artwork" };
    }
    const uri = await downloadImage(source.item.imageinfo[0].url, file, signal);
    return { uri, attribution: artworkAttribution(source.item) };
  } catch (error) {
    removeCachedFile(file);
    throw error;
  }
}
function removeCachedFile(file: File | string) {
  try {
    const target = typeof file === "string" ? new File(file) : file;
    if (target.exists) target.delete();
  } catch (error) {
    console.info("Artwork cache cleanup deferred", String(error));
  }
}
export async function saveGuideArtwork(
  id: string,
  source: ArtworkSource,
  signal: AbortSignal,
) {
  const dir = new Directory(Paths.document, "guides", id, "artwork");
  dir.create({ intermediates: true, idempotent: true });
  const file = new File(
    dir,
    `cover-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const selection = await cacheArtwork(source, file, signal);
  let previous: string | undefined;
  let g: Guide;
  try {
    checkAbort(signal);
    g = await updateGuideMetadata(id, (current) => {
      previous = current.cover;
      return {
        ...current,
        cover: selection.uri,
        attribution: [
          ...new Set(
            [...current.attribution, selection.attribution].filter(Boolean),
          ),
        ],
      };
    });
  } catch (error) {
    if (!(error as { saveOutcomeUnknown?: boolean }).saveOutcomeUnknown)
      removeCachedFile(file);
    throw error;
  }
  // Cleanup follows a confirmed commit and cannot turn a saved cover into a failure.
  const guideDir = new Directory(Paths.document, "guides", id).uri;
  const legacyPrefix = new File(Paths.document, `art-${id}-`).uri;
  if (
    previous &&
    previous !== file.uri &&
    !g.assets.some((asset) => asset.uri === previous) &&
    (previous.startsWith(guideDir + "/") || previous.startsWith(legacyPrefix))
  )
    removeCachedFile(previous);
  return g;
}
