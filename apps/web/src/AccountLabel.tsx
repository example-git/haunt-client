import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { userAddress, type InstanceClient } from "@haunt/core";
import { openProfile } from "./Profile";

export function AccountLabel({ instance }: { instance: InstanceClient }) {
  const user = instance.account.login.user;
  const address = userAddress(instance, user);
  const ref = useRef<HTMLButtonElement>(null);
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
  }, [address]);
  return (
    <div className="account-label">
      <button
        ref={ref}
        className="user-name account-address"
        title={address}
        data-overflow={overflow > 0}
        onClick={() => openProfile(instance, user.id)}
        style={
          {
            "--account-scroll": `-${overflow}px`,
            "--account-scroll-time": `${Math.max(3, overflow / 25)}s`,
          } as CSSProperties
        }
      >
        <span>{address}</span>
      </button>
      {user.is_owner && <small>Server owner</small>}
    </div>
  );
}
