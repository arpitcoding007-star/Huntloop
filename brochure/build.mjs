/* eslint-disable */
// Builds Huntloop_Product_Overview_Light.pdf and _Dark.pdf. Usage (repository root): node brochure/build.mjs
import { chromium } from "playwright";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { body } from "./content.mjs";

// Tokens come from packages/ui/src/tokens.css; each theme uses its own values, not an inversion.
const THEME = {
  light: "--bg:#ffffff;--soft:#f4f6fa;--line:#e1e6ee;--line2:#c9d2e0;--ink:#0d1422;--ink2:#3b4352;--muted:#62656d;--blue:#1d4fc0;--blue-g:#1f58f0;--dot:#2f6bff;--pos:#2e9e67;--mid:#b27a16;--bad:#c22f36;--glyph-ink:#fff;--note:#f7efdf;--note-ink:#6b4306;--note-line:#c08a2a;--shotline:#dfe4f2",
  dark: "--bg:#111111;--soft:#1a1a19;--line:#2a2a28;--line2:#454542;--ink:#ececea;--ink2:#c3c3bf;--muted:#9a9a96;--blue:#aec2ea;--blue-g:#8aa5dc;--dot:#6e9bff;--pos:#5bbf8e;--mid:#e0a44a;--bad:#ec7a7a;--glyph-ink:#111;--note:#241f16;--note-ink:#ecc98f;--note-line:#e0a44a;--shotline:#33332f",
};
const COVER = {
  light: ".wash{background:linear-gradient(168deg,#fff 0%,#fff 46%,#eef3fd 78%,#dce6fa 100%)}.ring{right:-34mm;bottom:-30mm;color:#c6d7fb}.ring .mark{width:172mm;height:172mm}",
  dark: ".wash{background:radial-gradient(130mm 120mm at 88% 92%,rgba(125,151,204,.26),rgba(17,17,17,0) 70%),#111}.ring{right:-30mm;bottom:-22mm;color:#2b2f3a}.ring .mark{width:164mm;height:164mm}",
};
const CSS = `@font-face{font-family:Geist;src:url(fonts/geist-latin.woff2) format("woff2");font-weight:100 900}
@font-face{font-family:GeistMono;src:url(fonts/geist-mono-latin.woff2) format("woff2");font-weight:100 900}
@page{size:210mm 297mm;margin:0}
*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
html,body{margin:0;background:var(--bg)}body{font:400 9.9pt/1.5 Geist,system-ui,sans-serif;color:var(--ink2);letter-spacing:-.006em}
.page{width:210mm;height:297mm;position:relative;overflow:hidden;background:var(--bg);padding:13mm 18mm 18mm;break-after:page;display:flex;flex-direction:column}
.page:last-of-type{break-after:auto}
.run{display:flex;justify-content:space-between;align-items:center;font-size:7.8pt;color:var(--muted);padding-bottom:3.2mm;border-bottom:.25mm solid var(--line);margin-bottom:8mm}
.lock{display:inline-flex;align-items:center;gap:1.8mm;color:var(--ink);font-weight:600;font-size:10pt;letter-spacing:-.025em}.mark{width:5mm;height:5mm}
footer{position:absolute;left:18mm;right:18mm;bottom:8.5mm;display:flex;justify-content:space-between;font-size:7.4pt;color:var(--muted);font-variant-numeric:tabular-nums}
h1{font-size:25pt;line-height:1.1;font-weight:600;letter-spacing:-.035em;color:var(--ink);margin:0 0 3.2mm;text-wrap:balance}
.lede{font-size:11.6pt;line-height:1.45;color:var(--ink2);margin:0 0 6mm;max-width:162mm;text-wrap:pretty}
.fill{flex:1;min-height:0}
h2{font-size:11pt;font-weight:600;letter-spacing:-.015em;color:var(--ink);margin:5.2mm 0 1.6mm}h3{font-size:9.6pt;font-weight:600;color:var(--ink);margin:0 0 1mm}
.two>div>h2:first-child,.fill>h2:first-child{margin-top:0}
p{margin:0 0 2mm;text-wrap:pretty}.sm{font-size:8.2pt;color:var(--muted)}.gap{margin-top:3mm}#glance .lede{margin-bottom:3.5mm}#glance .key{margin-bottom:1mm}#intro,#status,#terms{font-size:10.4pt}#match,#exchange{font-size:9.4pt}#match table{font-size:8.9pt}#match td{padding-top:1.2mm;padding-bottom:1.2mm}b{font-weight:600;color:var(--ink)}
.two{display:grid;grid-template-columns:1fr 1fr;gap:0 11mm;margin-bottom:4mm}.two.top{margin-top:5mm}
ul{list-style:none;margin:0;padding:0}ul li{position:relative;padding-left:4mm;margin-bottom:1.15mm}ul li:before{content:"";position:absolute;left:.3mm;top:.66em;width:2mm;height:.3mm;background:var(--blue-g)}
.rows{margin:0}.rows div{display:grid;grid-template-columns:36mm 1fr;gap:4mm;padding:1.75mm 0;border-top:.25mm solid var(--line)}.two .rows div{grid-template-columns:26mm 1fr;gap:3mm}.rows div:last-child{border-bottom:.25mm solid var(--line)}dt{font-weight:600;color:var(--ink)}dd{margin:0}
table{width:100%;border-collapse:collapse;font-size:9.4pt;line-height:1.4;table-layout:fixed}th{text-align:left;font-weight:500;font-size:7.9pt;color:var(--muted);padding:0 3mm 1.5mm 0;border-bottom:.35mm solid var(--line2)}td{padding:1.55mm 3mm 1.55mm 0;border-bottom:.25mm solid var(--line);vertical-align:top}td:first-child{color:var(--ink);font-weight:500}
aside{border-left:.6mm solid var(--blue-g);padding:.3mm 0 .3mm 4.5mm;margin:4mm 0}
.note{background:var(--note);color:var(--note-ink);border-left:.6mm solid var(--note-line);padding:2.4mm 4mm;margin:3.5mm 0;font-size:8.8pt}.note b{color:inherit}
.strip{display:grid;grid-template-columns:repeat(3,1fr);border-top:.35mm solid var(--line2);margin-top:8mm;padding-top:4mm;gap:8mm}.strip p{margin:0}
.loop{position:relative;width:174mm;margin:0 0 6mm}.loop svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}.loop div{position:absolute;width:38mm;transform:translateX(-50%);text-align:center}.loop.n5 div{width:46mm}.loop i{display:block;font:500 7.4pt GeistMono;color:var(--blue)}.loop b{display:block;font-size:9.8pt;margin:.2mm 0 .4mm}.loop span{display:block;font-size:8pt;line-height:1.3;color:var(--muted);text-wrap:balance}.loop.n7 span{padding:0 4mm}.loop.n5 span{padding:0 6mm}.loop .b span{min-height:2.6em}.loop p{position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);margin:0;text-align:center;font-size:8.6pt;color:var(--blue)}
.shot{margin:5mm 0 4mm}.crop{position:relative;overflow:hidden;border:.25mm solid var(--shotline);border-radius:2.4mm;background:var(--soft)}.crop img{position:absolute;display:block}figcaption{font-size:7.8pt;color:var(--muted);margin-top:1.8mm}
.g{width:3mm;height:3mm;flex:none}
.key{display:flex;flex-wrap:wrap;gap:1.5mm 3.4mm;padding:2.2mm 0;border-top:.35mm solid var(--line2);border-bottom:.25mm solid var(--line);margin-bottom:3mm;font-size:7.7pt}.key span{display:inline-flex;align-items:center;gap:1.3mm;color:var(--ink2);white-space:nowrap}.key.small{font-size:8pt}
.glance>div{display:grid;grid-template-columns:56mm 1fr 22mm 6mm;gap:3mm;align-items:center;padding:1.12mm 0;border-bottom:.25mm solid var(--line);font-size:8.6pt;line-height:1.3}.gs{color:var(--ink2);font-size:8pt;letter-spacing:-.012em}.gn{text-align:right;font-variant-numeric:tabular-nums;color:var(--muted)}
.bar{display:flex;gap:.35mm;height:1.9mm}.bar i{display:block;height:100%}.bL{background:var(--pos)}.bB{background:var(--blue-g)}.bP{background:var(--mid)}.bX{background:var(--bad)}.bN{background:var(--muted)}.bF,.bC{background:transparent;border:.25mm solid var(--muted)}.bC{border-style:dashed}
.defs{display:grid;grid-template-columns:1fr 1fr;gap:.4mm 8mm;margin-top:3mm;font-size:7.9pt}.defs p{margin:0;text-wrap:wrap}.defs .g{vertical-align:-.45mm;margin-right:1.4mm}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:0 9mm;align-items:start}.cat{padding-bottom:3.6mm}.cat h2{margin:0 0 1.2mm;padding-bottom:1.1mm;border-bottom:.35mm solid var(--line2);font-size:10pt}.cat li{display:grid;grid-template-columns:3mm 1fr auto;gap:1.8mm;padding:.4mm 0;margin:0;font-size:8.5pt;line-height:1.28}.cat li:before{display:none}.cat li .g{margin-top:.55mm}.cat em{font-style:normal;font-size:7pt;color:var(--muted);white-space:nowrap;padding-top:.35mm}
.caps .lede{font-size:9.6pt;margin-bottom:4mm;max-width:none}
#gaps table{font-size:8.4pt}#gaps td{padding-top:1.25mm;padding-bottom:1.25mm}#gaps td .g{margin-top:.8mm}
.cover{padding:0;color:var(--ink)}.wash{position:absolute;inset:0}.ring{position:absolute}
.ctop,.cmid,.cbot{position:absolute;left:20mm;right:20mm}.ctop{top:20mm}.ctop .lock{font-size:15pt}.ctop .mark{width:8mm;height:8mm}.cmid{top:78mm;max-width:150mm}.cmid h1{font-size:45pt;line-height:1.03;letter-spacing:-.045em;margin:0 0 7mm}.cmid p{font-size:13.5pt;line-height:1.45;max-width:118mm;color:var(--ink2)}.cmid .eyebrow{font-size:11pt;font-weight:500;color:var(--blue);margin-bottom:5mm}.cbot{bottom:18mm;display:flex;gap:10mm;font-size:9pt;color:var(--ink)}`;
// Places whole capability groups into two columns and adds pages as required.
const FLOW = `(async()=>{await document.fonts.ready;const first=document.querySelector('#caps');const blocks=[...document.querySelector('#capsrc').content.children];let pg=first,k=0;
const mk=(p)=>{const c=p.querySelector('.cols');c.innerHTML='<div></div><div></div>';return[...c.children]};let cs=mk(pg),ci=0;
const lim=(p)=>p.querySelector('footer').getBoundingClientRect().top+4;
for(const b of blocks){for(;;){cs[ci].append(b);if(b.getBoundingClientRect().bottom<=lim(pg))break;b.remove();if(ci===0){ci=1;continue}
const n=first.cloneNode(true);n.id='caps'+(++k);n.querySelector('h1').textContent='Product Capabilities, continued';n.querySelector('h1').style.fontSize='16pt';n.querySelector('.lede').remove();pg.after(n);pg=n;cs=mk(n);ci=0}}
const all=[...document.querySelectorAll('.page')];all.forEach((p,i)=>{const s=p.querySelector('.pn');if(s)s.textContent=(i+1)+' / '+all.length});document.body.dataset.ready=1})()`;
const b = await chromium.launch(), root = resolve("brochure");
for (const t of ["light", "dark"]) {
  const file = `${root}/overview-${t}.html`;
  writeFileSync(file, `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Huntloop Product Overview</title><style>:root{${THEME[t]}}${CSS}${COVER[t]}</style></head><body>${body(t)}<script>${FLOW}</script></body></html>`);
  const p = await b.newPage({ viewport: { width: 900, height: 1200 }, deviceScaleFactor: 1.5 });
  await p.goto(pathToFileURL(file).href, { waitUntil: "networkidle" });
  await p.waitForSelector("body[data-ready]", { state: "attached" }); await p.waitForTimeout(400);
  console.log(t, await p.evaluate(() => [...document.querySelectorAll(".page")].map((s, i) => { const f = s.querySelector("footer"); if (!f) return ""; const top = f.getBoundingClientRect().top; let m = 0, w = 0; s.querySelectorAll(".fill *").forEach((e) => { const c = e.closest(".crop"); const r = (c ?? e).getBoundingClientRect(); if (r.height) m = Math.max(m, r.bottom); if (!c && e.scrollWidth > e.clientWidth + 2 && e.clientWidth && !e.closest("svg")) w++; }); return `${i + 1}:${s.id} ${((top - m) / 3.78).toFixed(0)}mm${w ? " WIDE" + w : ""}`; }).join(" | ")));
  const dir = `${root}/pages-${t}`; rmSync(dir, { recursive: true, force: true }); mkdirSync(dir);
  let i = 0; for (const s of await p.$$(".page")) await s.screenshot({ path: `${dir}/p${String(++i).padStart(2, "0")}.png` });
  await p.pdf({ path: resolve(`Huntloop_Product_Overview_${t === "light" ? "Light" : "Dark"}.pdf`), preferCSSPageSize: true, printBackground: true, tagged: true });
  await p.close();
}
await b.close();
