import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { userAddress, type InstanceClient } from "@haunt/core";
import { openProfile } from "./Profile";
import { displayName } from "./People";

function AccountLine({ text, className }: { text: string; className: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current!;
    const measure = () =>
      setOverflow(
        Math.max(
          0,
          element.firstElementChild!.scrollWidth - element.clientWidth,
        ),
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    observer.observe(element.firstElementChild!);
    return () => observer.disconnect();
  }, [text]);
  return (
    <span
      ref={ref}
      className={`account-label-line ${className}`}
      title={text}
      data-overflow={overflow > 0}
      style={
        {
          "--account-scroll": `-${overflow}px`,
          "--account-scroll-time": `${Math.max(3, overflow / 25)}s`,
        } as CSSProperties
      }
    >
      <span>{text}</span>
    </span>
  );
}

export function AccountLabel({ instance }: { instance: InstanceClient }) {
  const user = instance.account.login.user;
  return (
    <button
      className="user-name account-label"
      onClick={() => openProfile(instance, user.id)}
    >
      <AccountLine className="account-display-name" text={displayName(user)} />
      <AccountLine
        className="account-address"
        text={userAddress(instance, user)}
      />
    </button>
  );
}
