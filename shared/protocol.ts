/** Messages exchanged between the extension host and the preview webview. */

export type ColorMode = "light" | "dark";

export type FlowDocument = Record<string, unknown> | unknown[];

export interface UpdateMessage {
  type: "update";
  /** Document URI, persisted as webview state so the panel can be restored. */
  uri: string;
  /** Title shown on the diagram's root node. */
  title: string;
  /** Parsed document, or null when the text is not a valid JSON object/array. */
  json: FlowDocument | null;
  /** Parse/validation error to surface; the webview keeps the last valid diagram. */
  error: string | null;
}

export interface ThemeMessage {
  type: "theme";
  colorMode: ColorMode;
}

export type HostMessage = UpdateMessage | ThemeMessage;

export interface ReadyMessage {
  type: "ready";
}

export type WebviewMessage = ReadyMessage;
