// Drives a real VS Code (Extension Development Host) with Playwright and checks
// that the preview webview renders diagram nodes for the opened JSON file.
import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "@playwright/test";

const root = fileURLToPath(new URL("../../", import.meta.url));
const vscodeDir = join(root, ".vscode-test");
const install = (await readdir(vscodeDir)).find((name) => name.startsWith("vscode-"));
if (!install) throw new Error("Run tests/integration/run.mjs first to download VS Code.");
const executablePath = join(vscodeDir, install, "Visual Studio Code.app/Contents/MacOS/Code");

const workspace = await mkdtemp(join(tmpdir(), "squeed-flow-e2e-"));
const file = join(workspace, "flow.json");
await writeFile(
  file,
  JSON.stringify(
    { alpha: { $label: "Alpha", $icon: "PiBookOpen", child: { $label: "Child" } }, beta: { $label: "Beta" } },
    null,
    2,
  ),
);
const userData = await mkdtemp(join(tmpdir(), "squeed-flow-e2e-user-"));

const app = await electron.launch({
  executablePath,
  args: [
    `--extensionDevelopmentPath=${root}`,
    `--user-data-dir=${userData}`,
    "--disable-extensions",
    "--disable-workspace-trust",
    "--skip-welcome",
    "--skip-release-notes",
    "--disable-gpu",
    workspace,
    file,
  ],
});
try {
  const window = await app.firstWindow();
  await window.locator(".monaco-workbench").waitFor({ timeout: 60_000 });
  await window.locator(".editor-instance .monaco-editor").first().waitFor({ timeout: 60_000 });

  await window.keyboard.press("F1");
  await window.keyboard.type("Squeed Flow: Open Preview to the Side");
  await window.locator(".quick-input-list .monaco-list-row").first().waitFor();
  await window.keyboard.press("Enter");

  const outer = window.frameLocator("iframe.webview.ready");
  const inner = outer.frameLocator("#active-frame");
  await inner.locator(".flow-sdk-node").nth(3).waitFor({ timeout: 60_000 });
  const labels = (await inner.locator(".flow-sdk-node").allInnerTexts()).map((t) => t.toLowerCase());
  for (const expected of ["flow", "alpha", "child", "beta"])
    if (!labels.some((label) => label.includes(expected))) throw new Error(`Missing node "${expected}" in ${JSON.stringify(labels)}`);
  await inner.locator(".flow-sdk-node svg path").first().waitFor({ timeout: 30_000 });

  // Live update: change the file on disk; VS Code reloads the clean document and
  // the preview should follow within the debounce window.
  await writeFile(
    file,
    JSON.stringify({ alpha: { $label: "Alpha", child: { $label: "Child" } }, gamma: { $label: "Gamma" } }, null, 2),
  );
  await inner.getByText("Gamma", { exact: true }).waitFor({ timeout: 30_000 });
  await inner.getByText("Beta", { exact: true }).waitFor({ state: "detached", timeout: 10_000 });

  // Invalid JSON keeps the last diagram and shows the parse error banner.
  await writeFile(file, '{ "alpha": { "$label": "Alpha" ');
  await inner.getByRole("alert").waitFor({ timeout: 30_000 });
  await inner.getByText("Gamma", { exact: true }).waitFor();

  await window.screenshot({ path: "/tmp/squeed-flow-vscode-e2e.png" });
  console.log("e2e: preview rendered and followed edits", labels);
} finally {
  await app.close();
}
