"use client";

import { useEmployeeSimulation } from "~/components/simulation/SimulationProvider";
import { useRef, useState, type FormEvent } from "react";
import { useReverification, useUser } from "@clerk/nextjs";
import {
  isClerkAPIResponseError,
  isReverificationCancelledError,
} from "@clerk/nextjs/errors";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";

export function PasswordSettings({ isOnline }: { isOnline: boolean }) {
  const simulation = useEmployeeSimulation();
  // Match SessionProviderWrapper: local previews may run without Clerk.
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const hasClerk =
    typeof publishableKey === "string" &&
    /^(pk|test|live)_/.test(publishableKey) &&
    publishableKey.length > 20;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Password</CardTitle>
      </CardHeader>
      <CardContent>
        {simulation ? (
          <p className="text-muted-foreground text-sm">
            End simulation before changing your password.
          </p>
        ) : hasClerk ? (
          <SignedInPasswordSettings isOnline={isOnline} />
        ) : (
          <p className="text-muted-foreground text-sm">
            Password changes are unavailable in this preview.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function SignedInPasswordSettings({ isOnline }: { isOnline: boolean }) {
  const { isLoaded, user } = useUser();
  if (!isLoaded) {
    return <p role="status">Loading password settings…</p>;
  }
  if (!user) {
    return (
      <p className="text-muted-foreground text-sm">
        Sign in to change your password.
      </p>
    );
  }
  // Switching accounts must discard any password fields from the old account.
  return <PasswordForm key={user.id} user={user} isOnline={isOnline} />;
}

function PasswordForm({
  user,
  isOnline,
}: {
  user: NonNullable<ReturnType<typeof useUser>["user"]>;
  isOnline: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const [signOutOthers, setSignOutOthers] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const submitting = useRef(false);
  const updatePassword = useReverification(
    (params: Parameters<typeof user.updatePassword>[0]) =>
      user.updatePassword(params),
  );

  function clearFields() {
    setNewPassword("");
    setConfirmation("");
    setShowPasswords(false);
    setSignOutOthers(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isOnline || submitting.current) return;
    setError(null);
    if (!newPassword) {
      setError("Fill in the password fields.");
      return;
    }
    if (newPassword !== confirmation) {
      setError("The new passwords do not match.");
      return;
    }
    submitting.current = true;
    setSaving(true);
    try {
      const updatedUser = await updatePassword({
        newPassword,
        signOutOfOtherSessions: signOutOthers,
      });
      if (updatedUser?.id !== user.id || !updatedUser.passwordEnabled) {
        throw new Error("Password update was not confirmed");
      }
      clearFields();
      setEditing(false);
      setSuccess(true);
    } catch (cause) {
      if (isReverificationCancelledError(cause)) {
        setError("Verification was cancelled. Your password was not changed.");
      } else if (isClerkAPIResponseError(cause)) {
        setError(
          cause.errors[0]?.longMessage ??
            cause.errors[0]?.message ??
            "Unable to change your password. Please try again.",
        );
      } else {
        setError(
          "Unable to change your password. Check your connection and try again.",
        );
      }
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {!isOnline && (
        <p role="status" className="text-muted-foreground text-sm">
          Connect to the internet to change your password.
        </p>
      )}
      {success && (
        <p role="status" className="text-sm text-green-700 dark:text-green-400">
          Password saved successfully.
        </p>
      )}
      {!editing ? (
        <Button
          disabled={!isOnline}
          onClick={() => {
            setError(null);
            setSuccess(false);
            setEditing(true);
          }}
        >
          {user.passwordEnabled ? "Change password" : "Set password"}
        </Button>
      ) : (
        <form
          onSubmit={handleSubmit}
          className="max-w-md space-y-4"
          aria-label="Change password"
        >
          <input
            type="text"
            name="username"
            autoComplete="username"
            value={
              user.primaryEmailAddress?.emailAddress ?? user.username ?? ""
            }
            readOnly
            hidden
          />
          <fieldset disabled={saving || !isOnline} className="space-y-4">
            <p className="text-muted-foreground text-sm">
              Enter your new password twice. If asked to verify your identity,
              choose an email code to continue without your old password.
            </p>
            <div className="space-y-1">
              <label htmlFor="new-password" className="text-sm font-medium">
                New password
              </label>
              <Input
                id="new-password"
                name="newPassword"
                type={showPasswords ? "text" : "password"}
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                required
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="confirm-password" className="text-sm font-medium">
                Confirm new password
              </label>
              <Input
                id="confirm-password"
                name="confirmPassword"
                type={showPasswords ? "text" : "password"}
                autoComplete="new-password"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                required
              />
            </div>
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={showPasswords}
                onChange={(event) => setShowPasswords(event.target.checked)}
              />
              Show passwords
            </label>
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={signOutOthers}
                onChange={(event) => setSignOutOthers(event.target.checked)}
              />
              Sign out of other devices
            </label>
          </fieldset>
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={saving || !isOnline}>
              {saving ? "Saving…" : "Save password"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => {
                clearFields();
                setError(null);
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
