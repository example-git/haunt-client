import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { InstanceClient } from "@haunt/core";
import { AccountDirectory } from "@haunt/browser/account-directory";

export function useAccountDirectory(instances: InstanceClient[]) {
  const directory = useMemo(() => new AccountDirectory(), [instances]);
  useEffect(() => directory.start(instances), [directory, instances]);
  return useSyncExternalStore(directory.subscribe, directory.getSnapshot);
}
