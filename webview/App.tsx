import { FlowDiagram, type FlowDirection, type SqueedJson } from "@squeed/flow-sdk";
import { Component, useEffect, useState, type ReactNode } from "react";
import type { ColorMode, HostMessage } from "../shared/protocol";

const vscode = acquireVsCodeApi();

function initialColorMode(): ColorMode {
  return document.body.classList.contains("vscode-light") ? "light" : "dark";
}

export function App() {
  const [doc, setDoc] = useState<SqueedJson | null>(null);
  const [title, setTitle] = useState("untitled");
  const [error, setError] = useState<string | null>(null);
  const [colorMode, setColorMode] = useState<ColorMode>(initialColorMode);
  const [direction, setDirection] = useState<FlowDirection>("LR");
  // Incremented per accepted document so a crashed diagram recovers on the next update.
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const onMessage = (event: MessageEvent<HostMessage>) => {
      const message = event.data;
      if (message?.type === "theme") {
        setColorMode(message.colorMode);
      } else if (message?.type === "update") {
        vscode.setState({ uri: message.uri });
        setTitle(message.title);
        setError(message.error);
        if (message.json) {
          setDoc(message.json);
          setRevision((current) => current + 1);
        }
      }
    };
    window.addEventListener("message", onMessage);
    vscode.postMessage({ type: "ready" });
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      {doc ? (
        <DiagramBoundary resetKey={revision}>
          <FlowDiagram
            json={doc}
            title={title}
            config={{ colorMode, direction, editable: true }}
            callbacks={{
              // Preview only: edits stay in this pane until the file changes.
              onJsonChange: (next) => setDoc(next),
              onDirectionChange: setDirection,
            }}
          />
        </DiagramBoundary>
      ) : (
        <Notice heading={error ? "Cannot preview this document" : "Waiting for JSON…"} detail={error} />
      )}
      {doc && error ? <Banner message={error} /> : null}
    </div>
  );
}

function Banner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      style={{
        position: "absolute",
        top: 12,
        left: 12,
        right: 12,
        zIndex: 1000,
        padding: "8px 12px",
        borderRadius: 6,
        border: "1px solid var(--vscode-inputValidation-errorBorder, #be1100)",
        background: "var(--vscode-inputValidation-errorBackground, #5a1d1d)",
        color: "var(--vscode-editor-foreground, #ccc)",
        font: "12px var(--vscode-font-family, sans-serif)",
        pointerEvents: "none",
      }}
    >
      Showing the last valid diagram. {message}
    </div>
  );
}

function Notice({ heading, detail }: { heading: string; detail: string | null }) {
  return (
    <div
      style={{
        height: "100%",
        display: "grid",
        placeItems: "center",
        padding: 24,
        textAlign: "center",
        color: "var(--vscode-descriptionForeground, #999)",
        font: "13px var(--vscode-font-family, sans-serif)",
      }}
    >
      <div>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>{heading}</div>
        {detail ? <div>{detail}</div> : null}
      </div>
    </div>
  );
}

interface BoundaryProps {
  resetKey: number;
  children: ReactNode;
}

interface BoundaryState {
  error: Error | null;
  resetKey: number;
}

class DiagramBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<BoundaryState> {
    return { error };
  }

  static getDerivedStateFromProps(props: BoundaryProps, state: BoundaryState): Partial<BoundaryState> | null {
    return props.resetKey !== state.resetKey ? { error: null, resetKey: props.resetKey } : null;
  }

  render() {
    if (this.state.error)
      return <Notice heading="The diagram failed to render" detail={this.state.error.message} />;
    return this.props.children;
  }
}
