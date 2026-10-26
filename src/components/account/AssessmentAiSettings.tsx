"use client";
import { useSystemsAccess } from "~/components/permissions/SystemsAccess";
import { useState } from "react";
import { api } from "~/trpc/react";
import { type AssessmentAi } from "~/lib/assessment-ai";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
export function AssessmentAiSettings() {
  return useSystemsAccess() ? <AssessmentAiSettingsContent /> : null;
}
function AssessmentAiSettingsContent() {
  const query = api.pipeSpecs.aiConnection.useQuery();
  const utils = api.useUtils();
  const [draft, setDraft] = useState<AssessmentAi | null>(null);
  const [message, setMessage] = useState("");
  const save = api.pipeSpecs.saveAiConnection.useMutation({
    onSuccess: (result) => {
      setDraft(null);
      setMessage(`Connection checked and saved: ${result.model}.`);
      void utils.pipeSpecs.aiConnection.invalidate();
      void utils.pipeSpecs.assessment.invalidate();
    },
    onError: (error) => setMessage(error.message),
  });
  const stored = query.data?.settings;
  if (!query.data?.canConfigure || !stored) return null;
  const value = draft ?? {
    mode: stored.mode,
    baseUrl: stored.baseUrl,
    model: stored.model,
    reasoning: stored.reasoning,
    apiKey: "",
  };
  const change = (patch: Partial<AssessmentAi>) => {
    setDraft({ ...value, ...patch });
    setMessage("");
  };
  const inputClass = "w-full rounded-md border bg-background p-2";
  return (
    <Card>
      <CardHeader>
        <CardTitle>Assessment AI</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-muted-foreground text-sm">
          Company-wide model for assessing selected specifications and drawings.
          Results need review; model certainty does not prove accuracy.
        </p>
        <label className="block">
          Model connection
          <select
            className={inputClass}
            value={value.mode}
            disabled={save.isPending}
            onChange={(e) =>
              change({ mode: e.target.value as AssessmentAi["mode"] })
            }
          >
            <option value="hosted">Use ForemanHQ Qwen</option>
            <option value="custom">Connect your own provider</option>
          </select>
        </label>
        {value.mode === "hosted" ? (
          <p className="text-sm">
            Uses Qwen on the ForemanHQ server. No personal API key is needed.
          </p>
        ) : (
          <>
            <p className="text-sm">
              Requires a public HTTPS, OpenAI-compatible Chat Completions API
              with JSON responses. Selected source text goes to this provider;
              its usage charges and data policies apply. Private network
              endpoints are not supported here.
            </p>
            <label className="block">
              API base URL
              <input
                className={inputClass}
                value={value.baseUrl}
                placeholder="https://provider.example/v1"
                disabled={save.isPending}
                onChange={(e) =>
                  change({ baseUrl: e.target.value, apiKey: "" })
                }
              />
            </label>
            <label className="block">
              Model ID
              <input
                className={inputClass}
                value={value.model}
                disabled={save.isPending}
                onChange={(e) => change({ model: e.target.value })}
              />
            </label>
            <label className="block">
              API key
              <input
                className={inputClass}
                type="password"
                autoComplete="new-password"
                value={value.apiKey}
                placeholder={
                  stored.hasKey && stored.baseUrl === value.baseUrl
                    ? "Saved key — leave blank to keep"
                    : "Provider API key"
                }
                disabled={save.isPending}
                onChange={(e) => change({ apiKey: e.target.value })}
              />
            </label>
            <details>
              <summary>Advanced</summary>
              <label className="block">
                Reasoning
                <select
                  className={inputClass}
                  value={value.reasoning}
                  disabled={save.isPending}
                  onChange={(e) =>
                    change({
                      reasoning: e.target.value as AssessmentAi["reasoning"],
                    })
                  }
                >
                  {["default", "low", "medium", "high"].map((v) => (
                    <option key={v} value={v}>
                      {v === "default" ? "Provider default (recommended)" : v}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-sm">
                Only change this if your model supports reasoning_effort. Higher
                settings may increase time and cost.
              </p>
            </details>
          </>
        )}
        <Button
          disabled={save.isPending}
          onClick={() => {
            setMessage("");
            save.mutate(value);
          }}
        >
          {save.isPending ? "Checking connection…" : "Test and save"}
        </Button>
        <p className="text-muted-foreground text-sm">
          Tests a small sample, not your documents. Keys are encrypted on the
          server. Switching to hosted Qwen removes the saved external
          connection.
        </p>
        {message && (
          <p role="status" className="text-sm">
            {message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
