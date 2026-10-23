import { UserName } from "./UserName";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import {
  findAccounts,
  type AccountEntry,
} from "@haunt/browser/account-directory";
import { Avatar, displayName } from "./People";

export function PeopleSearch({
  people,
  query,
  onQuery,
  onChoose,
  busy,
}: {
  people: AccountEntry[];
  query: string;
  onQuery: (value: string) => void;
  onChoose: (entry: AccountEntry) => void;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false),
    [active, setActive] = useState(0);
  const id = useId();
  const list = useRef<HTMLDivElement>(null);
  const matches = useMemo(() => findAccounts(people, query), [people, query]);
  const rows = matches.slice(0, 50);
  const index = Math.min(active, Math.max(0, rows.length - 1));
  useEffect(() => {
    list.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [index]);
  const choose = (entry?: AccountEntry) => {
    if (!entry?.online || busy) return;
    setOpen(false);
    onChoose(entry);
  };
  return (
    <div
      className="dm-people-search"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setOpen(false);
      }}
    >
      <label className="dm-search">
        <Search size={16} aria-hidden="true" />
        <input
          aria-label="Search direct messages"
          placeholder="Find people · username@serveraddress"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          aria-activedescendant={
            open && rows.length ? `${id}-${index}` : undefined
          }
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            onQuery(event.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Escape") {
              event.preventDefault();
              setOpen(false);
            } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setOpen(true);
              if (rows.length)
                setActive(
                  (value) =>
                    (value +
                      (event.key === "ArrowDown" ? 1 : -1) +
                      rows.length) %
                    rows.length,
                );
            } else if (event.key === "Enter" && open) {
              event.preventDefault();
              choose(rows[index]);
            }
          }}
        />
      </label>
      {open && (
        <div className="dm-people-results" ref={list}>
          <div
            id={id}
            role="listbox"
            aria-label="People across your servers"
            aria-busy={busy}
          >
            {rows.map((entry, i) => (
              <button
                key={entry.key}
                id={`${id}-${i}`}
                role="option"
                aria-selected={i === index}
                aria-label={entry.address}
                disabled={!entry.online || busy}
                onMouseDown={(event) => event.preventDefault()}
                onMouseMove={() => setActive(i)}
                onClick={() => choose(entry)}
                tabIndex={-1}
              >
                <Avatar instance={entry.instance} user={entry.user} />
                <span>
                  <strong>
                    <UserName instance={entry.instance} user={entry.user} />
                  </strong>
                  <small className="account-address">
                    {entry.address}
                    {!entry.online && " · Disconnected"}
                  </small>
                </span>
              </button>
            ))}
          </div>
          {!rows.length && <p className="muted">No matching people.</p>}
          {matches.length > rows.length && (
            <p className="muted">
              Type a name or server address to narrow the results.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
