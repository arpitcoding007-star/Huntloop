/* eslint-disable */
// Renders overview.html to PDF + per-page PNGs, and reports overflow.
// Usage: node brochure/render.mjs
import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";

const here = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const html = resolve(here, "overview.html");
const out = resolve(here, "..", "Huntloop_Product_Overview.pdf");
const pngDir = resolve(here, "pages");
mkdirSync(pngDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 1200 }, deviceScaleFactor: 2 });
await page.goto(pathToFileURL(html).href, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
await page.waitForSelector("body[data-balanced]", { state: "attached" });
const font = await page.evaluate(() => document.fonts.check("12px Geist"));
console.log("Geist loaded:", font);

// Overflow: any descendant whose bottom passes the footer top (or page bottom).
const report = await page.evaluate(() => {
  return [...document.querySelectorAll(".page")].map((p, i) => {
    const pr = p.getBoundingClientRect();
    const foot = p.querySelector(".foot");
    const limit = foot ? foot.getBoundingClientRect().top - 2 : pr.bottom;
    let maxBottom = 0, worst = "";
    p.querySelectorAll("*").forEach((el) => {
      if (el.closest(".foot") || el.classList.contains("bigmark") || el.closest(".bigmark")) return;
      const r = el.getBoundingClientRect();
      if (r.height && r.bottom > maxBottom) { maxBottom = r.bottom; worst = el.className || el.tagName; }
    });
    const hOverflow = [...p.querySelectorAll("*")].some((el) => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow === "visible" && el.clientWidth > 0 && !["svg","path","circle"].includes(el.tagName.toLowerCase()));
    return { page: i + 1, spareMm: +((limit - maxBottom) / 3.7795).toFixed(1), worst, hOverflow };
  });
});
console.table(report);

const pages = await page.$$(".page");
for (let i = 0; i < pages.length; i++) await pages[i].screenshot({ path: resolve(pngDir, `p${String(i + 1).padStart(2, "0")}.png`) });

await page.emulateMedia({ media: "print" });
await page.pdf({ path: out, format: "A4", printBackground: true, preferCSSPageSize: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
await browser.close();

const bytes = readFileSync(out).toString("latin1");
console.log("PDF pages:", (bytes.match(/\/Type\s*\/Page[^s]/g) || []).length, "->", out);
