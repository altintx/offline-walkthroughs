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
let pendingWrite: Promise<void> = Promise.resolve();
function writeInOrder<T>(work: () => Promise<T>): Promise<T> {
  const result = pendingWrite.then(work);
  pendingWrite = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
function removeObsoleteFile(path: string) {
  try {
    const file = new File(path);
    if (file.exists) file.delete();
  } catch (error) {
    console.info("Guide file cleanup deferred", String(error));
  }
}
async function verifiedTransaction(
  d: SQLite.SQLiteDatabase,
  work: (tx: SQLite.SQLiteDatabase) => Promise<void>,
  committed: () => Promise<boolean>,
) {
  try {
    await d.withExclusiveTransactionAsync(work);
  } catch (error) {
    let didCommit: boolean;
    try {
      didCommit = await committed();
    } catch {
      throw Object.assign(
        new Error(
          "Could not confirm the save. Reopen the library before retrying.",
        ),
        { saveOutcomeUnknown: true, cause: error },
      );
    }
    if (!didCommit) throw error;
    console.info(
      "Transaction committed; cleanup reported an error",
      String(error),
    );
  }
}
async function persistDocument(
  d: SQLite.SQLiteDatabase,
  g: Guide,
  oldPath: string | undefined,
  writeRows: (tx: SQLite.SQLiteDatabase, path: string) => Promise<void>,
) {
  const dir = new Directory(Paths.document, "guides", g.id);
  dir.create({ intermediates: true, idempotent: true });
  const file = new File(
    dir,
    `guide-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
  );
  file.write(JSON.stringify(g));
  try {
    await verifiedTransaction(
      d,
      (tx) => writeRows(tx, file.uri),
      async () => {
        const row = await d.getFirstAsync<{ path: string }>(
          "SELECT path FROM guides WHERE id=?",
          g.id,
        );
        return row?.path === file.uri;
      },
    );
  } catch (error) {
    // An indeterminate commit keeps its candidate file, which may be referenced.
    if (!(error as { saveOutcomeUnknown?: boolean }).saveOutcomeUnknown)
      removeObsoleteFile(file.uri);
    throw error;
  }
  if (oldPath && oldPath !== file.uri) removeObsoleteFile(oldPath);
  return g;
}
export function saveGuide(g: Guide, resetProgress = false) {
  return writeInOrder(async () => {
    const d = await db();
    const old = await d.getFirstAsync<{ path: string }>(
      "SELECT path FROM guides WHERE id=?",
      g.id,
    );
    await persistDocument(d, g, old?.path, async (tx, path) => {
      await tx.runAsync(
        "INSERT INTO guides(id,title,path,position,cover) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,path=excluded.path,cover=excluded.cover,position=CASE WHEN ? THEN NULL ELSE guides.position END",
        g.id,
        g.title,
        path,
        null,
        g.cover || null,
        resetProgress ? 1 : 0,
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
  });
}
export function updateGuideMetadata(
  id: string,
  update: (g: Guide) => Pick<Guide, "title" | "cover" | "attribution">,
) {
  return writeInOrder(async () => {
    const d = await db();
    const row = await d.getFirstAsync<{ path: string }>(
      "SELECT path FROM guides WHERE id=?",
      id,
    );
    if (!row) throw Error("This guide is no longer in your library");
    const current = await loadGuide(row.path);
    const metadata = update(current);
    const g = {
      ...current,
      title: metadata.title,
      cover: metadata.cover,
      attribution: metadata.attribution,
    };
    return persistDocument(d, g, row.path, async (tx, path) => {
      await tx.runAsync(
        "UPDATE guides SET title=?,path=?,cover=? WHERE id=?",
        g.title,
        path,
        g.cover || null,
        id,
      );
    });
  });
}
export async function loadGuide(path: string) {
  const g = JSON.parse(await new File(path).text()) as Guide;
  if (g.version !== 1 || !g.files?.length)
    throw Error("Unsupported or invalid guide document");
  return g;
}
export function progress(id: string, a: Anchor) {
  return writeInOrder(async () => {
    const d = await db();
    const location = { fileId: a.fileId, blockId: a.blockId, offset: a.offset };
    await d.runAsync(
      "UPDATE guides SET position=? WHERE id=?",
      JSON.stringify(location),
      id,
    );
    await d.runAsync(
      "INSERT OR REPLACE INTO settings VALUES(?,?)",
      "lastGuide",
      id,
    );
  });
}
export async function setting(key: string, value?: string) {
  if (value !== undefined)
    return writeInOrder(async () => {
      await (
        await db()
      ).runAsync("INSERT OR REPLACE INTO settings VALUES(?,?)", key, value);
      return value;
    });
  return (
    await (
      await db()
    ).getFirstAsync<{ value: string }>(
      "SELECT value FROM settings WHERE key=?",
      key,
    )
  )?.value;
}
export function deleteGuide(id: string) {
  return writeInOrder(async () => {
    const d = await db();
    const row = await d.getFirstAsync<{ path: string }>(
      "SELECT path FROM guides WHERE id=?",
      id,
    );
    if (!row) return;
    await verifiedTransaction(
      d,
      async (tx) => {
        await tx.runAsync("DELETE FROM blocks WHERE guide=?", id);
        await tx.runAsync("DELETE FROM navigation WHERE guide=?", id);
        await tx.runAsync("DELETE FROM guides WHERE id=?", id);
        await tx.runAsync(
          "DELETE FROM settings WHERE key='lastGuide' AND value=?",
          id,
        );
      },
      async () =>
        !(await d.getFirstAsync("SELECT path FROM guides WHERE id=?", id)),
    );
    try {
      const dir = new Directory(Paths.document, "guides", id);
      if (dir.exists) dir.delete();
    } catch (error) {
      console.info("Guide directory cleanup deferred", String(error));
    }
  });
}
export async function renameGuide(id: string, title: string) {
  const name = title.trim();
  if (!name) throw Error("Enter a guide name");
  return updateGuideMetadata(id, (current) => ({ ...current, title: name }));
}
