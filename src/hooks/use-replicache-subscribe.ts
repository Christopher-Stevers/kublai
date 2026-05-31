"use client";

import { useEffect, useState } from "react";
import type { MutatorDefs, ReadTransaction, Replicache } from "replicache";

export function useReplicacheSubscribe<R, M extends MutatorDefs>(
  rep: Replicache<M> | null,
  body: (tx: ReadTransaction) => Promise<R>,
  options: { default: R },
): R {
  const [value, setValue] = useState<R>(options.default);

  useEffect(() => {
    if (!rep) return;

    return rep.subscribe(body, {
      onData: setValue,
      onError: (error) => {
        console.error("Replicache subscription failed", error);
      },
    });
  }, [rep, body]);

  return value;
}
