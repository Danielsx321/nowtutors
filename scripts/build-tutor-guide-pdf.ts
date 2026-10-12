// Builds public/tutor-guide.pdf from the tutor guide (src/content/tutor-guide.ts).
// Run from the repo root: pnpm guide:pdf
//
// The same content module feeds /tutor/guide; this file lays it out for A4 with
// the site's colours (lib/design/tokens.ts) and prints it with Playwright's
// chromium, which the E2E suite already installs. Internal links become
// absolute nowtutors.com links so they work from a PDF reader. The approval
// email and the one-off tutor-guide email attach the file by URL
// (emails/templates.tsx), and /tutor/pending-approval links it, so re-run this
// after every edit to the guide and commit the result.
//
// One chromium, one page, closed on exit. Never run it in a batch on this Mac.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { TUTOR_GUIDE, type GuideBlock } from "../src/content/tutor-guide";
import { parseInline } from "../src/content/inline";
import { tokens } from "../src/lib/design/tokens";

const SITE = "https://nowtutors.com";
const OUT = "public/tutor-guide.pdf";

const root = process.cwd();
const c = {
  text: tokens.text.light,
  muted: tokens["text-muted"].light,
  navy: tokens.band.light,
  accent: tokens.accent.light,
  highlight: tokens.highlight.light,
  border: tokens.border.light,
  raised: tokens["surface-raised"].light,
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function inline(text: string): string {
  return parseInline(text)
    .map((seg) => {
      if (seg.kind === "text") return esc(seg.text);
      const href = seg.href.startsWith("/") ? `${SITE}${seg.href}` : seg.href;
      return `<a href="${esc(href)}">${esc(seg.label)}</a>`;
    })
    .join("");
}

function block(b: GuideBlock): string {
  switch (b.kind) {
    case "p":
      return `<p>${inline(b.text)}</p>`;
    case "list":
      return `<ul>${b.items.map((i) => `<li>${inline(i)}</li>`).join("")}</ul>`;
    case "steps":
      return `<ol>${b.items.map((i) => `<li>${inline(i)}</li>`).join("")}</ol>`;
    case "note":
      return `<aside>${inline(b.text)}</aside>`;
  }
}

const wordmark = fs
  .readFileSync(path.join(root, "public/brand/wordmark.v1.svg"), "utf8")
  .replace(/fill="#000"/g, 'fill="#FFFFFF"')
  .replace(/^<svg([^>]*)>/, '<svg$1 height="34" width="auto">');

const g = TUTOR_GUIDE;
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(g.title)} · NowTutors</title>
<style>
  @page { size: A4; margin: 18mm 16mm 20mm; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 11pt; line-height: 1.55; color: ${c.text};
  }
  .band {
    background: ${c.navy}; color: #fff; border-radius: 10px;
    padding: 22px 26px 24px; margin: 0 0 22px;
  }
  .band svg { display: block; height: 34px; width: auto; }
  .band h1 { margin: 16px 0 4px; font-size: 26pt; line-height: 1.1; letter-spacing: -0.02em; font-weight: 600; }
  .band p { margin: 0; color: rgba(255,255,255,0.78); font-size: 10pt; }
  .intro p { margin: 0 0 10px; }
  .toc { border: 1px solid ${c.border}; background: ${c.raised}; border-radius: 8px; padding: 12px 18px 12px 18px; margin: 16px 0 6px; }
  .toc p { margin: 0 0 6px; font-weight: 600; font-size: 10pt; }
  .toc ol { margin: 0; padding-left: 18px; columns: 2; column-gap: 24px; font-size: 10pt; }
  .toc li { break-inside: avoid; margin: 0 0 3px; }
  section { margin-top: 22px; }
  h2 { font-size: 15pt; margin: 0 0 8px; color: ${c.navy}; letter-spacing: -0.01em; break-after: avoid; }
  p { margin: 0 0 9px; }
  ul, ol { margin: 0 0 10px; padding-left: 20px; }
  li { margin: 0 0 5px; }
  aside {
    border-left: 4px solid ${c.highlight}; background: ${c.raised};
    padding: 9px 14px; margin: 10px 0 12px; border-radius: 0 8px 8px 0; font-size: 10pt; break-inside: avoid;
  }
  a { color: ${c.accent}; text-decoration: underline; }
  .end { margin-top: 26px; padding-top: 12px; border-top: 1px solid ${c.border}; color: ${c.muted}; font-size: 9.5pt; }
</style>
</head>
<body>
  <div class="band">
    ${wordmark}
    <h1>${esc(g.title)}</h1>
    <p>Last updated ${esc(g.updated)} · The latest version is always at ${SITE}/tutor/guide</p>
  </div>
  <div class="intro">${g.intro.map((t) => `<p>${inline(t)}</p>`).join("")}</div>
  <nav class="toc"><p>In this guide</p><ol>${g.sections.map((s) => `<li>${esc(s.title)}</li>`).join("")}</ol></nav>
  ${g.sections.map((s) => `<section id="${s.id}"><h2>${esc(s.title)}</h2>${s.blocks.map(block).join("")}</section>`).join("")}
  <p class="end">NowTutors · ${SITE} · Reply to any NowTutors email to reach a person.</p>
</body>
</html>`;

// `--html <path>` also writes the HTML, to screenshot the layout where no PDF viewer runs.
const htmlOut = process.argv[process.argv.indexOf("--html") + 1];
if (process.argv.includes("--html") && htmlOut) fs.writeFileSync(htmlOut, html);

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "load" });
  await page.pdf({
    path: path.join(root, OUT),
    format: "A4",
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: "<div></div>",
    footerTemplate: `<div style="width:100%;text-align:center;font-size:8px;color:#6b7280;font-family:Helvetica,Arial,sans-serif">NowTutors tutor guide · page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`,
  });
} finally {
  await browser.close();
}
const size = fs.statSync(path.join(root, OUT)).size;
console.log(`${OUT}: ${Math.round(size / 1024)} KB, ${g.sections.length} sections, updated ${g.updated}`);
