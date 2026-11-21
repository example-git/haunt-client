import {
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type HTMLAttributes,
  type Ref,
} from "react";
import { aiMention, aiMentions, type AIPreset } from "@haunt/core";

export interface MessageInputHandle {
  readonly element: HTMLElement | null;
  readonly isConnected: boolean;
  readonly value: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
  focus(options?: FocusOptions): void;
  setSelectionRange(start: number, end: number): void;
  replace(start: number, end: number, value: string): void;
}
type Props = Pick<
  HTMLAttributes<HTMLElement>,
  | "aria-label"
  | "aria-autocomplete"
  | "aria-controls"
  | "aria-activedescendant"
  | "onKeyDown"
  | "onContextMenu"
  | "onPaste"
  | "autoFocus"
> & {
  ref?: Ref<MessageInputHandle>;
  value: string;
  placeholder?: string;
  presets?: AIPreset[];
  onDraft: (value: string, caret: number) => void;
  onCaret?: (caret: number) => void;
};

function wireText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (node instanceof HTMLElement && node.dataset.aiMention)
    return aiMention(node.dataset.aiMention);
  if (node.nodeName === "BR") return node.nextSibling ? "\n" : "";
  let value = "";
  for (const child of node.childNodes) {
    if (
      (child.nodeName === "DIV" || child.nodeName === "P") &&
      child.previousSibling
    )
      value += "\n";
    value += wireText(child);
  }
  return value;
}

function wireOffset(root: HTMLElement, node: Node, offset: number) {
  const range = document.createRange();
  range.selectNodeContents(root);
  range.setEnd(node, offset);
  return wireText(range.cloneContents()).length;
}

function selection(root: HTMLElement) {
  const selected = document.getSelection();
  if (!selected?.rangeCount) return { start: 0, end: 0 };
  const range = selected.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer))
    return { start: 0, end: 0 };
  return {
    start: wireOffset(root, range.startContainer, range.startOffset),
    end: wireOffset(root, range.endContainer, range.endOffset),
  };
}

function point(root: HTMLElement, position: number): [Node, number] {
  for (let i = 0; i < root.childNodes.length; i++) {
    const child = root.childNodes[i];
    const length = wireText(child).length;
    if (child.nodeType === Node.TEXT_NODE && position <= length)
      return [child, Math.max(0, position)];
    if (position === 0) return [root, i];
    if (position < length) return [root, i + 1];
    position -= length;
  }
  return [root, root.childNodes.length];
}

function select(root: HTMLElement, start: number, end: number) {
  const range = document.createRange();
  range.setStart(...point(root, start));
  range.setEnd(...point(root, end));
  document
    .getSelection()
    ?.setBaseAndExtent(
      range.startContainer,
      range.startOffset,
      range.endContainer,
      range.endOffset,
    );
}

function tokens(value: string, presets: AIPreset[]) {
  const fragment = document.createDocumentFragment();
  let pos = 0;
  for (const token of aiMentions(value)) {
    fragment.append(value.slice(pos, token.start));
    const chip = document.createElement("span");
    chip.className = "mention ai-mention composer-mention";
    chip.contentEditable = "false";
    chip.dataset.aiMention = token.id;
    chip.textContent =
      "@" + (presets.find((p) => p.id === token.id)?.name ?? "AI personality");
    fragment.append(chip);
    pos = token.end;
  }
  fragment.append(value.slice(pos));
  return fragment;
}

export function MessageInput({
  ref,
  value,
  onDraft,
  onCaret,
  presets,
  placeholder,
  onKeyDown,
  onPaste,
  ...attrs
}: Props) {
  const native = useRef<HTMLTextAreaElement>(null);
  const rich = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  function synchronize() {
    const root = rich.current;
    if (!root || !presets || composing.current) return;
    const mentions = aiMentions(value);
    const chips = root.querySelectorAll<HTMLElement>("[data-ai-mention]");
    if (
      value === wireText(root) &&
      !root.querySelector("div,p,br:not(:last-child)") &&
      mentions.length === chips.length &&
      mentions.every(
        (token, i) =>
          chips[i].dataset.aiMention === token.id &&
          chips[i].textContent ===
            "@" +
              (presets.find((p) => p.id === token.id)?.name ??
                "AI personality"),
      )
    )
      return;
    const old = selection(root);
    root.replaceChildren(tokens(value, presets));
    if (document.activeElement === root) select(root, old.start, old.end);
  }
  useLayoutEffect(synchronize, [value, presets]);
  function insert(start: number, end: number, text: string) {
    if (native.current) {
      native.current.setRangeText(text, start, end, "end");
      onDraft(native.current.value, native.current.selectionStart);
    } else if (rich.current && presets) {
      const root = rich.current;
      root.focus();
      select(root, start, end);
      const fragment = tokens(text, presets);
      const wrapper = document.createElement("div");
      wrapper.append(fragment);
      document.execCommand(
        "insertHTML",
        false,
        wrapper.innerHTML.replaceAll("\n", "&#10;"),
      );
      const next = start + text.length;
      onDraft(wireText(root), next);
      select(root, next, next);
    }
  }
  useImperativeHandle(ref, () => ({
    get element() {
      return native.current ?? rich.current;
    },
    get isConnected() {
      return !!this.element?.isConnected;
    },
    get value() {
      return (
        native.current?.value ?? (rich.current ? wireText(rich.current) : "")
      );
    },
    get selectionStart() {
      return (
        native.current?.selectionStart ??
        (rich.current ? selection(rich.current).start : 0)
      );
    },
    get selectionEnd() {
      return (
        native.current?.selectionEnd ??
        (rich.current ? selection(rich.current).end : 0)
      );
    },
    focus(options) {
      this.element?.focus(options);
    },
    setSelectionRange(start, end) {
      if (native.current) native.current.setSelectionRange(start, end);
      else if (rich.current) select(rich.current, start, end);
    },
    replace: insert,
  }));
  if (!presets)
    return (
      <textarea
        {...attrs}
        ref={native}
        rows={1}
        value={value}
        placeholder={placeholder}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onSelect={(e) => onCaret?.(e.currentTarget.selectionStart)}
        onChange={(e) => onDraft(e.target.value, e.target.selectionStart)}
      />
    );
  const emit = () => {
    if (!rich.current || composing.current) return;
    onDraft(wireText(rich.current), selection(rich.current).start);
  };
  const copy = (e: ClipboardEvent<HTMLDivElement>, cut: boolean) => {
    const root = e.currentTarget;
    const range = selection(root);
    if (range.start === range.end) return;
    const selected = wireText(root).slice(range.start, range.end);
    if (!aiMentions(selected).length) return;
    const display = tokens(selected, presets).textContent ?? selected;
    e.preventDefault();
    e.clipboardData.setData("text/plain", display);
    e.clipboardData.setData("application/x-haunt-message-text", selected);
    if (cut) document.execCommand("delete");
  };
  return (
    <div
      {...attrs}
      ref={rich}
      role="textbox"
      aria-multiline="true"
      aria-placeholder={placeholder}
      data-placeholder={placeholder}
      className="mention-input"
      contentEditable
      suppressContentEditableWarning
      onInput={emit}
      onSelect={(e) => onCaret?.(selection(e.currentTarget).start)}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={() => {
        composing.current = false;
        emit();
      }}
      onCopy={(e) => copy(e, false)}
      onCut={(e) => copy(e, true)}
      onPaste={(e) => {
        onPaste?.(e);
        if (e.defaultPrevented) return;
        e.preventDefault();
        const range = selection(e.currentTarget);
        insert(
          range.start,
          range.end,
          e.clipboardData.getData("application/x-haunt-message-text") ||
            e.clipboardData.getData("text/plain"),
        );
      }}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        if (e.defaultPrevented || e.nativeEvent.isComposing) return;
        const range = selection(e.currentTarget);
        if (e.key === "Enter") {
          e.preventDefault();
          insert(range.start, range.end, "\n");
        } else if (
          range.start === range.end &&
          (e.key === "Delete" || e.key === "Backspace")
        ) {
          const chip = aiMentions(value).find((m) =>
            e.key === "Backspace"
              ? m.end === range.start
              : m.start === range.start,
          );
          if (chip) {
            e.preventDefault();
            select(e.currentTarget, chip.start, chip.end);
            document.execCommand("delete");
          }
        }
      }}
    />
  );
}

export function EditMentionText({
  value,
  presets,
}: {
  value: string;
  presets: AIPreset[];
}) {
  const [text, setText] = useState(value);
  return (
    <>
      <input type="hidden" name="body" value={text} />
      <MessageInput
        aria-label="Edit message"
        autoFocus
        value={text}
        onDraft={setText}
        presets={presets}
      />
    </>
  );
}
