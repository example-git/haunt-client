/** Calendar boundaries follow the viewer's local timezone, including DST. */
export function messageDay(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export function messageDayLabel(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export function messageTimestamp(value: string, now: number) {
  const date = new Date(value);
  const time = date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return now - date.getTime() >= 24 * 60 * 60 * 1000
    ? `${date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}, ${time}`
    : time;
}
