interface SqueedFlowWebviewApi {
  postMessage(message: import("../shared/protocol").WebviewMessage): void;
  getState(): unknown;
  setState<T>(state: T): T;
}

declare function acquireVsCodeApi(): SqueedFlowWebviewApi;
