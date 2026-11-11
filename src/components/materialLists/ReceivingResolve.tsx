"use client";
import {
  useEffect,
  useState,
  type ComponentProps,
  type ComponentType,
} from "react";
import { Button } from "~/components/ui/button";
import type { ReceivingResolve as Content } from "./ReceivingResolveContent";
export { linkLineAction } from "./receiving-link-action";
export type { ResolveTarget } from "./receiving-link-action";
type Props = ComponentProps<typeof Content>;

/** Only selected resolution views mount this loader. Rejections are handled at
 * the import boundary; a mounted editor's render errors retain prior behavior. */
export function ReceivingResolve(props: Props) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{
    Panel: ComponentType<Props> | null;
    failed: boolean;
  }>({ Panel: null, failed: false });
  useEffect(() => {
    let active = true;
    void import("./ReceivingResolveContent")
      .then((module) => {
        if (active) setState({ Panel: module.ReceivingResolve, failed: false });
      })
      .catch(() => {
        if (active) setState({ Panel: null, failed: true });
      });
    return () => {
      active = false;
    };
  }, [attempt]);
  if (state.Panel) return <state.Panel {...props} />;
  return (
    <section
      aria-label="Opening receiving resolution"
      className="space-y-3 p-4"
    >
      <p role={state.failed ? "alert" : "status"}>
        {state.failed
          ? "Resolution could not load. Check your connection and try again."
          : "Opening resolution…"}
      </p>
      {state.failed && (
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setState({ Panel: null, failed: false });
            setAttempt((value) => value + 1);
          }}
        >
          Try again
        </Button>
      )}
      <Button type="button" variant="outline" onClick={props.onClose}>
        Back to receiving
      </Button>
    </section>
  );
}
