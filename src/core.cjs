const { parseDocument, DomUtils } = require("htmlparser2");
function hash(s) {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0).toString(36);
}
function plainBlocks(text) {
  return text
    .replace(/\r/g, "")
    .split(/\n[ \t]*\n/)
    .filter(Boolean)
    .map((text) => {
      const pre =
        /^ {2,}\S/m.test(text) || /[|+].*[|+]/.test(text) || /\t/.test(text);
      const heading =
        !pre &&
        text.length < 100 &&
        !text.includes("\n") &&
        (/^[A-Z\d][A-Z\d\s: .—-]+$/.test(text) ||
          /^#{1,6} /.test(text) ||
          /^\d+(?:\.\d+)*[.)]?\s+[A-Z][^.!?]{1,70}$/.test(text));
      const list = /^\s*(?:[-*•]|\d+[.)]) /m.test(text);
      return {
        kind: pre ? "pre" : heading ? "heading" : list ? "list" : "paragraph",
        text: pre || list ? text : text.replace(/\n/g, " "),
        level: heading ? text.match(/^#+/)?.[0].length || 1 : 0,
      };
    });
}
function makeGuide(title, sources) {
  const toc = [];
  const files = sources.map((s) => {
    const raw = s.blocks?.length ? s.blocks : plainBlocks(s.text);
    const blocks = raw.map((b, i) => ({
      ...b,
      id: `${s.id}-${i}-${hash(b.text)}`,
    }));
    const anchors = [];
    for (const b of blocks)
      for (const sourceId of b.sourceIds || [])
        anchors.push({ sourceId, blockId: b.id, offset: 0 });
    const file = { id: s.id, name: s.name, source: s.source, blocks, anchors };
    if (blocks.length)
      toc.push({
        id: s.id,
        title: s.name,
        fileId: s.id,
        blockId: blocks[0].id,
        offset: 0,
        level: 0,
      });
    const targets = new Set();
    for (const b of blocks)
      if (b.kind === "heading") {
        toc.push({
          id: b.id,
          title: b.text.replace(/^#+ /, ""),
          fileId: s.id,
          blockId: b.id,
          offset: 0,
          level: b.level || 1,
        });
        targets.add(b.id);
      }
    for (const link of s.links || []) {
      const target = anchors.find((a) => a.sourceId === link.target);
      if (target && !targets.has(target.blockId)) {
        targets.add(target.blockId);
        toc.push({
          id: `link-${target.blockId}`,
          title: link.title,
          fileId: s.id,
          ...target,
          level: 1,
        });
      }
    }
    if (!targets.size && blocks.length > 30)
      for (let i = 30; i < blocks.length; i += 30)
        toc.push({
          id: `section-${blocks[i].id}`,
          title: `Section ${i / 30 + 1}`,
          fileId: s.id,
          blockId: blocks[i].id,
          offset: 0,
          level: 1,
        });
    const order = new Map(blocks.map((b, i) => [b.id, i]));
    const entries = toc
      .filter((t) => t.fileId === s.id)
      .sort(
        (a, b) =>
          order.get(a.blockId) - order.get(b.blockId) || a.level - b.level,
      );
    toc.splice(
      toc.findIndex((t) => t.fileId === s.id),
      entries.length,
      ...entries,
    );
    return file;
  });
  return {
    version: 1,
    id: hash(
      title +
        sources
          .map((s) => s.id + (s.text || JSON.stringify(s.blocks)))
          .join(""),
    ),
    title,
    files,
    toc,
    assets: [],
    attribution: sources.filter((s) => s.source).map((s) => s.source),
  };
}
function search(g, query) {
  if (!query.trim()) return [];
  const pattern = new RegExp(
      query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      "giu",
    ),
    out = [];
  for (const f of g.files)
    for (const b of f.blocks) {
      if (b.kind === "image") continue;
      pattern.lastIndex = 0;
      let m;
      while ((m = pattern.exec(b.text)) !== null)
        out.push({
          fileId: f.id,
          blockId: b.id,
          offset: m.index,
          length: m[0].length,
          snippet: b.text.slice(
            Math.max(0, m.index - 40),
            m.index + m[0].length + 70,
          ),
        });
    }
  return out;
}
function resolveAnchor(g, a) {
  const f = g.files.find((f) => f.id === a?.fileId) || g.files[0];
  const b = f?.blocks.find((b) => b.id === a?.blockId) || f?.blocks[0];
  return {
    fileId: f?.id,
    blockId: b?.id,
    offset: Math.max(0, Math.min(a?.offset || 0, b?.text.length || 0)),
  };
}
const stepMatch = (r, i, d) => ({
  index: Math.max(0, Math.min(r.length - 1, i + d)),
  message: !r.length
    ? "No results"
    : i + d < 0
      ? "First result"
      : i + d >= r.length
        ? "Last result"
        : "",
});
const colorMode = (preference, system) =>
  preference === "light" || preference === "dark"
    ? preference
    : system || "dark";
function pageRanges(length, size) {
  const out = [];
  for (let start = 0; start < length; start += Math.max(1, size))
    out.push({ start, end: Math.min(length, start + Math.max(1, size)) });
  return out;
}
const pageForOffset = (pages, offset) =>
  pages.find((p) => p.start <= offset && p.end > offset) ||
  pages[pages.length - 1];
function extractHTML(html) {
  const dom = parseDocument(html, { decodeEntities: true });
  const find = (predicate) => DomUtils.findOne(predicate, dom.children, true);
  const root =
    find(
      (n) =>
        n.attribs &&
        (n.attribs.id === "faqtext" ||
          n.attribs.class?.split(" ").includes("faqtext")),
    ) ||
    find((n) => n.name === "main") ||
    find((n) => n.name === "article") ||
    find((n) => n.name === "body") ||
    dom;
  const blocks = [],
    images = [],
    links = [];
  let buffer = "",
    ids = [];
  const flush = (kind = "paragraph", level = 0) => {
    if (buffer.trim())
      blocks.push({
        kind,
        text:
          kind === "pre"
            ? buffer
            : buffer.replace(/[ \t]*\n[ \t]*/g, " ").trim(),
        level,
        sourceIds: ids,
      });
    buffer = "";
    ids = [];
  };
  const blocked = new Set([
    "script",
    "style",
    "iframe",
    "nav",
    "footer",
    "form",
    "noscript",
    "head",
    "svg",
    "canvas",
  ]);
  const visit = (n) => {
    if (n.type === "text") {
      buffer += n.data;
      return;
    }
    if (!n.name) {
      for (const child of n.children || []) visit(child);
      return;
    }
    if (
      blocked.has(n.name) ||
      n.attribs?.hidden !== undefined ||
      n.attribs?.["aria-hidden"] === "true"
    )
      return;
    if (n.name === "pre") {
      flush();
      blocks.push({
        kind: "pre",
        text: DomUtils.textContent(n),
        level: 0,
        sourceIds: [n.attribs.id, n.attribs.name].filter(Boolean),
      });
      return;
    }
    if (n.name === "img") {
      if (
        !n.attribs.src ||
        (Number(n.attribs.width) <= 1 &&
          Number(n.attribs.height) <= 1 &&
          n.attribs.width &&
          n.attribs.height)
      )
        return;
      flush();
      images.push(n.attribs.src);
      blocks.push({
        kind: "image",
        text: n.attribs.src,
        alt: n.attribs.alt || "",
        level: 0,
        sourceIds: [n.attribs.id].filter(Boolean),
      });
      return;
    }
    if (n.name === "br") {
      buffer += "\n";
      return;
    }
    if (n.name === "a" && n.attribs.href?.includes("#")) {
      const target = n.attribs.href.split("#")[1];
      if (target)
        links.push({
          target: decodeURIComponent(target),
          title: DomUtils.textContent(n).trim(),
        });
    }
    const heading = /^h[1-6]$/.test(n.name),
      boundary =
        heading ||
        [
          "p",
          "div",
          "section",
          "article",
          "main",
          "li",
          "ul",
          "ol",
          "table",
          "tr",
        ].includes(n.name);
    if (boundary) flush();
    if (n.attribs?.id || n.attribs?.name)
      ids.push(n.attribs.id || n.attribs.name);
    if (n.name === "table") {
      blocks.push({
        kind: "pre",
        text: DomUtils.findAll((x) => x.name === "tr", n.children)
          .map((row) =>
            (row.children || [])
              .filter((x) => x.name === "td" || x.name === "th")
              .map((cell) => DomUtils.textContent(cell))
              .join("\t"),
          )
          .join("\n"),
        level: 0,
        sourceIds: ids,
      });
      ids = [];
      return;
    }
    for (const child of n.children || []) visit(child);
    if (boundary)
      flush(
        heading ? "heading" : n.name === "li" ? "list" : "paragraph",
        heading ? Number(n.name[1]) : 0,
      );
  };
  visit(root);
  flush();
  return {
    text: blocks.map((b) => b.text).join("\n\n"),
    blocks,
    images,
    links,
  };
}
function belongsToGuide(candidate, base) {
  try {
    const a = new URL(candidate, base),
      b = new URL(base);
    if (a.origin !== b.origin || !["https:", "http:"].includes(a.protocol))
      return false;
    if (/(^|\.)gamefaqs\.gamespot\.com$/.test(b.hostname)) {
      const faq = b.pathname.match(/^(.*\/faqs\/\d+)(?:\/|$)/)?.[1];
      if (faq) return a.pathname === faq || a.pathname.startsWith(faq + "/");
    }
    return a.pathname === b.pathname;
  } catch {
    return false;
  }
}
function validateImport(stage, accept = false) {
  if (!stage.files.length) throw Error("No readable content");
  if (stage.missing.length && !accept)
    throw Error("Accept missing content before saving");
  return true;
}
function breadcrumbs(g, a) {
  const file = g.files.find((f) => f.id === a.fileId);
  if (!file) return [];
  const index = file.blocks.findIndex((b) => b.id === a.blockId),
    entries = g.toc.filter((t) => t.fileId === file.id),
    stack = [];
  for (const t of entries) {
    if (file.blocks.findIndex((b) => b.id === t.blockId) > index) break;
    while (stack.length && stack[stack.length - 1].level >= t.level)
      stack.pop();
    stack.push(t);
  }
  return stack.map((t) => {
    const idx = entries.indexOf(t);
    let start = idx,
      end = idx + 1;
    while (start > 0 && entries[start - 1].level >= t.level) start--;
    while (end < entries.length && entries[end].level >= t.level) end++;
    const siblings = entries
      .slice(start, end)
      .filter((x) => x.level === t.level);
    return { ...t, position: siblings.indexOf(t) + 1, total: siblings.length };
  });
}
module.exports = {
  plainBlocks,
  breadcrumbs,
  makeGuide,
  search,
  resolveAnchor,
  stepMatch,
  colorMode,
  pageRanges,
  pageForOffset,
  extractHTML,
  belongsToGuide,
  validateImport,
};
