/** Elapsed recording time in the shape App Surfaces 02b renders: "12:41", and
 *  "1:02:03" once a recording passes an hour. Truncates rather than rounds — a
 *  clock that reaches 0:01 at 500 ms reads as broken. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);

  const ss = String(seconds).padStart(2, "0");
  if (hours === 0) return `${minutes}:${ss}`;
  return `${hours}:${String(minutes).padStart(2, "0")}:${ss}`;
}
