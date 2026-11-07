"use client";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { api } from "~/trpc/react";
import { useOnlineStatus } from "~/hooks/use-online-status";
import {
  defaultMaterialSortSettings,
  effectiveMaterialSortSettings,
  materialSortSettingsSchema,
  type MaterialSortSettings,
} from "~/lib/material-sort-preferences";
import { NAME_KEYWORDS_KEY } from "~/lib/name-keyword-defaults";
import { isMaterialListSort } from "~/lib/material-list-sort";

type State = {
  shared: MaterialSortSettings;
  personal: MaterialSortSettings | null;
  custom: boolean;
  initialized: boolean;
  canEditExecutive: boolean;
};
const fallback: State = {
  shared: defaultMaterialSortSettings,
  personal: null,
  custom: false,
  initialized: false,
  canEditExecutive: false,
};
function usePreferenceState(userId: string, organizationId: string) {
  const online = useOnlineStatus();
  const key = `foremenhq.material-sort.v2.${organizationId}.${userId}`;
  const utils = api.useUtils();
  const input = { expectedUserId: userId, expectedOrganizationId: organizationId };
  const query = api.user.getMaterialSortPreferences.useQuery(input, {
    enabled: online,
    refetchInterval: 60000,
  });
  const mutation = api.user.setMaterialSortPreferences.useMutation({
    scope: { id: key },
  });
  const [cached, setCached] = useState<State | null>(null);
  const [draft, setDraft] = useState<State | null>(null);
  const [editingExecutive, setEditingExecutive] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const revision = useRef(0);
  const seeded = useRef(false);
  const pending = useRef<{
    state: State;
    target: "executive" | "personal";
  } | null>(null);
  useEffect(() => {
    try {
      const saved = JSON.parse(
        localStorage.getItem(key) ?? "null",
      ) as State | null;
      if (
        saved &&
        materialSortSettingsSchema.safeParse(saved.shared).success &&
        (saved.personal === null ||
          materialSortSettingsSchema.safeParse(saved.personal).success)
      )
        // Hydrate browser-only storage after the server/client initial render agrees.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setCached({ ...saved, canEditExecutive: false });
    } catch {
      /* Storage is optional. */
    }
  }, [key]);
  const state = draft ?? query.data ?? cached ?? fallback;
  useEffect(() => {
    if (!query.data || draft) return;
    try {
      localStorage.setItem(key, JSON.stringify(query.data));
    } catch {
      /* Session still works. */
    }
  }, [key, state, query.data, draft]);
  // Only an authenticated executive may seed the shared setting from their old
  // browser preference. Simulation cannot publish another account's settings.
  useEffect(() => {
    if (
      !query.data?.canEditExecutive ||
      query.data.initialized ||
      seeded.current
    )
      return;
    seeded.current = true;
    let settings = query.data.shared;
    try {
      const mode = localStorage.getItem("foremenhq.material-list-sort");
      const groups = JSON.parse(
        localStorage.getItem(NAME_KEYWORDS_KEY) ?? "null",
      ) as unknown;
      if (!isMaterialListSort(mode) && groups === null) return;
      settings =
        materialSortSettingsSchema.safeParse({
          sortMode: isMaterialListSort(mode) ? mode : "material",
          keywordGroups: groups ?? settings.keywordGroups,
        }).data ?? settings;
    } catch {
      return; // A fresh or inaccessible browser must not claim the executive default.
    }
    // Stock browser defaults are not evidence of an executive customization.
    if (JSON.stringify(settings) === JSON.stringify(defaultMaterialSortSettings)) return;
    void mutation
      .mutateAsync({
        ...input,
        target: "executive",
        settings,
        custom: false,
        initializeOnly: true,
      })
      .then((data) =>
        utils.user.getMaterialSortPreferences.setData(input, data),
      )
      .catch(() =>
        setError("Could not save executive sorting. Please reload to retry."),
      );
  }, [query.data]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const change = pending.current;
    if (!change || !draft) return;
    const currentRevision = revision.current;
    const timer = setTimeout(() => {
      void mutation
        .mutateAsync({
          ...input,
          target: change.target,
          settings:
            change.target === "executive"
              ? change.state.shared
              : (change.state.personal ?? change.state.shared),
          custom: change.state.custom,
        })
        .then((data) => {
          if (revision.current !== currentRevision) return;
          pending.current = null;
          utils.user.getMaterialSortPreferences.setData(input, data);
          setDraft(null);
          setSaving(false);
        })
        .catch(() => {
          if (revision.current !== currentRevision) return;
          setSaving(false);
          setError(
            "Sorting could not be saved. Your changes remain here; edit again to retry.",
          );
        });
    }, 400);
    return () => clearTimeout(timer);
  }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps
  function update(next: State, target: "executive" | "personal") {
    if (!online || !query.data) return;
    revision.current++;
    pending.current = { state: next, target };
    setError("");
    setSaving(true);
    setDraft(next);
  }
  const effective = effectiveMaterialSortSettings(
    state.shared,
    state.personal,
    state.custom,
  );
  const settings = editingExecutive ? state.shared : effective;
  function edit(settings: MaterialSortSettings) {
    if (editingExecutive && state.canEditExecutive)
      update({ ...state, shared: settings }, "executive");
    else if (state.custom) update({ ...state, personal: settings }, "personal");
  }
  return {
    ...effective,
    editorSettings: settings,
    custom: state.custom,
    editingExecutive,
    canEditExecutive: state.canEditExecutive,
    editable: online && !!query.data,
    saving,
    error:
      error ||
      (query.error
        ? "Unable to load current sorting settings. Showing the saved sorting."
        : ""),
    setEditingExecutive,
    setCustom: (custom: boolean) => {
      setEditingExecutive(false);
      update(
        { ...state, custom, personal: state.personal ?? effective },
        "personal",
      );
    },
    setSortMode: (sortMode: MaterialSortSettings["sortMode"]) =>
      edit({ ...settings, sortMode }),
    setKeywordGroups: (
      keywordGroups: readonly MaterialSortSettings["keywordGroups"][number][],
    ) => edit({ ...settings, keywordGroups: [...keywordGroups] }),
  };
}
const Context = createContext<ReturnType<typeof usePreferenceState> | null>(
  null,
);
export function MaterialSortProvider({
  userId,
  organizationId,
  children,
}: {
  userId: string;
  organizationId: string;
  children: React.ReactNode;
}) {
  const value = usePreferenceState(userId, organizationId);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export const useMaterialSortContext = () => useContext(Context);
