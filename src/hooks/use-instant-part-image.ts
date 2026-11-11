"use client";
import { useLayoutEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { api, type RouterInputs, type RouterOutputs } from "~/trpc/react";
import { useDrawingAccount } from "~/components/jobs/DrawingAccountProvider";
import { captureDeviceReadAuthority } from "~/lib/device-query-cache";
import { beginInstantQueryUpdate } from "~/lib/instant-query-update";
import { requestCatalogueReplicachePull } from "~/lib/replicache-catalogue";
import { useInstantMutation } from "./use-instant-mutation";

type Part = RouterOutputs["catalogue"]["getPart"];
type Result = RouterOutputs["catalogue"]["updatePart"];
type Input = Pick<RouterInputs["catalogue"]["updatePart"], "partId"> & {
  imageUrl: string;
  expectedAccountKey: string;
};
type Owner = {
  scope: string;
  accountKey: string;
  generation: number;
  authority: ReturnType<typeof captureDeviceReadAuthority>;
};
type Request = { input: Input; owner: Owner };
class UnexpectedPartIdentity extends Error {}
const storedImage = (url: string) =>
  /^\/(?:api\/catalogue\/images|images\/catalog\/uploads)\/[a-z0-9][a-z0-9._/-]*$/i.test(
    url,
  ) && !url.split("/").includes("..");

/** Attach an existing stored photo to an already-authorized organization part.
 * No upload, global copy, price/pack metadata or Replicache row is invented. */
export function useInstantPartImage(options: {
  partId: string | undefined;
  enabled: boolean;
  visibleImage: string;
  onPreview: (image: string) => void;
  onRestore: (image: string) => void;
}) {
  const account = useDrawingAccount();
  const client = useQueryClient(),
    utils = api.useUtils();
  const scope = `${account?.accountKey ?? ""}|${options.partId ?? ""}|${options.enabled}`;
  const current = useRef({
    scope,
    accountKey: account?.accountKey ?? "",
    generation: 0,
    visibleImage: options.visibleImage,
    mounted: false,
  });
  const pending = useRef(new Set<{ scope: string; generation: number }>());
  const deferredUI = useRef<Array<() => void>>([]);
  const [failed, setFailed] = useState<{
    scope: string;
    imageUrl: string;
  } | null>(null);
  useLayoutEffect(() => {
    if (current.current.scope !== scope) {
      current.current.generation++;
      current.current.scope = scope;
      deferredUI.current = [];
    }
    current.current.accountKey = account?.accountKey ?? "";
    current.current.visibleImage = options.visibleImage;
  }, [scope, options.visibleImage, account?.accountKey]);
  useLayoutEffect(() => {
    current.current.mounted = true;
    for (const work of deferredUI.current.splice(0)) work();
    const lifecycle = current.current;
    return () => {
      lifecycle.mounted = false;
    };
  }, []);
  const owns = (owner: Owner) =>
    owner.scope === current.current.scope &&
    owner.generation === current.current.generation &&
    owner.authority === captureDeviceReadAuthority();
  const deliver = (owner: Owner, work: () => void) => {
    const guarded = () => {
      if (owns(owner)) work();
    };
    if (current.current.mounted) guarded();
    else deferredUI.current.push(guarded);
  };
  const sameAccount = (owner: Owner) =>
    owner.accountKey === current.current.accountKey &&
    owner.authority === captureDeviceReadAuthority();
  const mutation = useInstantMutation<Result, Request>({
    mutationKey: [["catalogue", "updatePart"]],
    mutationFn: async ({ input, owner }) => {
      if (!owns(owner))
        throw Error(
          "Your workspace changed before the photo attachment was sent.",
        );
      const result = await utils.client.catalogue.updatePart.mutate(input);
      if (result?.id !== input.partId)
        throw new UnexpectedPartIdentity(
          "Refresh this part to check its saved photo before trying again.",
        );
      return result;
    },
    optimistic: ({ input, owner }) => {
      if (
        !options.enabled ||
        !current.current.mounted ||
        !account?.accountKey ||
        !owns(owner) ||
        input.partId !== options.partId
      )
        throw Error(
          "Open an organization-owned part before attaching its photo.",
        );
      if (!storedImage(input.imageUrl))
        throw Error("Store this photo before attaching it.");
      const key = getQueryKey(
        api.catalogue.getPart,
        { partId: input.partId },
        "query",
      );
      const previousImage = current.current.visibleImage;
      const change = beginInstantQueryUpdate<Part, Result>(
        client,
        key,
        (part) => {
          if (part?.id !== input.partId || !part.isOrgSpecific)
            throw Error(
              "Only an existing organization-owned part can preview a photo attachment.",
            );
          return { ...part, imageUrl: input.imageUrl };
        },
        (result, part) => ({
          ...part,
          imageUrl: result.imageUrl,
          approvedImageUrl: result.imageUrl,
        }),
      );
      // A missing cache is never treated as a successful optimistic transaction.
      if (!client.getQueryData<Part>(key)) {
        change.finish?.();
        throw Error("Refresh this part before attaching its photo.");
      }
      const preview = client.getQueryData<Part>(key);
      const query = client.getQueryCache().find({ queryKey: key, exact: true });
      const inFlight = { scope: owner.scope, generation: owner.generation };
      pending.current.add(inFlight);
      setFailed(null);
      try {
        options.onPreview(input.imageUrl);
        current.current.visibleImage = input.imageUrl;
      } catch (error) {
        change.rollback();
        change.finish?.();
        pending.current.delete(inFlight);
        throw error;
      }
      return {
        commit: (result) => {
          change.commit?.(result);
          deliver(owner, () => {
            if (current.current.visibleImage !== input.imageUrl) return;
            const accepted = client.getQueryData<Part>(key);
            if (accepted?.id === input.partId)
              options.onRestore(accepted.imageUrl ?? "");
          });
        },
        rollback: () => {
          const owned =
            client.getQueryData<Part>(key) === preview &&
            client.getQueryCache().find({ queryKey: key, exact: true }) ===
              query;
          change.rollback();
          const restored = client.getQueryData<Part>(key);
          deliver(owner, () => {
            if (current.current.visibleImage !== input.imageUrl) return;
            const accepted = client.getQueryData<Part>(key);
            // Refreshed authority wins; a removed account cache cannot revive UI.
            if (accepted?.id === input.partId)
              options.onRestore(
                owned && accepted === restored
                  ? previousImage
                  : (accepted.imageUrl ?? ""),
              );
          });
        },
        finish: () => {
          change.finish?.();
          pending.current.delete(inFlight);
        },
      };
    },
    onError: (error, { input, owner }) => {
      if (!(error instanceof UnexpectedPartIdentity))
        deliver(owner, () =>
          setFailed({ scope: owner.scope, imageUrl: input.imageUrl }),
        );
    },
    onSettled: ({ input, owner }) => {
      // Closing/switching the editor does not cancel a same-account accepted
      // write or its authoritative list refresh. UI callbacks stay view-fenced.
      if (!sameAccount(owner)) return;
      void utils.catalogue.getPart.invalidate({ partId: input.partId });
      void utils.catalogue.searchParts.invalidate();
      void utils.catalogue.getPartWizardSummary.invalidate();
      requestCatalogueReplicachePull(0);
    },
    errorMessage:
      "Photo attachment could not be confirmed. Refresh to check the saved photo.",
  });
  const owner = (): Owner => ({
    accountKey: account?.accountKey ?? "",
    scope: current.current.scope,
    generation: current.current.generation,
    authority: captureDeviceReadAuthority(),
  });
  const attach = (imageUrl: string) => {
    const captured = owner();
    return mutation.mutateAsync({
      input: {
        partId: options.partId ?? "",
        imageUrl,
        expectedAccountKey: captured.accountKey,
      },
      owner: captured,
    });
  };
  return {
    ...mutation,
    attach,
    hasPending: () =>
      [...pending.current].some(
        (entry) =>
          entry.scope === current.current.scope &&
          entry.generation === current.current.generation,
      ),
    failedImage: failed?.scope === scope ? failed.imageUrl : null,
    // Capture before a real upload. A later account/part/open switch must never
    // attach its response under the new viewer's credentials.
    captureUpload: () => {
      const captured = owner(),
        partId = options.partId;
      return (imageUrl: string) => {
        if (!owns(captured) || !partId) return Promise.resolve(undefined);
        if (!current.current.mounted) {
          // A hidden view can offer its completed upload for explicit retry on
          // return. A removed view never starts a late attachment request.
          deliver(captured, () =>
            setFailed({ scope: captured.scope, imageUrl }),
          );
          return Promise.resolve(undefined);
        }
        return mutation.mutateAsync({
          input: { partId, imageUrl, expectedAccountKey: captured.accountKey },
          owner: captured,
        });
      };
    },
  };
}
