"use client";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Monitor, Moon, Sun, Palette, ListOrdered, Mail } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { useThemePreference } from "~/components/app/ThemeProvider";
import type { ThemePreference } from "~/lib/theme";
import {
  EMAIL_CLIENT_OPTIONS,
  getPreferredEmailClient,
  setPreferredEmailClient,
  isEmailClientPreference,
  type EmailClientPreference,
} from "~/lib/mailto";
import { useMaterialListSortPreference } from "~/hooks/use-material-list-sort";
import {
  MATERIAL_LIST_SORT_OPTIONS,
  EXAMPLE_NAME_KEYWORD_GROUPS,
  type NameKeywordGroup,
  isMaterialListSort,
} from "~/lib/material-list-sort";

const themes: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

export default function SettingsPage() {
  const { theme, setTheme } = useThemePreference();
  const { sortMode, setSortMode, keywordGroups, setKeywordGroups } =
    useMaterialListSortPreference();
  const [emailClient, setEmailClient] =
    useState<EmailClientPreference>("default");
  const [message, setMessage] = useState("");
  useEffect(() => {
    setEmailClient(getPreferredEmailClient());
  }, []);

  const updateKeywords = (groups: readonly NameKeywordGroup[]) => {
    setKeywordGroups(groups);
    setMessage("Keyword sorting updated.");
  };
  const moveKeywordGroup = (index: number, offset: number) => {
    const groups = [...keywordGroups];
    const next = index + offset;
    if (next < 0 || next >= groups.length) return;
    [groups[index], groups[next]] = [groups[next]!, groups[index]!];
    updateKeywords(groups);
  };

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5 px-4 py-6 sm:px-6 sm:py-8">
      <div>
        <h1 className="text-foreground text-2xl font-bold sm:text-3xl">
          Settings
        </h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Make ForemanHQ work the way you prefer. Changes save automatically on
          this device.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Palette className="h-5 w-5" /> Appearance
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div
            className="grid grid-cols-3 gap-2"
            role="group"
            aria-label="Appearance"
          >
            {themes.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                type="button"
                aria-pressed={theme === value}
                onClick={() => {
                  setTheme(value);
                  setMessage("Appearance saved.");
                }}
                className={`flex min-h-20 flex-col items-center justify-center gap-2 rounded-lg border p-3 text-sm font-medium ${theme === value ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-foreground hover:bg-muted"}`}
              >
                <Icon className="h-5 w-5" />
                {label}
              </button>
            ))}
          </div>
          <p className="text-muted-foreground mt-3 text-sm">
            System follows your device’s light or dark setting.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ListOrdered className="h-5 w-5" /> Material lists
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <label
            htmlFor="settings-list-sort"
            className="block text-sm font-medium"
          >
            Preferred sort order
          </label>
          <select
            id="settings-list-sort"
            value={sortMode}
            onChange={(e) => {
              if (isMaterialListSort(e.target.value)) {
                setSortMode(e.target.value);
                setMessage("Material-list sorting saved.");
              }
            }}
            className="bg-background text-foreground h-11 w-full rounded-md border px-3 text-sm"
          >
            {MATERIAL_LIST_SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="text-muted-foreground text-sm">
            Applies to grid and table views, including offline lists.
          </p>
          <div className="mt-4 space-y-3 border-t pt-4">
            <h3 className="text-sm font-semibold">Name keyword priority</h3>
            <p className="text-muted-foreground text-sm">
              Within each catalog, material, size, and category, groups higher in this
              list come first. Separate related keywords with commas. The first
              matching group wins; unmatched parts go last. Names sort
              alphabetically within each group.
            </p>
            <p className="text-muted-foreground text-sm">
              Matches whole words or phrases, ignoring capitalization. Add
              alternate names such as “adapter, adaptor” to the same group. A
              part must match an Includes keyword and none of that group’s
              Excludes keywords. For example, include “90” and exclude
              “reducing” to keep reducing 90s out of that group. Excluded parts
              can match a later group and stay visible in the list. Applies to
              material lists and the Add menu.
            </p>
            {keywordGroups.length === 0 && (
              <p className="text-muted-foreground text-sm">
                No keyword groups yet. Names currently sort alphabetically.
              </p>
            )}
            <ol className="space-y-3" aria-label="Keyword priority groups">
              {keywordGroups.map((group, index) => (
                <li key={index} className="space-y-2 rounded-md border p-3">
                  <h4 className="text-sm font-medium">Group {index + 1}</h4>
                  <label
                    htmlFor={`keyword-group-${index}-includes`}
                    className="block text-sm"
                  >
                    Includes
                  </label>
                  <Input
                    id={`keyword-group-${index}-includes`}
                    aria-label={`Group ${index + 1} includes`}
                    value={group.includes}
                    placeholder="e.g. 90, elbow"
                    onChange={(event) =>
                      updateKeywords(
                        keywordGroups.map((value, i) =>
                          i === index
                            ? { ...value, includes: event.target.value }
                            : value,
                        ),
                      )
                    }
                  />
                  <label
                    htmlFor={`keyword-group-${index}-excludes`}
                    className="block text-sm"
                  >
                    Excludes
                  </label>
                  <Input
                    id={`keyword-group-${index}-excludes`}
                    aria-label={`Group ${index + 1} excludes`}
                    value={group.excludes}
                    placeholder="e.g. reducing"
                    onChange={(event) =>
                      updateKeywords(
                        keywordGroups.map((value, i) =>
                          i === index
                            ? { ...value, excludes: event.target.value }
                            : value,
                        ),
                      )
                    }
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={index === 0}
                      aria-label={`Move group ${index + 1} up`}
                      onClick={() => moveKeywordGroup(index, -1)}
                    >
                      Move up
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={index === keywordGroups.length - 1}
                      aria-label={`Move group ${index + 1} down`}
                      onClick={() => moveKeywordGroup(index, 1)}
                    >
                      Move down
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Remove group ${index + 1}`}
                      onClick={() =>
                        updateKeywords(
                          keywordGroups.filter((_, i) => i !== index),
                        )
                      }
                    >
                      Remove
                    </Button>
                  </div>
                </li>
              ))}
            </ol>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() =>
                  updateKeywords([
                    ...keywordGroups,
                    { includes: "", excludes: "" },
                  ])
                }
              >
                Add keyword group
              </Button>
              {keywordGroups.length === 0 && (
                <Button
                  variant="outline"
                  onClick={() => updateKeywords(EXAMPLE_NAME_KEYWORD_GROUPS)}
                >
                  Use example groups
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" /> Email
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <label
            htmlFor="settings-email-client"
            className="block text-sm font-medium"
          >
            Preferred email app
          </label>
          <select
            id="settings-email-client"
            value={emailClient}
            onChange={(e) => {
              if (isEmailClientPreference(e.target.value)) {
                setPreferredEmailClient(e.target.value);
                setEmailClient(e.target.value);
                setMessage("Email preference saved.");
              }
            }}
            className="bg-background text-foreground h-11 w-full rounded-md border px-3 text-sm"
          >
            {EMAIL_CLIENT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="text-muted-foreground text-sm">
            Choose where email links open when you contact a supplier.
          </p>
        </CardContent>
      </Card>

      <p
        role="status"
        aria-live="polite"
        className="text-muted-foreground min-h-5 text-sm"
      >
        {message}
      </p>
      <p className="text-muted-foreground text-sm">
        For your profile and subscription, go to{" "}
        <Link
          href="/dashboard/account"
          className="text-foreground font-medium underline underline-offset-4"
        >
          Manage Account
        </Link>
        .
      </p>
    </div>
  );
}
