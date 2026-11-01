import * as SQLite from "expo-sqlite";
import { File, Directory, Paths } from "expo-file-system";
export type Anchor = { fileId: string; blockId: string; offset: number };
export type Block = {
  id: string;
  kind: string;
  text: string;
  level: number;
  alt?: string;
  sourceIds?: string[];
};
export type Guide = {
  cover?: string;
  version: number;
  id: string;
  title: string;
  files: {
    id: string;
    name: string;
    source?: string;
    blocks: Block[];
    anchors?: { sourceId: string; blockId: string; offset: number }[];
  }[];
  toc: ({ id: string; title: string; level: number } & Anchor)[];
  assets: { uri: string; source: string }[];
  attribution: string[];
};
let opening: Promise<SQLite.SQLiteDatabase> | undefined;
export function db() {
  if (!opening)
    opening = (async () => {
      const d = await SQLite.openDatabaseAsync("walkthroughs.db");
      await d.execAsync(
        "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS guides(id TEXT PRIMARY KEY,title TEXT,path TEXT,position TEXT,cover TEXT); CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT); CREATE TABLE IF NOT EXISTS blocks(guide TEXT,file TEXT,block TEXT,text TEXT); CREATE INDEX IF NOT EXISTS guide_blocks ON blocks(guide); CREATE TABLE IF NOT EXISTS navigation(guide TEXT,entry TEXT);",
      );
      const columns = await d.getAllAsync<{ name: string }>(
        "PRAGMA table_info(guides)",
      );
      if (!columns.some((c) => c.name === "cover"))
        await d.execAsync("ALTER TABLE guides ADD COLUMN cover TEXT");
      await d.execAsync("PRAGMA user_version=1");
      return d;
    })().catch((e) => {
      opening = undefined;
      throw e;
    });
  return opening;
}
export async function library() {
  return (await db()).getAllAsync<{
    id: string;
    title: string;
    path: string;
    position: string | null;
    cover: string | null;
  }>("SELECT * FROM guides ORDER BY title");
}
export async function saveGuide(g: Guide) {
  const dir = new Directory(Paths.document, "guides", g.id);
  dir.create({ intermediates: true, idempotent: true });
  // Immutable content files keep the previously committed guide intact if a write
  // or SQL transaction fails. The library becomes visible only at SQL commit.
  const file = new File(
    dir,
    `guide-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
  );
  file.write(JSON.stringify(g));
  const d = await db();
  const old = await d.getFirstAsync<{ path: string }>(
    "SELECT path FROM guides WHERE id=?",
    g.id,
  );
  try {
    await d.withExclusiveTransactionAsync(async (tx) => {
      await tx.runAsync(
        "INSERT INTO guides(id,title,path,position,cover) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,path=excluded.path,cover=excluded.cover",
        g.id,
        g.title,
        file.uri,
        null,
        g.cover || null,
      );
      await tx.runAsync("DELETE FROM blocks WHERE guide=?", g.id);
      await tx.runAsync("DELETE FROM navigation WHERE guide=?", g.id);
      for (const f of g.files)
        for (const b of f.blocks)
          await tx.runAsync(
            "INSERT INTO blocks VALUES(?,?,?,?)",
            g.id,
            f.id,
            b.id,
            b.text,
          );
      for (const t of g.toc)
        await tx.runAsync(
          "INSERT INTO navigation VALUES(?,?)",
          g.id,
          JSON.stringify(t),
        );
    });
  } catch (e) {
    file.delete();
    throw e;
  }
  if (old?.path && old.path !== file.uri) {
    const previous = new File(old.path);
    try {
      if (previous.exists) previous.delete();
    } catch {
      /* A committed guide remains valid if obsolete-file cleanup fails. */
    }
  }
}
export async function loadGuide(path: string) {
  const g = JSON.parse(await new File(path).text()) as Guide;
  if (g.version !== 1 || !g.files?.length)
    throw Error("Unsupported or invalid guide document");
  return g;
}
export async function progress(id: string, a: Anchor) {
  const d = await db();
  await d.runAsync(
    "UPDATE guides SET position=? WHERE id=?",
    JSON.stringify(a),
    id,
  );
  await setting("lastGuide", id);
}
export async function setting(key: string, value?: string) {
  const d = await db();
  if (value !== undefined)
    await d.runAsync("INSERT OR REPLACE INTO settings VALUES(?,?)", key, value);
  return (
    await d.getFirstAsync<{ value: string }>(
      "SELECT value FROM settings WHERE key=?",
      key,
    )
  )?.value;
}
