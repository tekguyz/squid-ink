/**
 * A two-step control's label, sized for its longer word (#20 critique).
 *
 * "Stop" becoming "Confirm stop" widened the right-anchored pill, so its
 * left edge jumped and the second press could miss. Both labels share one
 * grid cell; the one not showing is `invisible` (keeps its width) and
 * `aria-hidden` (out of the accessible name).
 */
export function ArmedLabel({
  armed,
  idle,
  confirm,
}: {
  armed: boolean;
  idle: string;
  confirm: string;
}) {
  return (
    <span className="inline-grid justify-items-center">
      <span aria-hidden={armed} className={`col-start-1 row-start-1 ${armed ? "invisible" : ""}`}>
        {idle}
      </span>
      <span aria-hidden={!armed} className={`col-start-1 row-start-1 ${armed ? "" : "invisible"}`}>
        {confirm}
      </span>
    </span>
  );
}
