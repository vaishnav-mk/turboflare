import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { marked } from "marked";
import { build as esbuild } from "esbuild";

import { allPages, hrefFor } from "./pages.mjs";

const require = createRequire(import.meta.url);
const root = new URL("..", import.meta.url).pathname;
const outDir = join(root, "dist");
const tmp = join(root, ".build");

marked.setOptions({ gfm: true, breaks: false });

const LANG_MAP = { sh: "bash", shell: "bash", zsh: "bash" };
const LANG_LABELS = {
  bash: "Terminal",
  sh: "Terminal",
  shell: "Terminal",
  zsh: "Terminal",
  js: "JavaScript",
  javascript: "JavaScript",
  ts: "TypeScript",
  typescript: "TypeScript",
  tsx: "TSX",
  jsx: "JSX",
  json: "JSON",
  jsonc: "JSON",
  toml: "TOML",
  yaml: "YAML",
  yml: "YAML",
  css: "CSS",
  html: "HTML",
  env: ".env",
};

const COPY_SCRIPT = `document.addEventListener('click',function(e){var b=e.target.closest('.copy-btn');if(!b)return;var pre=b.closest('.code-block');var code=pre&&pre.querySelector('code');if(!code)return;navigator.clipboard.writeText(code.textContent).then(function(){b.textContent='Copied!';setTimeout(function(){b.textContent='Copy'},1500)})});`;

const SCROLLSPY_SCRIPT = `(function(){var toc=document.getElementById('toc-list');if(!toc)return;var links=toc.querySelectorAll('.toc-link[data-id]');if(!links.length)return;var ids=[];links.forEach(function(a){ids.push(a.getAttribute('data-id'))});var active=null;function set(id){if(active===id)return;active=id;links.forEach(function(a){if(a.getAttribute('data-id')===id){a.classList.add('active')}else{a.classList.remove('active')}})}var obs=new IntersectionObserver(function(entries){var vis=[];entries.forEach(function(e){if(e.isIntersecting)vis.push(e.target.id)});if(vis.length){set(vis[0])}else{var st=document.documentElement.scrollTop||document.body.scrollTop;var best=null;ids.forEach(function(id){var el=document.getElementById(id);if(el){var top=el.getBoundingClientRect().top;if(top<100&&(best===null||top>document.getElementById(best).getBoundingClientRect().top))best=id}});if(best)set(best)}},{rootMargin:'-60px 0px -70% 0px',threshold:0});ids.forEach(function(id){var el=document.getElementById(id);if(el)obs.observe(el)})})();`;

await rm(outDir, { force: true, recursive: true });
await rm(tmp, { force: true, recursive: true });
await mkdir(join(outDir, "assets"), { recursive: true });
await cp(join(root, "public"), outDir, { recursive: true });

const [renderBody, highlightCode] = await Promise.all([loadRenderer(), loadHighlighter()]);

const flat = allPages();

for (const page of flat) {
  const markdownPath = join(root, page.source);
  const markdownText = await readFile(markdownPath, "utf8");
  const markdown = stripFrontmatter(markdownText);
  const toc = headings(markdown);
  let bodyHtml = withHeadingIds(marked.parse(markdown), toc);
  bodyHtml = await highlightCodeBlocks(bodyHtml);
  const isHome = page.output === "index.html";
  const body = renderBody({ page, pages: flat, hrefFor, bodyHtml, toc, isHome });
  const outputPath = join(outDir, page.output);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, document(page, body));
}

const notFound = renderBody({
  page: { title: "Not Found", output: "404.html", section: "" },
  pages: flat,
  hrefFor,
  bodyHtml: "<h1>Not found</h1><p>That page does not exist.</p>",
  toc: [],
  isHome: false,
});
await writeFile(join(outDir, "404.html"), document({ title: "Not Found" }, notFound));

await copyKumoStyles();
await writeProse();
await rm(tmp, { force: true, recursive: true });

async function loadRenderer() {
  await mkdir(tmp, { recursive: true });
  const bundle = join(tmp, "renderer.cjs");
  await esbuild({
    entryPoints: [join(root, "scripts", "components.jsx")],
    outfile: bundle,
    bundle: true,
    format: "cjs",
    platform: "node",
    jsx: "automatic",
    logLevel: "error",
    loader: { ".js": "jsx" },
  });
  const mod = require(bundle);
  return mod.renderBody;
}

async function loadHighlighter() {
  const { highlightCode } = await import("@cloudflare/kumo/code/server");
  return highlightCode;
}

async function highlightCodeBlocks(html) {
  const regex = /<pre><code(?:\s+class="language-([^"]*)")?>([\s\S]*?)<\/code><\/pre>/g;
  const matches = [...html.matchAll(regex)].map((match) => ({
    full: match[0],
    lang: match[1] || "",
    code: match[2],
    index: match.index,
  }));
  if (matches.length === 0) return html;

  const results = await Promise.all(
    matches.map(async ({ lang, code }) => {
      const decoded = decodeHtmlEntities(code);
      const shikiLang = LANG_MAP[lang] || lang;
      const label = LANG_LABELS[lang] || lang || "";
      try {
        if (!shikiLang) return null;
        const highlighted = await highlightCode(decoded, shikiLang);
        return { highlighted, label };
      } catch {
        return null;
      }
    }),
  );

  let result = html;
  for (let i = matches.length - 1; i >= 0; i--) {
    const match = matches[i];
    const r = results[i];
    const label = r?.label || LANG_LABELS[match.lang] || "";
    const labelHtml = label ? `<span class="code-lang">${escapeHtml(label)}</span>` : "";
    const copyBtn = `<button class="copy-btn" type="button">Copy</button>`;
    const inner = r?.highlighted || `<pre><code>${match.code}</code></pre>`;
    result =
      result.slice(0, match.index) +
      `<div class="code-block">${labelHtml}${copyBtn}${inner}</div>` +
      result.slice(match.index + match.full.length);
  }
  return result;
}

async function copyKumoStyles() {
  const standalone = require.resolve("@cloudflare/kumo/styles/standalone");
  await cp(standalone, join(outDir, "assets", "kumo.css"));
}

function document(page, body) {
  return `<!doctype html>
<html lang="en" data-mode="dark" data-theme="kumo">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(page.title)} · Turboflare</title>
  <meta name="description" content="Cloudflare-native remote cache for Turborepo">
  <link rel="icon" href="/logo.svg">
  <link rel="preconnect" href="https://rsms.me">
  <link rel="stylesheet" href="https://rsms.me/inter/inter.css">
  <link rel="stylesheet" href="/assets/kumo.css">
  <link rel="stylesheet" href="/assets/prose.css">
</head>
<body>${body}<script>${COPY_SCRIPT}${SCROLLSPY_SCRIPT}</script></body>
</html>`;
}

function headings(markdown) {
  const fenced = fencedRanges(markdown);
  const lines = markdown.split("\n");
  const result = [];
  let offset = 0;
  for (const line of lines) {
    const match = /^(#{2,3})\s+(.+)$/.exec(line);
    const inFence = fenced.some((range) => offset >= range.start && offset < range.end);
    if (match !== null && !inFence) {
      const text = cleanHeading(match[2]);
      result.push({ depth: match[1].length, text, id: slug(text) });
    }
    offset += line.length + 1;
  }
  return result;
}

function fencedRanges(markdown) {
  const regex = /```[\s\S]*?```/g;
  return [...markdown.matchAll(regex)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
  }));
}

function withHeadingIds(html, toc) {
  let index = 0;
  return html.replace(/<h([23])>/g, (full, depth) => {
    const heading = toc[index];
    index += 1;
    return heading === undefined ? full : `<h${depth} id="${heading.id}">`;
  });
}

function cleanHeading(value) {
  return value
    .replace(/`([^`]*)`/g, "$1")
    .replace(/[*_]/g, "")
    .trim();
}

function slug(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function stripFrontmatter(value) {
  return value.startsWith("---") ? value.replace(/^---[\s\S]*?---\s*/, "") : value;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function decodeHtmlEntities(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

async function writeProse() {
  await cp(join(root, "styles", "prose.css"), join(outDir, "assets", "prose.css"));
}
