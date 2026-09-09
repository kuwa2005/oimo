#!/usr/bin/env bun
// Generates docs/index.html — a self-contained two-pane viewer for docs/**/*.md
import { mkdir } from "node:fs/promises"
import { dirname, resolve } from "node:path"

const docsDir = resolve(import.meta.dir, "../docs")
const markedPath = resolve(import.meta.dir, "vendor/marked.min.js")

export type DocEntry = {
  path: string
  title: string
  group: string
  /** Embedded markdown body (local offline viewer). */
  content?: string
  /** Relative URL for on-demand fetch (GitHub Pages). */
  contentUrl?: string
}

export function collectDocs(dir: string): string[] {
  const glob = new Bun.Glob("**/*.md")
  return [...glob.scanSync({ cwd: dir, onlyFiles: true })].filter((p) => !p.includes("index.html")).sort()
}

/** Public Pages set: drop fr/ru locales and compose planning artifacts. */
export function isPagesDoc(relPath: string): boolean {
  if (/\.(fr|ru)\.md$/i.test(relPath)) return false
  if (relPath.startsWith("compose/plans/") || relPath.startsWith("compose/reports/")) return false
  return true
}

export function titleOf(content: string, relPath: string): string {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(content)
  if (frontmatter) {
    const title = /^title:\s*(.+)$/m.exec(frontmatter[1])
    if (title) return title[1].trim().replace(/^["']|["']$/g, "")
  }
  const h1 = /^#\s+(.+)$/m.exec(content)
  if (h1) return h1[1].trim()
  return relPath.split("/").pop()!.replace(/\.md$/, "")
}

export function groupOf(relPath: string): string {
  const parts = relPath.split("/")
  if (parts.length === 1) return "トップ"
  if (parts[0] === "compose" && parts[1]) return parts[1]
  return parts[0]
}

export function escapeForScript(s: string): string {
  return JSON.stringify(s).replace(/</g, "\\u003c")
}

export function renderDocsIndex(docs: DocEntry[], markedSrc: string): string {
  const manifest = JSON.stringify(docs).replace(/</g, "\\u003c")
  return `<!doctype html>
<html lang="ja" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>oimo Docs</title>
<style>
:root {
  --bg: #ffffff; --fg: #1f2328; --muted: #57606a; --border: #d0d7de;
  --accent: #0969da; --code-bg: #f6f8fa; --nav-bg: #f6f8fa; --hover: #eaeef2;
  --panel: #ffffff;
}
:root[data-theme="dark"] {
  --bg: #0d1117; --fg: #e6edf3; --muted: #8b949e; --border: #30363d;
  --accent: #4493f8; --code-bg: #161b22; --nav-bg: #161b22; --hover: #1c2128;
  --panel: #0d1117;
}
* { box-sizing: border-box; }
html, body { height: 100%; }
body {
  margin: 0; display: flex; flex-direction: column;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  background: var(--bg); color: var(--fg); font-size: 15px; line-height: 1.6;
}
header {
  display: flex; align-items: center; gap: 12px; padding: 10px 16px;
  border-bottom: 1px solid var(--border); background: var(--nav-bg);
}
header h1 { font-size: 16px; margin: 0; }
header #doc-count { color: var(--muted); font-size: 13px; }
header #theme-toggle {
  margin-left: auto; border: 1px solid var(--border); border-radius: 6px;
  background: var(--panel); color: var(--fg); cursor: pointer; padding: 4px 10px;
}
#layout { display: flex; flex: 1; min-height: 0; }
aside {
  width: 330px; min-width: 330px; overflow-y: auto; border-right: 1px solid var(--border);
  background: var(--nav-bg); padding: 12px;
}
aside #filter {
  width: 100%; padding: 7px 10px; margin-bottom: 12px; border-radius: 6px;
  border: 1px solid var(--border); background: var(--panel); color: var(--fg);
}
#groups section { margin-bottom: 10px; }
#groups h2 {
  font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em;
  color: var(--muted); margin: 10px 0 4px;
}
#groups a {
  display: block; padding: 4px 8px; border-radius: 6px; color: var(--fg);
  text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
#groups a:hover { background: var(--hover); }
#groups a.active { background: var(--accent); color: #fff; }
#no-results { color: var(--muted); font-size: 13px; padding: 8px; }
main { flex: 1; overflow-y: auto; padding: 24px 32px; max-width: 960px; }
#doc-meta { border-bottom: 1px solid var(--border); margin-bottom: 16px; padding-bottom: 12px; }
#doc-meta h1 { margin: 0 0 4px; font-size: 24px; }
#doc-meta code { color: var(--muted); font-size: 12px; }
#content h1 { border-bottom: 1px solid var(--border); padding-bottom: 6px; }
#content h2 { border-bottom: 1px solid var(--border); padding-bottom: 4px; }
#content pre {
  background: var(--code-bg); border: 1px solid var(--border); border-radius: 8px;
  padding: 12px; overflow-x: auto;
}
#content code { background: var(--code-bg); border-radius: 4px; padding: 1px 5px; font-size: 13px; }
#content pre code { background: none; border-radius: 0; padding: 0; }
#content table { border-collapse: collapse; margin: 12px 0; width: 100%; }
#content th, #content td { border: 1px solid var(--border); padding: 6px 10px; text-align: left; }
#content th { background: var(--nav-bg); }
#content blockquote {
  margin: 0; padding: 2px 14px; color: var(--muted);
  border-left: 4px solid var(--border);
}
#content img { max-width: 100%; }
</style>
</head>
<body>
<header>
  <h1>oimo Docs</h1>
  <span id="doc-count"></span>
  <button id="theme-toggle" type="button" title="テーマ切替">☾</button>
</header>
<div id="layout">
  <aside>
    <input id="filter" type="search" placeholder="文書を検索..." autocomplete="off">
    <div id="groups"></div>
    <div id="no-results" hidden>該当する文書がありません</div>
  </aside>
  <main id="viewer">
    <div id="doc-meta"></div>
    <article id="content"></article>
  </main>
</div>
<script type="application/json" id="docs-manifest">${manifest}</script>
<script>__MARKED_SRC__</script>
<script>
(function () {
  "use strict";
  var DOCS = JSON.parse(document.getElementById("docs-manifest").textContent);
  var groupsEl = document.getElementById("groups");
  var filterEl = document.getElementById("filter");
  var contentEl = document.getElementById("content");
  var metaEl = document.getElementById("doc-meta");
  var noResultsEl = document.getElementById("no-results");
  var GROUP_ORDER = ["トップ", "specs", "spec", "plans", "reports", "architecture", "harness"];
  var GROUP_LABELS = { "トップ": "トップ", specs: "Specs", spec: "Spec", plans: "Plans", reports: "Reports", architecture: "Architecture", harness: "Harness" };

  document.getElementById("doc-count").textContent = DOCS.length + " 文書";

  function groupLabel(g) { return GROUP_LABELS[g] || g; }

  function renderNav(query) {
    var q = (query || "").toLowerCase();
    var visible = DOCS.filter(function (d) {
      return !q || d.title.toLowerCase().indexOf(q) !== -1 || d.path.toLowerCase().indexOf(q) !== -1;
    });
    var byGroup = {};
    visible.forEach(function (d) {
      (byGroup[d.group] = byGroup[d.group] || []).push(d);
    });
    var groups = Object.keys(byGroup).sort(function (a, b) {
      var i = GROUP_ORDER.indexOf(a), j = GROUP_ORDER.indexOf(b);
      return (i === -1 ? 99 : i) - (j === -1 ? 99 : j) || a.localeCompare(b);
    });
    groupsEl.innerHTML = "";
    groups.forEach(function (g) {
      var section = document.createElement("section");
      var h = document.createElement("h2");
      h.textContent = groupLabel(g) + " (" + byGroup[g].length + ")";
      section.appendChild(h);
      byGroup[g].forEach(function (d) {
        var a = document.createElement("a");
        a.href = "#" + encodeURIComponent(d.path);
        a.dataset.path = d.path;
        a.textContent = d.title;
        a.title = d.path;
        a.addEventListener("click", function (e) { e.preventDefault(); openDoc(d); });
        section.appendChild(a);
      });
      groupsEl.appendChild(section);
    });
    noResultsEl.hidden = visible.length !== 0;
  }

  function showMarkdown(doc, markdown) {
    var links = groupsEl.querySelectorAll("a[data-path]");
    for (var i = 0; i < links.length; i++) links[i].classList.toggle("active", links[i].dataset.path === doc.path);
    metaEl.innerHTML = "";
    var h = document.createElement("h1");
    h.textContent = doc.title;
    var p = document.createElement("code");
    p.textContent = doc.path;
    metaEl.appendChild(h);
    metaEl.appendChild(p);
    var html = marked.parse(markdown);
    var parsed = new DOMParser().parseFromString(html, "text/html");
    var unsafe = parsed.querySelectorAll("script, iframe, object, embed");
    for (var j = 0; j < unsafe.length; j++) unsafe[j].remove();
    contentEl.innerHTML = parsed.body.innerHTML;
    contentEl.scrollTop = 0;
    history.replaceState(null, "", "#" + encodeURIComponent(doc.path));
  }

  function openDoc(doc) {
    if (typeof doc.content === "string") {
      showMarkdown(doc, doc.content);
      return;
    }
    if (!doc.contentUrl) {
      contentEl.textContent = "文書本文がありません";
      return;
    }
    contentEl.textContent = "読み込み中…";
    fetch(doc.contentUrl)
      .then(function (r) {
        if (!r.ok) throw new Error(String(r.status));
        return r.text();
      })
      .then(function (text) { showMarkdown(doc, text); })
      .catch(function () { contentEl.textContent = "読み込みに失敗しました"; });
  }

  function openFromHash() {
    var h = decodeURIComponent(location.hash.slice(1));
    var doc = DOCS.filter(function (d) { return d.path === h; })[0];
    if (doc) openDoc(doc);
  }

  filterEl.addEventListener("input", function () { renderNav(filterEl.value); });
  window.addEventListener("hashchange", openFromHash);

  var THEME_KEY = "oimo-docs-theme";
  var rootEl = document.documentElement;
  var themeBtn = document.getElementById("theme-toggle");
  function applyTheme(t) {
    rootEl.dataset.theme = t;
    themeBtn.textContent = t === "dark" ? "☀" : "☾";
    try { localStorage.setItem(THEME_KEY, t); } catch (e) {}
  }
  var saved;
  try { saved = localStorage.getItem(THEME_KEY); } catch (e) {}
  applyTheme(saved || (window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
  themeBtn.addEventListener("click", function () {
    applyTheme(rootEl.dataset.theme === "dark" ? "light" : "dark");
  });

  renderNav("");
  openFromHash();
})();
</script>
</body>
</html>`.split("__MARKED_SRC__").join(markedSrc)
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const pages = args.includes("--pages")
  const outIdx = args.indexOf("--out")
  const outDir = outIdx >= 0 ? resolve(args[outIdx + 1] ?? "_site") : resolve(docsDir)

  const files = collectDocs(docsDir).filter((p) => (pages ? isPagesDoc(p) : true))
  const markedSrc = await Bun.file(markedPath).text()

  if (pages) {
    const docs: DocEntry[] = []
    for (const path of files) {
      const content = await Bun.file(resolve(docsDir, path)).text()
      const contentUrl = `md/${path}`
      const dest = resolve(outDir, contentUrl)
      await mkdir(dirname(dest), { recursive: true })
      await Bun.write(dest, content)
      docs.push({ path, title: titleOf(content, path), group: groupOf(path), contentUrl })
    }
    await mkdir(outDir, { recursive: true })
    await Bun.write(resolve(outDir, "index.html"), renderDocsIndex(docs, markedSrc))
    console.log(`pages site generated at ${outDir} (${docs.length} docs, lazy)`)
  } else {
    const docs = await Promise.all(
      files.map(async (path) => {
        const content = await Bun.file(resolve(docsDir, path)).text()
        return { path, title: titleOf(content, path), group: groupOf(path), content }
      }),
    )
    await Bun.write(resolve(outDir, "index.html"), renderDocsIndex(docs, markedSrc))
    console.log(`docs/index.html generated (${docs.length} docs)`)
  }
}
