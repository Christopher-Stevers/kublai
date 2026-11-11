"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { captureDeviceReadAuthority } from "~/lib/device-query-cache";
import { isAppPageActive } from "~/lib/app-page-activity";

/** No durable mutation or paused reconnect replay: membership stays a server read. */
export function useChatJoin(options: {
  identity: string;
  canStart: () => boolean;
  dispatch: () => Promise<unknown>;
  refresh: () => Promise<unknown>;
  readMembership: () => Promise<{ joined: boolean }>;
  onError: (message: string) => void;
}) {
  const authority = captureDeviceReadAuthority();
  const binding = useMemo(
    () => ({ identity: options.identity, authority }),
    [options.identity, authority],
  );
  const current = useRef({ options, binding, mounted: false, epoch: 0 });
  const flight = useRef<{ token: symbol; binding: typeof binding } | null>(
    null,
  );
  const uncertain = useRef<typeof binding | null>(null);
  const cancelCheck = useRef<(() => void) | null>(null);
  const [pending, setPending] = useState<{
    token: symbol;
    binding: typeof binding;
  } | null>(null);
  const [needsCheck, setNeedsCheck] = useState<typeof binding | null>(null);
  useLayoutEffect(() => {
    if (current.current.binding !== binding) {
      current.current.epoch++;
      cancelCheck.current?.();
    }
    current.current.binding = binding;
    current.current.options = options;
  });
  useLayoutEffect(() => {
    const lifecycle = current.current;
    lifecycle.mounted = true;
    return () => {
      lifecycle.mounted = false;
      lifecycle.epoch++;
      flight.current = null;
      cancelCheck.current?.();
      setPending(null);
    };
  }, []);
  const run = async () => {
    const owner = {
      epoch: current.current.epoch,
      binding,
      authority: captureDeviceReadAuthority(),
    };
    const owns = () =>
      current.current.mounted &&
      current.current.binding === owner.binding &&
      current.current.epoch === owner.epoch &&
      captureDeviceReadAuthority() === owner.authority;
    const allowed = () =>
      owns() &&
      navigator.onLine &&
      isAppPageActive() &&
      current.current.options.canStart();
    if (flight.current?.binding === binding || !allowed()) return;
    const token = Symbol();
    const intent = { token, binding };
    flight.current = intent;
    setPending(intent);
    const check = async () => {
      if (!allowed()) return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          current.current.options.readMembership(),
          new Promise<never>((_, reject) => {
            cancelCheck.current = () => {
              if (timer) clearTimeout(timer);
              reject(Error("Membership check ended."));
            };
            timer = setTimeout(
              () => reject(Error("Membership check timed out.")),
              15000,
            );
          }),
        ]);
        if (!allowed()) return;
        uncertain.current = null;
        setNeedsCheck(null);
        current.current.options.onError(
          result.joined
            ? ""
            : "Membership checked. Press Join job chat to try again.",
        );
      } catch {
        if (owns())
          current.current.options.onError(
            "Joining could not be confirmed. Check membership before trying again.",
          );
      } finally {
        if (timer) clearTimeout(timer);
        if (owns()) cancelCheck.current = null;
      }
    };
    try {
      if (uncertain.current === binding) {
        await check();
        return;
      }
      // Recheck after admission: connectivity/authority may change in this turn.
      await Promise.resolve();
      if (!allowed()) return;
      await current.current.options.dispatch();
      if (allowed()) {
        try {
          void current.current.options.refresh().catch(() => undefined);
        } catch {
          /* Confirmed join survives read catch-up failure. */
        }
      }
    } catch {
      if (!owns()) return;
      uncertain.current = binding;
      setNeedsCheck(binding);
      current.current.options.onError(
        "Joining could not be confirmed. Checking current membership…",
      );
      await check();
    } finally {
      if (flight.current?.token === token) flight.current = null;
      setPending((old) => (old?.token === token ? null : old));
    }
  };
  return {
    run,
    pending: pending?.binding === binding,
    needsCheck: needsCheck === binding,
  };
}
