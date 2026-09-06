// Runs tests/integration/suite.js inside a downloaded VS Code with this extension loaded.
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runTests } from "@vscode/test-electron";

const extensionDevelopmentPath = fileURLToPath(new URL("../../", import.meta.url));
const extensionTestsPath = fileURLToPath(new URL("./suite.js", import.meta.url));
const workspace = await mkdtemp(join(tmpdir(), "squeed-flow-vscode-"));
await writeFile(
  join(workspace, "flow.json"),
  JSON.stringify({ alpha: { $label: "Alpha", child: { $label: "Child" } }, beta: { $label: "Beta" } }, null, 2),
);

try {
  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [workspace, "--disable-extensions", "--disable-workspace-trust"],
  });
} catch (error) {
  console.error("integration tests failed", error);
  process.exit(1);
}
