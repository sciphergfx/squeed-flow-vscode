// Regenerates media/icon.png and media/preview.png from the built webview bundle.
// Usage: npm run build && node scripts/media.mjs
import { mkdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = fileURLToPath(new URL("../", import.meta.url));
const dist = join(root, "dist/webview/");
const media = join(root, "media");
await mkdir(media, { recursive: true });

// media/squeed.svg is the Squeed mark as used in the SDK toolbar (white on transparent).
// Present it like the Squeed desktop app icon: black mark on the brand cream, with the
// glyph's visual bounds (not the viewBox) centered and spanning 66% of the height.
const ICON_SIZE = 512;
const BRAND_BACKGROUND = "#edecda";
const GLYPH_HEIGHT_RATIO = 338 / 512;
const glyph = (await readFile(join(media, "squeed.svg"), "utf8")).replace(/fill="#ffffff"/gi, 'fill="#000000"');

function brandIcon(bbox) {
  const scale = (ICON_SIZE * GLYPH_HEIGHT_RATIO) / bbox.height;
  const viewBox = 38;
  const x = ICON_SIZE / 2 - (bbox.x + bbox.width / 2) * scale;
  const y = ICON_SIZE / 2 - (bbox.y + bbox.height / 2) * scale;
  const inner = glyph
    .replace("<svg ", `<svg x="${x}" y="${y}" `)
    .replace(/width="38" height="38"/, `width="${viewBox * scale}" height="${viewBox * scale}"`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${ICON_SIZE}" height="${ICON_SIZE}" viewBox="0 0 ${ICON_SIZE} ${ICON_SIZE}">
  <rect width="${ICON_SIZE}" height="${ICON_SIZE}" fill="${BRAND_BACKGROUND}"/>
  ${inner}
</svg>`;
}

const document = {
  checkout: {
    $label: "Checkout",
    $icon: "PiShoppingCart",
    $collapsed: false,
    validate: { $label: "Validate cart", $icon: "PiCheckCircle", $target: "root.payments" },
    reserve: { $label: "Reserve stock", $icon: "PiPackage", $target: "root.inventory" },
  },
  payments: {
    $label: "Payments",
    $icon: "PiCreditCard",
    $bgColor: "teal.600",
    provider: "stripe",
    retries: 3,
  },
  inventory: { $label: "Inventory", $icon: "PiWarehouse", $target: "root.notify" },
  notify: { $label: "Notify customer", $icon: "PiEnvelopeSimple" },
};

const origin = "https://preview.test";
const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>html,body,#root{height:100%;margin:0}body{overflow:hidden}</style></head>
<body class="vscode-dark"><div id="root"></div>
<script>window.acquireVsCodeApi=()=>({postMessage(){},getState(){},setState(s){return s}});</script>
<script type="module" src="/main.js"></script></body></html>`;

const browser = await chromium.launch();
try {
  const iconPage = await browser.newPage({ viewport: { width: ICON_SIZE, height: ICON_SIZE } });
  await iconPage.setContent(`<body style="margin:0">${glyph}</body>`);
  const bbox = await iconPage.evaluate(() => {
    const { x, y, width, height } = document.querySelector("svg").getBBox();
    return { x, y, width, height };
  });
  await iconPage.setContent(`<body style="margin:0">${brandIcon(bbox)}</body>`);
  await iconPage.screenshot({ path: join(media, "icon.png") });

  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.route(`${origin}/**`, async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/") return route.fulfill({ contentType: "text/html", body: html });
    try {
      const body = await readFile(join(dist, pathname));
      return route.fulfill({ contentType: extname(pathname) === ".js" ? "text/javascript" : "application/octet-stream", body });
    } catch {
      return route.fulfill({ status: 404, body: "" });
    }
  });
  await page.goto(`${origin}/`);
  await page.getByText("Waiting for JSON…").waitFor();
  await page.evaluate(
    (message) => window.postMessage(message, "*"),
    { type: "theme", colorMode: "dark" },
  );
  await page.evaluate(
    (message) => window.postMessage(message, "*"),
    { type: "update", uri: "file:///checkout.json", title: "checkout", json: document, error: null },
  );
  await page.waitForFunction(() => document.querySelectorAll(".flow-sdk-node svg path").length >= 6);
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(media, "preview.png") });
  console.log("wrote media/icon.png and media/preview.png");
} finally {
  await browser.close();
}
