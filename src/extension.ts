import * as vscode from "vscode";
import { PreviewManager } from "./preview";

export function activate(context: vscode.ExtensionContext): void {
  const previews = new PreviewManager(context.extensionUri);
  context.subscriptions.push(
    previews,
    vscode.commands.registerCommand("squeedFlow.openPreview", (resource?: vscode.Uri) =>
      previews.open(resource),
    ),
    vscode.window.registerWebviewPanelSerializer(PreviewManager.viewType, previews),
  );
}

export function deactivate(): void {}
