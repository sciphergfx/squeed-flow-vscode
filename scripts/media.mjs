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

// The Squeed mark is a white glyph on a transparent 38x38 canvas; place it on the
// gallery banner color. Offsets center the glyph's visual bounds, not the viewBox.
const glyph = await readFile(join(media, "squeed.svg"), "utf8");
const icon = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <rect width="256" height="256" rx="56" fill="#0f172a"/>
  ${glyph.replace("<svg ", '<svg x="-24" y="-16" ').replace(/width="38" height="38"/, 'width="300" height="300"')}
</svg>`;

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
  const iconPage = await browser.newPage({ viewport: { width: 256, height: 256 } });
  await iconPage.setContent(`<body style="margin:0;background:transparent">${icon}</body>`);
  await iconPage.screenshot({ path: join(media, "icon.png"), omitBackground: true });

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
