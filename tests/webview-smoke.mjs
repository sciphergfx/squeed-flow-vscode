// Renders the built webview bundle in headless Chromium behind the same CSP the
// extension uses, drives it with the host->webview message protocol, and checks
// that a Squeed document renders nodes, lazy Phosphor icons, and error banners.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const dist = fileURLToPath(new URL("../dist/webview/", import.meta.url));
const origin = "https://preview.test";
const nonce = "smoke-nonce";
const csp = [
  "default-src 'none'",
  `img-src ${origin} https: data:`,
  `style-src ${origin} 'unsafe-inline'`,
  `font-src ${origin} data:`,
  `script-src 'nonce-${nonce}' ${origin}`,
].join("; ");
const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>html,body,#root{height:100%;margin:0}body{overflow:hidden}</style>
</head><body class="vscode-dark">
<div id="root"></div>
<script nonce="${nonce}">
  window.__sent = [];
  window.acquireVsCodeApi = () => ({
    postMessage: (message) => window.__sent.push(message),
    getState: () => window.__state,
    setState: (state) => (window.__state = state),
  });
</script>
<script type="module" nonce="${nonce}" src="/main.js"></script>
</body></html>`;

const document = {
  service: {
    $label: "Service",
    $icon: "PiBookOpen",
    $collapsed: false,
    worker: { $label: "Worker", $target: "root.database" },
  },
  database: { $label: "Database" },
  notes: ["alpha", "beta"],
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const consoleErrors = [];
const requested = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));
page.on("request", (request) => requested.push(new URL(request.url()).pathname));
await page.route(`${origin}/**`, async (route) => {
  const { pathname } = new URL(route.request().url());
  if (pathname === "/") return route.fulfill({ contentType: "text/html", body: html });
  try {
    const body = await readFile(join(dist, pathname));
    const contentType = extname(pathname) === ".js" ? "text/javascript" : "application/octet-stream";
    return route.fulfill({ contentType, body });
  } catch {
    return route.fulfill({ status: 404, body: "not found" });
  }
});

const post = (message) => page.evaluate((m) => window.postMessage(m, "*"), message);

try {
  await page.goto(`${origin}/`);
  await page.waitForFunction(() => window.__sent.some((m) => m.type === "ready"));
  await page.getByText("Waiting for JSON…").waitFor();

  await post({ type: "theme", colorMode: "dark" });
  await post({ type: "update", uri: "file:///demo.json", title: "demo", json: document, error: null });
  await page.locator(".flow-sdk-node").nth(4).waitFor();
  const labels = (await page.locator(".flow-sdk-node").allInnerTexts()).map((text) => text.toLowerCase());
  for (const label of ["demo", "service", "worker", "database", "notes", "alpha", "beta"])
    assert.ok(labels.some((text) => text.includes(label)), `Missing node "${label}"`);
  assert.ok((await page.locator(".flow-sdk-edge").count()) >= 4, "Expected hierarchy and target edges");
  assert.deepEqual(await page.evaluate(() => window.__state), { uri: "file:///demo.json" });

  await page.waitForFunction(() => document.querySelectorAll(".flow-sdk-node svg path").length > 0);
  assert.ok(requested.some((path) => /^\/pi-[^/]+\.js$/.test(path)), "Phosphor chunk was not lazy-loaded");

  await post({ type: "update", uri: "file:///demo.json", title: "demo", json: null, error: "Boom at line 2, column 3." });
  await page.getByRole("alert").filter({ hasText: "Boom at line 2" }).waitFor();
  assert.ok((await page.locator(".flow-sdk-node").count()) >= 6, "Last valid diagram should remain");

  await post({ type: "update", uri: "file:///demo.json", title: "demo", json: { only: { $label: "Only" } }, error: null });
  await page.getByText("Only", { exact: true }).waitFor();
  await page.getByRole("alert").waitFor({ state: "detached" });
  await page.waitForFunction(() => document.querySelectorAll(".flow-sdk-node").length === 2);

  await post({ type: "theme", colorMode: "light" });
  await page.waitForTimeout(250);

  assert.deepEqual(consoleErrors, [], "Console errors during smoke test");
  console.log("webview smoke test passed");
} finally {
  await browser.close();
}
