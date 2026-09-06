import { randomBytes } from "node:crypto";
import * as path from "node:path";
import * as vscode from "vscode";
import type { ColorMode, HostMessage, WebviewMessage } from "../shared/protocol";
import { parseDocument } from "./document";

const UPDATE_DELAY_MS = 200;

/** Opens and tracks one preview panel per JSON document. */
export class PreviewManager implements vscode.WebviewPanelSerializer, vscode.Disposable {
  static readonly viewType = "squeedFlow.preview";

  private readonly previews = new Map<string, FlowPreview>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly extensionUri: vscode.Uri) {
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((event) =>
        this.previews.get(event.document.uri.toString())?.scheduleUpdate(),
      ),
      // The pane outlives its editor, like Markdown preview; a reopened file gets a
      // new TextDocument instance, so rebind the preview to keep live updates.
      vscode.workspace.onDidOpenTextDocument((document) =>
        this.previews.get(document.uri.toString())?.attach(document),
      ),
      vscode.window.onDidChangeActiveColorTheme(() => {
        for (const preview of this.previews.values()) preview.postTheme();
      }),
    );
  }

  async open(resource?: vscode.Uri): Promise<void> {
    const document = await this.resolveDocument(resource);
    if (!document) {
      void vscode.window.showInformationMessage(
        "Open a JSON document to preview it as a Squeed flow diagram.",
      );
      return;
    }
    const existing = this.previews.get(document.uri.toString());
    if (existing) {
      existing.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      PreviewManager.viewType,
      previewTitle(document),
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { ...this.webviewOptions(), retainContextWhenHidden: true },
    );
    this.track(document, panel);
  }

  async deserializeWebviewPanel(panel: vscode.WebviewPanel, state: unknown): Promise<void> {
    const uri = typeof (state as { uri?: unknown })?.uri === "string" ? (state as { uri: string }).uri : null;
    let document: vscode.TextDocument | undefined;
    try {
      if (uri) document = await vscode.workspace.openTextDocument(vscode.Uri.parse(uri));
    } catch {
      document = undefined;
    }
    if (!document) {
      panel.dispose();
      return;
    }
    const existing = this.previews.get(document.uri.toString());
    if (existing) {
      panel.dispose();
      existing.reveal();
      return;
    }
    panel.webview.options = this.webviewOptions();
    panel.title = previewTitle(document);
    this.track(document, panel);
  }

  dispose(): void {
    for (const preview of [...this.previews.values()]) preview.dispose();
    for (const disposable of this.disposables) disposable.dispose();
  }

  private track(document: vscode.TextDocument, panel: vscode.WebviewPanel): void {
    const key = document.uri.toString();
    const preview = new FlowPreview(document, panel, this.extensionUri, () =>
      this.previews.delete(key),
    );
    this.previews.set(key, preview);
  }

  private webviewOptions(): vscode.WebviewOptions {
    return {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist", "webview")],
    };
  }

  private async resolveDocument(resource?: vscode.Uri): Promise<vscode.TextDocument | undefined> {
    if (!(resource instanceof vscode.Uri)) return vscode.window.activeTextEditor?.document;
    const key = resource.toString();
    return (
      vscode.workspace.textDocuments.find((document) => document.uri.toString() === key) ??
      vscode.workspace.openTextDocument(resource)
    );
  }
}

class FlowPreview implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private ready = false;
  private disposed = false;

  constructor(
    private document: vscode.TextDocument,
    private readonly panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    private readonly onDispose: () => void,
  ) {
    panel.webview.html = renderHtml(panel.webview, extensionUri);
    this.disposables.push(
      panel.onDidDispose(() => this.dispose()),
      panel.webview.onDidReceiveMessage((message: WebviewMessage) => {
        if (message?.type !== "ready") return;
        this.ready = true;
        this.postTheme();
        this.postDocument();
      }),
    );
  }

  reveal(): void {
    this.panel.reveal(undefined, true);
  }

  attach(document: vscode.TextDocument): void {
    this.document = document;
    this.postDocument();
  }

  scheduleUpdate(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.postDocument(), UPDATE_DELAY_MS);
  }

  postTheme(): void {
    this.post({ type: "theme", colorMode: currentColorMode() });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    for (const disposable of this.disposables) disposable.dispose();
    this.onDispose();
    this.panel.dispose();
  }

  private postDocument(): void {
    if (!this.ready || this.disposed) return;
    const parsed = parseDocument(this.document);
    this.post({
      type: "update",
      uri: this.document.uri.toString(),
      title: diagramTitle(this.document),
      json: parsed.json,
      error: parsed.error,
    });
  }

  private post(message: HostMessage): void {
    if (this.disposed) return;
    void this.panel.webview.postMessage(message);
  }
}

function previewTitle(document: vscode.TextDocument): string {
  return `Preview ${path.basename(document.uri.path)}`;
}

function diagramTitle(document: vscode.TextDocument): string {
  const base = path.basename(document.uri.path);
  return base.replace(/\.[^.]+$/, "") || "untitled";
}

function currentColorMode(): ColorMode {
  const kind = vscode.window.activeColorTheme.kind;
  return kind === vscode.ColorThemeKind.Dark || kind === vscode.ColorThemeKind.HighContrast
    ? "dark"
    : "light";
}

function renderHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = randomBytes(16).toString("base64");
  const script = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "dist", "webview", "main.js"),
  );
  const csp = [
    "default-src 'none'",
    `img-src ${webview.cspSource} https: data:`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `font-src ${webview.cspSource} data:`,
    `script-src 'nonce-${nonce}' ${webview.cspSource}`,
  ].join("; ");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Squeed Flow Preview</title>
<style>
html, body, #root { height: 100%; margin: 0; padding: 0; }
body { overflow: hidden; background: var(--vscode-editor-background); }
</style>
</head>
<body>
<div id="root"></div>
<script type="module" nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
}
