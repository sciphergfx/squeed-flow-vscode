// Executed inside the VS Code extension host by @vscode/test-electron.
const assert = require("node:assert/strict");
const path = require("node:path");
const vscode = require("vscode");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check, description, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (check()) return;
    await sleep(100);
  }
  const openDocuments = vscode.workspace.textDocuments.map((document) => document.uri.toString());
  const openTabs = vscode.window.tabGroups.all.flatMap((group) => group.tabs.map((tab) => tab.label));
  throw new Error(
    `Timed out waiting for ${description}. Documents: ${JSON.stringify(openDocuments)} Tabs: ${JSON.stringify(openTabs)}`,
  );
}

function previewTabs() {
  return vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .filter(
      (tab) =>
        tab.input instanceof vscode.TabInputWebview &&
        tab.input.viewType.includes("squeedFlow.preview"),
    );
}

exports.run = async () => {
  const extension = vscode.extensions.getExtension("seyiogunbowalesciphergfx.squeed-flow");
  assert.ok(extension, "Extension seyiogunbowalesciphergfx.squeed-flow should be loaded");
  await extension.activate();

  const [folder] = vscode.workspace.workspaceFolders ?? [];
  assert.ok(folder, "Expected the temp workspace folder");
  const uri = vscode.Uri.file(path.join(folder.uri.fsPath, "flow.json"));

  // Command without a JSON editor is a no-op with an information message.
  await vscode.commands.executeCommand("squeedFlow.openPreview");
  await sleep(300);
  assert.equal(previewTabs().length, 0, "No preview without a document");

  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(document);
  await vscode.commands.executeCommand("squeedFlow.openPreview");
  await waitFor(() => previewTabs().length === 1, "preview tab to open");
  assert.equal(previewTabs()[0].label, "Preview flow.json");

  // Re-running reveals the existing pane instead of opening a second one.
  await vscode.window.showTextDocument(document);
  await vscode.commands.executeCommand("squeedFlow.openPreview", uri);
  await sleep(500);
  assert.equal(previewTabs().length, 1, "Preview should be reused per document");

  // Edits (valid and invalid) must not throw in the host.
  const edit = new vscode.WorkspaceEdit();
  edit.insert(uri, new vscode.Position(0, 0), "{ broken ");
  assert.ok(await vscode.workspace.applyEdit(edit));
  await sleep(600);
  await vscode.commands.executeCommand("undo");
  await sleep(600);

  // Closing the editor keeps the pane open (like Markdown preview)...
  const documentTabs = vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .filter(
      (tab) =>
        tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === uri.toString(),
    );
  assert.ok(documentTabs.length >= 1, "Expected an editor tab for flow.json");
  await vscode.window.tabGroups.close(documentTabs);
  await sleep(500);
  assert.equal(previewTabs().length, 1, "Preview pane should outlive its editor");

  // ...and reopening the file reuses it.
  await vscode.window.showTextDocument(uri);
  await vscode.commands.executeCommand("squeedFlow.openPreview");
  await sleep(500);
  assert.equal(previewTabs().length, 1, "Reopened document should reuse the preview");

  // Closing the pane disposes it; the command then creates a fresh one.
  await vscode.window.tabGroups.close(previewTabs());
  await waitFor(() => previewTabs().length === 0, "preview tab to close");
  await vscode.commands.executeCommand("squeedFlow.openPreview", uri);
  await waitFor(() => previewTabs().length === 1, "preview to reopen after being closed");

  console.log("integration suite passed");
};
