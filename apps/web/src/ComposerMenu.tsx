import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";
import { friendlyError } from "@haunt/core";
import type { AttachmentDraft } from "@haunt/browser/attachment-input";
import type { DesktopBridge } from "@haunt/browser/storage";
import { MenuAction, useContextMenu } from "./ContextMenu";

type Options = {
  input: RefObject<HTMLTextAreaElement | null>;
  file: RefObject<HTMLInputElement | null>;
  uploads: AttachmentDraft;
  uploadsAllowed: boolean;
  busy: boolean;
  cancelReply?: () => void;
  onError: (message: string) => void;
};
type EditCommand = Parameters<NonNullable<DesktopBridge["edit"]>>[0];

export function useComposerMenu(options: Options) {
  const menu = useContextMenu();
  const current = useRef(options);
  current.current = options;
  const desktop = window.hauntDesktop;
  return desktop?.clipboard && desktop.edit
    ? menu("Message", <ComposerMenu current={current} desktop={desktop} />)
    : undefined;
}

function ComposerMenu({
  current,
  desktop,
}: {
  current: RefObject<Options>;
  desktop: DesktopBridge;
}) {
  const { uploads, input, uploadsAllowed, busy, cancelReply } = current.current;
  const state = useSyncExternalStore(uploads.subscribe, uploads.getSnapshot);
  const [image, setImage] = useState(false);
  const selected =
    !!input.current &&
    input.current.selectionStart !== input.current.selectionEnd;
  const attachDisabled = busy || state.entries.length >= 8;
  useEffect(() => {
    let active = true;
    void desktop.clipboard!.formats().then(
      (formats) => {
        if (active) setImage(formats.image);
      },
      (error) => {
        if (active) current.current.onError(friendlyError(error));
      },
    );
    return () => {
      active = false;
    };
  }, [desktop, current]);
  const edit = (command: EditCommand) => {
    const { input, busy, onError } = current.current;
    const node = input.current;
    if (
      !node?.isConnected ||
      (busy && command !== "copy" && command !== "selectAll")
    )
      return;
    node.focus({ preventScroll: true });
    void desktop.edit!(command).catch((error) => onError(friendlyError(error)));
  };
  const canAttach = () => {
    const value = current.current;
    return (
      value.input.current?.isConnected &&
      value.uploadsAllowed &&
      !value.busy &&
      value.uploads.getSnapshot().entries.length < 8
    );
  };
  const attachImage = async () => {
    if (!canAttach()) return;
    current.current.onError("");
    try {
      const { bytes, type } = await desktop.clipboard!.readImage();
      if (!canAttach()) return;
      if (
        !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(type)
      )
        throw Error("This clipboard image format is not supported.");
      const extension =
        type === "image/jpeg" ? "jpg" : type.slice("image/".length);
      current.current.uploads.add([
        new File([new Uint8Array(bytes)], `pasted-image.${extension}`, {
          type,
        }),
      ]);
    } catch (error) {
      if (current.current.input.current?.isConnected)
        current.current.onError(friendlyError(error));
    }
  };
  return (
    <>
      <MenuAction disabled={busy} onClick={() => edit("undo")}>
        Undo
      </MenuAction>
      <MenuAction disabled={busy} onClick={() => edit("redo")}>
        Redo
      </MenuAction>
      <hr />
      <MenuAction disabled={busy || !selected} onClick={() => edit("cut")}>
        Cut
      </MenuAction>
      <MenuAction disabled={!selected} onClick={() => edit("copy")}>
        Copy
      </MenuAction>
      <MenuAction disabled={busy} onClick={() => edit("paste")}>
        Paste
      </MenuAction>
      <MenuAction
        disabled={!input.current?.value}
        onClick={() => edit("selectAll")}
      >
        Select all
      </MenuAction>
      {uploadsAllowed && (
        <>
          <hr />
          {image && (
            <MenuAction
              disabled={attachDisabled}
              onClick={() => void attachImage()}
            >
              Paste image as attachment
            </MenuAction>
          )}
          <MenuAction
            disabled={attachDisabled}
            onClick={() => {
              if (canAttach()) current.current.file.current?.click();
            }}
          >
            Attach file…
          </MenuAction>
        </>
      )}
      {cancelReply && (
        <>
          <hr />
          <MenuAction onClick={() => current.current.cancelReply?.()}>
            Cancel reply
          </MenuAction>
        </>
      )}
    </>
  );
}
