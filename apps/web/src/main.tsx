import { installWebUpdates } from "@haunt/browser/web-updates";
declare const __HAUNT_BUILD_ID__: string;
import { ContextMenus } from "./ContextMenu";
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./style.css";
import { installAppearance } from "@haunt/browser/appearance";
installAppearance();
installWebUpdates(__HAUNT_BUILD_ID__, import.meta.env.BASE_URL);
class Boundary extends React.Component<
  { children: React.ReactNode },
  { error?: string }
> {
  state: { error?: string } = {};
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  render() {
    return this.state.error ? (
      <main className="fatal">
        <h1>Something interrupted the client.</h1>
        <p>{this.state.error}</p>
        <button onClick={() => location.reload()}>Reload</button>
      </main>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById("root")!).render(
  <Boundary>
    <ContextMenus>
      <App />
    </ContextMenus>
  </Boundary>,
);
