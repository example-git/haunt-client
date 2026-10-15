import { useEffect, type RefObject } from "react";
import {
  hasFiles,
  transferredFiles,
  type AttachmentDraft,
} from "@haunt/browser/attachment-input";

export function useAttachmentDrop(
  target: RefObject<HTMLDivElement | null>,
  draft: AttachmentDraft,
  busy: boolean,
) {
  useEffect(() => {
    const element = target.current;
    if (!element) return;
    const window = element.ownerDocument.defaultView!;
    let depth = 0;
    const reset = () => {
      depth = 0;
      delete element.dataset.fileDrop;
    };
    const enter = (event: DragEvent) => {
      if (!event.dataTransfer || !hasFiles(event.dataTransfer) || busy) return;
      event.preventDefault();
      depth++;
      element.dataset.fileDrop = "true";
    };
    const over = (event: DragEvent) => {
      if (!event.dataTransfer || !hasFiles(event.dataTransfer)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = busy ? "none" : "copy";
      if (!busy) element.dataset.fileDrop = "true";
    };
    const leave = () => {
      if (--depth <= 0) reset();
    };
    const drop = (event: DragEvent) => {
      reset();
      if (!event.dataTransfer || !hasFiles(event.dataTransfer)) return;
      event.preventDefault();
      if (!busy) draft.add(transferredFiles(event.dataTransfer));
    };
    // Prevent dropped files navigating the browser/Electron window elsewhere.
    // Only the conversation target above is allowed to create attachments.
    const guard = (event: DragEvent) => {
      if (
        event.dataTransfer &&
        hasFiles(event.dataTransfer) &&
        !event.defaultPrevented
      ) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "none";
      }
      if (event.type === "drop" || !element.contains(event.target as Node))
        reset();
    };
    element.addEventListener("dragenter", enter);
    element.addEventListener("dragover", over);
    element.addEventListener("dragleave", leave);
    element.addEventListener("drop", drop);
    window.addEventListener("dragover", guard);
    window.addEventListener("drop", guard);
    window.addEventListener("dragend", reset);
    window.addEventListener("blur", reset);
    return () => {
      reset();
      element.removeEventListener("dragenter", enter);
      element.removeEventListener("dragover", over);
      element.removeEventListener("dragleave", leave);
      element.removeEventListener("drop", drop);
      window.removeEventListener("dragover", guard);
      window.removeEventListener("drop", guard);
      window.removeEventListener("dragend", reset);
      window.removeEventListener("blur", reset);
    };
  }, [target, draft, busy]);
}

// Install once at the app boundary, including read-only chats and sign-in views.
export function usePreventFileNavigation() {
  useEffect(() => {
    const guard = (event: DragEvent) => {
      if (
        event.dataTransfer &&
        hasFiles(event.dataTransfer) &&
        !event.defaultPrevented
      ) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "none";
      }
    };
    window.addEventListener("dragover", guard);
    window.addEventListener("drop", guard);
    return () => {
      window.removeEventListener("dragover", guard);
      window.removeEventListener("drop", guard);
    };
  }, []);
}
