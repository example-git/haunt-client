import { UserName } from "./UserName";
import { useEffect, useState, useSyncExternalStore } from "react";
import { userAddress, type InstanceClient } from "@haunt/core";
import { Avatar, displayName, UserStatus } from "./People";
import { Modal } from "./App";

export function openProfile(instance: InstanceClient, user: string) {
  window.dispatchEvent(
    new CustomEvent("haunt:profile", {
      detail: { scope: instance.scope, user },
    }),
  );
}
export function ProfileHost({
  instances,
  onMessage,
  onEdit,
}: {
  instances: InstanceClient[];
  onMessage: (instance: InstanceClient, user: string) => void;
  onEdit: (instance: InstanceClient) => void;
}) {
  const [selected, setSelected] = useState<{ scope: string; user: string }>();
  useEffect(() => {
    const receive = (e: Event) => {
      const value = (e as CustomEvent).detail;
      if (
        value &&
        typeof value.scope === "string" &&
        typeof value.user === "string"
      )
        setSelected(value);
    };
    window.addEventListener("haunt:profile", receive);
    return () => window.removeEventListener("haunt:profile", receive);
  }, []);
  const instance = instances.find((i) => i.scope === selected?.scope);
  return instance && selected ? (
    <ProfileDialog
      instance={instance}
      userID={selected.user}
      onClose={() => setSelected(undefined)}
      onMessage={() => {
        setSelected(undefined);
        onMessage(instance, selected.user);
      }}
      onEdit={() => {
        setSelected(undefined);
        onEdit(instance);
      }}
    />
  ) : null;
}
function ProfileDialog({
  instance,
  userID,
  onClose,
  onMessage,
  onEdit,
}: {
  instance: InstanceClient;
  userID: string;
  onClose: () => void;
  onMessage: () => void;
  onEdit: () => void;
}) {
  const state = useSyncExternalStore(instance.subscribe, instance.getSnapshot);
  const user = state.users.find((u) => u.id === userID);
  if (!user) return null;
  return (
    <Modal title="Member profile" onClose={onClose}>
      <div className="member-profile">
        <Avatar instance={instance} user={user} size="large" />
        <h2>
          <UserName instance={instance} user={user} />
        </h2>
        <p className="muted account-address">
          {userAddress(instance, user)}
          {user.is_owner ? " · Server owner" : ""}
        </p>
        <p>
          <UserStatus instance={instance} user={user.id} text />
        </p>
        {user.bio && <p className="profile-bio">{user.bio}</p>}
        <small>
          Member since {new Date(user.created_at).toLocaleDateString()}
        </small>
        <div className="button-row">
          {user.id === instance.account.login.user.id ? (
            <button className="primary" onClick={onEdit}>
              Edit your profile
            </button>
          ) : (
            <button className="primary" onClick={onMessage}>
              Message user
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
