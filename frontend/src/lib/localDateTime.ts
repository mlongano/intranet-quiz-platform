/**
 * <input type="datetime-local"> speaks local wall-clock time without a zone;
 * the server wants an instant. The browser knows the teacher's zone, so the
 * conversion happens here, and the server refuses a time without a zone.
 */

/** ISO instant → "YYYY-MM-DDTHH:mm" in local time, for the input's value. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The input's value → ISO instant (UTC), or null when empty. */
export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);       // parsed as local time
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function formatSchedule(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('it-IT', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}
