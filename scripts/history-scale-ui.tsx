import React from "react";
import { createRoot } from "react-dom/client";
import { ConversationView } from "../apps/web/src/App";
import "../apps/web/src/style.css";
import type { InstanceClient } from "@haunt/core";
export function mount(client: InstanceClient, conversation: string) {
  const node = document.createElement("div");
  node.style.cssText = "height:800px;display:flex;width:900px";
  document.body.replaceChildren(node);
  createRoot(node).render(
    <ConversationView
      instance={client}
      conversation={conversation}
      title="Scale channel"
      writable={false}
    />,
  );
}
