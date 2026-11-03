const { parseDocument, DomUtils } = require("htmlparser2");
function hash(s) {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0).toString(36);
}
function separateTextArtwork(input, initialBlocks = []) {
  const lines = input.split("\n"),
    original = [...lines],
    inserts = new Map(),
    special = [...initialBlocks];
  const marker = (block) => {
    const index = special.push(block) - 1;
    return `\uE000layout-${index}\uE001`;
  };
  const insert = (at, block) => {
    const list = inserts.get(at) || [];
    list.push(marker(block));
    inserts.set(at, list);
  };
  // Rectangular callouts may occupy the left or right half of prose lines.
  // Read that prose down the page, and keep the artwork as its own block.
  const masks = new Map();
  const near = (actual, expected) => Math.abs(actual - expected) <= 4;
  for (let i = 0; i < original.length; i++) {
    const top = /_{4,} {1,3}_{4,}|\+[-=]{3,}\+/g;
    for (const match of original[i].matchAll(top)) {
      const start = match.index,
        end = start + match[0].length;
      const spans = [{ line: i, start, end }];
      let bottom = -1;
      for (let j = i + 1; j < Math.min(original.length, i + 16); j++) {
        const line = original[j];
        const closing = [...line.matchAll(/[¯‾_]{4,}|\+[-=]{3,}\+/g)].find(
          (m) =>
            near(m.index, start + (match[0][0] === "+" ? 0 : 2)) &&
            near(m.index + m[0].length, end),
        );
        if (closing && spans.length >= 2) {
          spans.push({
            line: j,
            start: closing.index,
            end: closing.index + closing[0].length,
          });
          bottom = j;
          break;
        }
        const bars = [...line.matchAll(/\|/g)].map((m) => m.index);
        const left = bars.find((index) => near(index, start));
        const right = bars.filter((index) => near(index + 1, end)).at(-1);
        const corner = [...line.matchAll(/['’]\\/g)].find((m) =>
          near(m.index, start),
        );
        const from = corner?.index ?? left;
        if (from === undefined || right === undefined || right <= from) break;
        spans.push({ line: j, start: from, end: right + 1 });
      }
      if (bottom < 0) continue;
      const outside = spans.map((span) =>
        [
          original[span.line].slice(0, span.start).trim(),
          original[span.line].slice(span.end).trim(),
        ]
          .filter(Boolean)
          .join(" "),
      );
      const hasOutsideText = outside.some((line) => /[A-Za-z0-9]/.test(line));
      // The paired underscore roof is the FAQ's item-found callout. Plain
      // tiny +---+ diagrams stay with the generic fixed-width parser.
      if (
        match[0].startsWith("+") &&
        !hasOutsideText &&
        !spans.some(
          (span) =>
            original[span.line]
              .slice(span.start, span.end)
              .trim()
              .split(/\s+/)
              .filter((word) => /[A-Za-z]{2,}/.test(word)).length >= 2,
        )
      )
        continue;
      const origin = Math.min(...spans.map((span) => span.start));
      const art = spans
        .map(
          (span) =>
            " ".repeat(span.start - origin) +
            original[span.line].slice(span.start, span.end),
        )
        .join("\n");
      for (const span of spans) {
        const row = masks.get(span.line) || [];
        row.push(span);
        masks.set(span.line, row);
      }
      let after = bottom + 1;
      while (
        hasOutsideText &&
        after < original.length &&
        original[after].trim()
      )
        after++;
      insert(after, { kind: "pre", text: art, level: 0 });
    }
  }
  for (const [index, spans] of masks) {
    let cursor = 0;
    const prose = [];
    for (const span of spans.sort((a, b) => a.start - b.start)) {
      if (span.start > cursor)
        prose.push(original[index].slice(cursor, span.start));
      cursor = Math.max(cursor, span.end);
    }
    prose.push(original[index].slice(cursor));
    lines[index] = prose
      .map((part) => part.trim())
      .filter(Boolean)
      .join(" ");
  }
  // Underlined place/item labels are headings, not ASCII fragments in prose.
  for (let i = 0; i + 2 < lines.length; i++) {
    if (
      !/^\s*[-=_¯‾~]{6,}\s*$/.test(lines[i]) ||
      !/^\s*[-=_¯‾]{4,}\s*$/.test(lines[i + 2])
    )
      continue;
    const title = lines[i + 1].trim();
    if (
      !/[A-Za-z]/.test(title) ||
      title.length > 80 ||
      /[|/\\]/.test(title) ||
      title.split(/\s+/).length > 9
    )
      continue;
    lines[i] = "";
    lines[i + 1] = marker({
      kind: "heading",
      text: title,
      level: 3,
      toc: false,
    });
    lines[i + 2] = "";
  }
  const output = [];
  for (let i = 0; i <= lines.length; i++) {
    for (const value of inserts.get(i) || []) output.push("", value, "");
    if (i < lines.length) output.push(lines[i]);
  }
  return { text: output.join("\n"), special };
}
function plainBlocks(input) {
  // Numbered FAQ headings may be embedded between decorative rules without
  // blank lines. Separate them before artwork classification can swallow them.
  const sourceLines = input.replace(/\r/g, "").split("\n");
  const rule = (line) => /^[ \t]*[-=~_*]{5,}[ \t]*$/.test(line || "");
  const banners = [];
  const numberedBlocks = [];
  const markHeading = (i, title, level) => {
    const index =
      numberedBlocks.push({ kind: "heading", text: title, level }) - 1;
    sourceLines[i] = `\uE000layout-${index}\uE001`;
  };
  // Tabular contents may give lettered section numbers and a separate find
  // code. Match the banner's title and nearby code, never a prose reference.
  const codedContents = new Map();
  for (const line of sourceLines) {
    const entry = line.match(
      /^\s*(?:(\d+[a-z]*[.)])\s*)?([A-Za-z].*?)(?:[ \t]{2,}|\t+)([A-Z0-9]{4})\s*$/,
    );
    if (entry)
      codedContents.set(entry[3], {
        label: entry[1] || "",
        title: entry[2].trim(),
      });
  }
  const codedRule = (line) =>
    /^[ \t]*[=+]{12,}[ \t]*$/.test(line || "") &&
    /=/.test(line) &&
    /\+/.test(line);
  for (let i = 1; i + 1 < sourceLines.length; i++) {
    const fullFrame =
      codedRule(sourceLines[i - 1]) && codedRule(sourceLines[i + 1]);
    const underlined = /^[ \t]*[-=]{5,}[ \t]*$/.test(sourceLines[i + 1] || "");
    if (!fullFrame && !underlined) continue;
    const title = sourceLines[i].trim();
    let codeIndex = i + 2;
    while (
      codeIndex < Math.min(sourceLines.length, i + 6) &&
      !sourceLines[codeIndex].trim()
    )
      codeIndex++;
    const code = sourceLines[codeIndex]
      ?.trim()
      .match(/^(?:\d+[a-z]*-)?([A-Z0-9]{4})$/i)?.[1]
      .toUpperCase();
    const entry = code && codedContents.get(code);
    if (entry && /[A-Za-z]/.test(title) && title.length <= 120) {
      const level =
        /^\d+[a-z]+[.)]$/.test(entry.label) && !/^\d+a[.)]$/.test(entry.label)
          ? 2
          : 1;
      markHeading(
        i,
        (entry.label ? entry.label + " " : "") + entry.title,
        level,
      );
      numberedBlocks.at(-1).sourceIds = [code];
      sourceLines[codeIndex] = "";
    } else if (
      fullFrame &&
      codedContents.size &&
      /^introduction$/i.test(title)
    ) {
      markHeading(i, title, 1);
    } else continue;
    if (fullFrame) sourceLines[i - 1] = "";
    sourceLines[i + 1] = "";
  }
  // Bracket-first contents lists can point at codes placed beside a large
  // ASCII emblem. Recognize the bounded emblem, not references in prose.
  const indexedTitles = new Map();
  for (const line of sourceLines) {
    const entry = line.match(/^\s*\[(\d{4})\]\s+([A-Za-z].{0,159})\s*$/);
    if (entry && !indexedTitles.has(entry[1]))
      indexedTitles.set(entry[1], entry[2].trim());
  }
  const emblemRule = (line) =>
    (line || "").trim().match(/^(?:([-~])o){6,}[-~]?$/i);
  for (let start = 0; start < sourceLines.length; start++) {
    const border = emblemRule(sourceLines[start]);
    if (!border) continue;
    let end = start + 1;
    while (
      end < Math.min(sourceLines.length, start + 25) &&
      !emblemRule(sourceLines[end])
    )
      end++;
    if (
      !emblemRule(sourceLines[end]) ||
      sourceLines[start].trim()[0] !== sourceLines[end].trim()[0]
    )
      continue;
    const titles = [],
      codes = [];
    let decorationOnly = true;
    for (let i = start + 1; i < end; i++) {
      const line = sourceLines[i];
      const margin = line.match(/^\s*[-~_=+|/\\<>.#*z]+[ \t]{2,}(.+?)\s*$/i);
      const code = line.match(/\[(\d{4})\]\s*$/);
      if (code && /^[\s\-~_=+|/\\<>.#*z]*$/i.test(line.slice(0, code.index)))
        codes.push(code[1]);
      else if (margin && /[A-Za-z]/.test(margin[1]))
        titles.push(margin[1].trim());
      else if (!/^[\s\-~_=+|/\\<>.#*z]*$/i.test(line)) decorationOnly = false;
    }
    if (!decorationOnly || codes.length !== 1 || !titles.length) continue;
    const code = codes[0],
      indexedTitle = indexedTitles.get(code),
      title = indexedTitle || titles.join(" ");
    const context = indexedTitle
      ? titles
          .slice(0, -1)
          .filter(
            (value) =>
              !indexedTitle.toLowerCase().includes(value.toLowerCase()),
          )
      : [];
    markHeading(
      start,
      [...context, title].join(" — "),
      sourceLines[start].trim()[0] === "-" ? 1 : 2,
    );
    numberedBlocks.at(-1).sourceIds = [code];
    sourceLines[start] = "\n" + sourceLines[start];
    for (let i = start + 1; i <= end; i++) sourceLines[i] = "";
    start = end;
  }
  // Some guides spell their section names with spaced letters inside wide
  // ASCII frames. Resolve those names against their compact contents labels.
  const compactName = (value) =>
    value.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
  const compactContents = new Map();
  for (const line of sourceLines) {
    const entry = line.match(
      /^\s*(\d+)\)\s*([A-Za-z][A-Za-z0-9 &().,'/-]{0,100})\s*$/,
    );
    if (entry)
      compactContents.set(
        `${entry[1]}:${compactName(entry[2])}`,
        entry[2].trim(),
      );
  }
  const framedRule = (line) =>
    /^[\s/\\_=]+$/.test(line || "") && /={12,}/.test(line);
  const framed = [];
  for (let i = 1; i + 1 < sourceLines.length; i++) {
    if (!framedRule(sourceLines[i - 1]) || !framedRule(sourceLines[i + 1]))
      continue;
    const entry = sourceLines[i].match(
      /^[\s/\\_]*(\d+)\)\s*(.*?)\s*[\s/\\_]*$/,
    );
    if (!entry || !/[A-Za-z]/.test(entry[2])) continue;
    const title = compactContents.get(`${entry[1]}:${compactName(entry[2])}`);
    if (!title) continue; // A matching contents label avoids guessing word breaks.
    framed.push({ index: i, title: `${entry[1]}) ${title}` });
  }
  for (const { index: i, title } of framed) {
    markHeading(i, title, 1);
    sourceLines[i - 1] = sourceLines[i + 1] = "";
    if (
      /^[\s/\\_]+$/.test(sourceLines[i - 2] || "") &&
      /[/\\]/.test(sourceLines[i - 2] || "")
    )
      sourceLines[i - 2] = "";
  }
  for (let i = 1; i < sourceLines.length - 1; i++) {
    const title = sourceLines[i].trim();
    if (!rule(sourceLines[i - 1]) || !rule(sourceLines[i + 1])) continue;
    // Decimal-colon banners use .0 for a main section. Some authors insert
    // fractional labels such as 4.9 1/2 between two ordinary subsections.
    const wrapped = title.match(
      /^\{[<>]+\}\s*(\d+(?:\.\d+)+(?:\s+\d+\/\d+)?)\s*:\s*(.{1,100}?)\s*\{[<>]+\}$/,
    );
    if (wrapped && /[A-Za-z]/.test(wrapped[2])) {
      const label = wrapped[1].replace(/\s+/g, " ");
      const index =
        numberedBlocks.push({
          kind: "heading",
          text: `${label}: ${wrapped[2].trim()}`,
          level: /^\d+\.0$/.test(label) ? 1 : 2,
        }) - 1;
      sourceLines[i] = `\uE000layout-${index}\uE001`;
      banners.push(i);
    } else if (
      framed.length &&
      /^(?:[ivxlcdm]+\)\s*)?[A-Za-z][A-Za-z0-9 ’'&():,./-]{0,95}$/.test(
        title,
      ) &&
      title.split(/\s+/).length <= 12
    ) {
      // In this style, two-rule chapter banners (including i)/ii) item
      // groups) are subsections. Single-underlined location labels stay local.
      markHeading(i, title.replace(/^([ivxlcdm]+\))\s*/, "$1 "), 2);
      banners.push(i);
    } else if (/^\d+(?:\.\d+)*[.)]?\s+[A-Za-z][^!?]{1,90}$/.test(title)) {
      banners.push(i);
    }
  }
  for (const i of banners) {
    for (let j = i - 1; j >= 0 && rule(sourceLines[j]); j--)
      sourceLines[j] = "";
    for (let j = i + 1; j < sourceLines.length && rule(sourceLines[j]); j++)
      sourceLines[j] = "";
    sourceLines[i] = sourceLines[i].trim();
  }
  const { text, special } = separateTextArtwork(
    sourceLines.join("\n"),
    numberedBlocks,
  );
  const contents = new Map();
  const untagged = [];
  // FAQ authors commonly link their contents to bracketed labels in banners.
  for (const line of text.split("\n")) {
    const m = line.match(
      /^\s*((?:[IVXLCDM]+|\d+|[a-z])[.)])\s+(.+?)\s*\.{2,}\s*\[([\w-]+)\]\s*$/,
    );
    const parent = line.match(
      /^\s*((?:[IVXLCDM]+|[a-z])[.)])\s+([A-Za-z][A-Za-z &/-]+)\s*$/,
    );
    if (parent)
      untagged.push({
        title: `${parent[1]} ${parent[2].trim()}`,
        name: parent[2].trim(),
        level: /^[a-z]/.test(parent[1]) ? 2 : 1,
      });
    if (m)
      contents.set(m[3], {
        title: `${m[1]} ${m[2].trim()}`,
        level: /^[a-z]/.test(m[1]) ? 2 : 1,
      });
  }
  return text
    .split(/\n[ \t]*\n/)
    .filter((part) => part.trim())
    .flatMap((part) => {
      // Some FAQs put banners directly between paragraphs without blank lines.
      // Split only recognized banners, preserving all surrounding prose.
      const lines = part.split("\n"),
        spans = [];
      for (let i = 0; i < lines.length; i++) {
        if (/[a-z]/.test(lines[i]) || /\.{2,}\s*\[[\w-]+\]/.test(lines[i]))
          continue;
        const letters = lines[i].replace(/[^A-Z0-9]/g, "");
        const tagged = [...contents.keys()].some((tag) =>
          lines[i].includes(`[${tag}]`),
        );
        const named = untagged.some(
          (entry) =>
            letters === entry.name.toUpperCase().replace(/[^A-Z0-9]/g, ""),
        );
        if (!tagged && !named) continue;
        let start = i,
          end = i + 1;
        while (start > 0 && !/[a-z]/.test(lines[start - 1])) start--;
        while (end < lines.length && !/[a-z]/.test(lines[end])) end++;
        if (!spans.some((span) => span.start <= start && span.end >= end))
          spans.push({ start, end });
      }
      const out = [];
      let cursor = 0;
      for (const { start, end } of spans) {
        if (start > cursor) out.push(lines.slice(cursor, start).join("\n"));
        out.push(lines.slice(start, end).join("\n"));
        cursor = end;
      }
      if (cursor < lines.length) out.push(lines.slice(cursor).join("\n"));
      return out.filter((value) => value.trim());
    })
    .map((part) => {
      const layout = part.trim().match(/^\uE000layout-(\d+)\uE001$/);
      if (layout) return special[Number(layout[1])];
      const originalLines = part.split("\n");
      // Only a stand-alone banner may resolve a TOC label. A reference in prose
      // or in the original contents must not become a destination.
      if (!/\.{2,}\s*\[[\w-]+\]/.test(part) && !/[a-z]/.test(part)) {
        for (const [tag, entry] of contents) {
          if (part.includes(`[${tag}]`))
            return {
              kind: "heading",
              text: entry.title,
              level: entry.level,
              sourceIds: [tag],
            };
        }
      }
      if (!/[a-z]/.test(part) && !/\.{2,}/.test(part)) {
        const letters = part.replace(/[^A-Z0-9]/g, "");
        const entry = untagged.find(
          (entry) =>
            letters === entry.name.toUpperCase().replace(/[^A-Z0-9]/g, ""),
        );
        if (entry)
          return { kind: "heading", text: entry.title, level: entry.level };
      }
      // A frame around prose is decoration, not a fixed-width map. Remove only
      // its border; keep every word inside it.
      const lines = originalLines.map((line) => {
        const frame = line.match(/^\s*\|\s?(.*?)\s*\|\s*$/);
        return frame &&
          frame[1].split(/\s+/).filter((word) => /[a-z]{2,}/.test(word))
            .length >= 4
          ? frame[1]
          : line;
      });
      const value = lines.join("\n");
      const nonempty = lines.filter((line) => line.trim());
      const artLines = nonempty.filter((line) => {
        const compact = line.replace(/\s/g, "");
        const symbols = compact.replace(/[\p{L}\p{N}.,'’!?():;]/gu, "").length;
        return (
          !/^#{1,6} /.test(line.trim()) &&
          !/[a-z]/.test(line) &&
          compact.length > 2 &&
          symbols / compact.length > 0.35
        );
      });
      const table =
        nonempty.length > 1 &&
        nonempty.every((line) => {
          const cells = line.trim().split(/ {3,}|\t+/);
          return (
            cells.length > 1 &&
            cells.every((cell) => cell.length < 25) &&
            line.trim().split(/\s+/).length < 9
          );
        }) &&
        nonempty.some((line) => /(?: {3,}|\t+)\d/.test(line));
      const prose = nonempty.some(
        (line) =>
          line.split(/\s+/).filter((word) => /[a-z]{2,}/.test(word)).length >=
          4,
      );
      const fields = nonempty.filter((line) =>
        /^\s*[A-Z][A-Za-z ]+:/.test(line),
      );
      const metadata =
        fields.length >= 2 ||
        (fields.length > 0 && nonempty.some((line) => /^\s*[-*•] /.test(line)));
      const pre =
        !prose &&
        !metadata &&
        (table ||
          /[|+].*[|+]/.test(value) ||
          (artLines.length >= Math.min(2, nonempty.length) &&
            artLines.length >= Math.ceil(nonempty.length * 0.6) &&
            artLines.length > 0) ||
          (nonempty.length > 2 &&
            nonempty.every((line) => /^[\sA-Z0-9$=~?+.,:;-]+$/.test(line)) &&
            nonempty.some((line) => /([A-Z0-9])\1{2}/.test(line))));
      const trimmed = value.trim();
      const heading =
        !pre &&
        trimmed.length < 100 &&
        !trimmed.includes("\n") &&
        (/^[A-Z\d][A-Z\d\s: .—-]+$/.test(trimmed) ||
          /^#{1,6} /.test(trimmed) ||
          /^(?:\d+(?:\.\d+)*|[IVXLCDM]+)[.)]?\s+[A-Z][^.!?]{1,70}$/.test(
            trimmed,
          ));
      const list =
        metadata ||
        nonempty.every((line) => /^\s*(?:[-*•]|\d+[.)]) /.test(line));
      return {
        kind: pre ? "pre" : heading ? "heading" : list ? "list" : "paragraph",
        text:
          pre || (list && !heading)
            ? value
            : trimmed.replace(/\s*\n\s*/g, " ").replace(/[ \t]{2,}/g, " "),
        level: heading
          ? trimmed.match(/^#+/)?.[0].length ||
            (trimmed.match(/^\d+(?:\.\d+)+[.)]?\s/)?.[0].match(/\.\d/g)
              ?.length || 0) + 1
          : 0,
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
      if (b.kind === "heading" && b.toc !== false) {
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
  query = query.trim();
  if (!query) return [];
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
const guidePageViews = ["print", "single"];
function guidePageURL(candidate, base) {
  const next = new URL(candidate, base),
    root = new URL(base);
  next.hash = "";
  if (/(^|\.)gamefaqs\.gamespot\.com$/.test(root.hostname)) {
    for (const view of guidePageViews) {
      if (next.searchParams.get(view) !== root.searchParams.get(view))
        return undefined;
    }
    if (
      (root.searchParams.has("single") || root.searchParams.has("print")) &&
      next.searchParams.get("page") !== root.searchParams.get("page")
    )
      return undefined;
    if (next.searchParams.get("page") === "0") next.searchParams.delete("page");
  }
  return next.href;
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
  guidePageURL,
  guidePageViews,
  validateImport,
};
