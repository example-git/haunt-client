import { userAddress, type InstanceClient, type User } from "@haunt/core";

export interface AccountEntry {
  key: string;
  instance: InstanceClient;
  user: User;
  address: string;
  online: boolean;
  search: string;
}
/** Local gateway rosters only; no per-keystroke HTTP or presence subscriptions. */
export class AccountDirectory {
  private entries: AccountEntry[] = [];
  private listeners = new Set<() => void>();
  getSnapshot = () => this.entries;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  start(instances: InstanceClient[]) {
    const groups = new Map<string, AccountEntry[]>();
    const off = instances.map((instance) => {
      let users: User[] | undefined,
        status = "",
        name = "",
        url = "";
      const update = () => {
        const state = instance.snapshot,
          info = instance.account.instance;
        if (
          users === state.users &&
          status === state.status &&
          name === info.name &&
          url === info.public_url
        )
          return;
        users = state.users;
        status = state.status;
        name = info.name;
        url = info.public_url;
        groups.set(
          instance.scope,
          status === "signed-out"
            ? []
            : users
                .filter((user) => user.id !== instance.account.login.user.id)
                .map((user) => {
                  const address = userAddress(instance, user);
                  return {
                    key: JSON.stringify([instance.scope, user.id]),
                    instance,
                    user,
                    address,
                    online: status === "online",
                    search:
                      `${address} ${user.display_name ?? ""} ${name}`.toLocaleLowerCase(),
                  };
                }),
        );
        this.entries = [...groups.values()]
          .flat()
          .sort(
            (a, b) =>
              a.address.localeCompare(b.address) || a.key.localeCompare(b.key),
          );
        for (const fn of this.listeners) fn();
      };
      const unsubscribe = instance.subscribe(update);
      update();
      return unsubscribe;
    });
    return () => {
      for (const unsubscribe of off) unsubscribe();
    };
  }
}
export function findAccounts(entries: AccountEntry[], query: string) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter((entry) =>
    terms.every((term) => entry.search.includes(term)),
  );
}
