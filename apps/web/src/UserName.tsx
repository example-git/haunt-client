import {
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { InstanceClient, User } from "@haunt/core";
import { observeName } from "@haunt/browser/name-readability";

const idle = () => () => {};
export function UserName({
  user,
  instance,
  children,
}: {
  user?: User;
  instance?: InstanceClient;
  children?: ReactNode;
}) {
  const current = useSyncExternalStore(
    instance?.subscribe ?? idle,
    () =>
      instance?.snapshot.users.find((value) => value.id === user?.id) ?? user,
  );
  const ref = useRef<HTMLSpanElement>(null);
  const color = /^#[\da-f]{6}$/i.test(current?.accent_color ?? "")
    ? current!.accent_color!
    : "#77d9b0";
  useLayoutEffect(() => observeName(ref.current!, color), [color]);
  return (
    <span ref={ref} className="profile-user-name">
      {children ?? (current?.display_name || current?.username || "Member")}
    </span>
  );
}
