import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PasswordSettings } from "./PasswordSettings";

type PasswordParams = {
  newPassword: string;
  signOutOfOtherSessions?: boolean;
};

const mock = vi.hoisted(() => {
  const updatePassword = vi.fn<(params: PasswordParams) => Promise<unknown>>();
  const user = {
    id: "user-one",
    passwordEnabled: true,
    primaryEmailAddress: { emailAddress: "pat@example.test" },
    username: null,
    updatePassword,
  };
  return {
    user,
    auth: { isLoaded: true, user: user as typeof user | null },
    updatePassword,
    verifiedUpdate: vi.fn<(params: PasswordParams) => void>(),
    verificationError: null as Error | null,
    apiError: {
      errors: [{ longMessage: "This password is too weak." }],
    },
    cancellation: new Error("Reverification cancelled"),
    useUser: vi.fn(),
    useReverification: vi.fn(),
  };
});

vi.mock("@clerk/nextjs", () => ({
  useUser: () => {
    mock.useUser();
    return mock.auth;
  },
  useReverification: (
    callback: (params: PasswordParams) => Promise<unknown>,
  ) => {
    mock.useReverification();
    return (params: PasswordParams) => {
      mock.verifiedUpdate(params);
      if (mock.verificationError) {
        return Promise.reject(mock.verificationError);
      }
      return callback(params);
    };
  },
}));

vi.mock("@clerk/nextjs/errors", () => ({
  isClerkAPIResponseError: (cause: unknown) => cause === mock.apiError,
  isReverificationCancelledError: (cause: unknown) =>
    cause === mock.cancellation,
}));

function openForm() {
  fireEvent.click(
    screen.getByRole("button", { name: /^(Change|Set) password$/ }),
  );
}

function fillPasswords({
  next = "  new example password  ",
  confirmation = next,
}: {
  next?: string;
  confirmation?: string;
} = {}) {
  fireEvent.change(screen.getByLabelText("New password"), {
    target: { value: next },
  });
  fireEvent.change(screen.getByLabelText("Confirm new password"), {
    target: { value: confirmation },
  });
}

function submitForm() {
  fireEvent.submit(screen.getByRole("form", { name: "Change password" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv(
    "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
    "pk_test_password_settings_fixture",
  );
  mock.auth.isLoaded = true;
  mock.auth.user = { ...mock.user };
  mock.verificationError = null;
  mock.updatePassword
    .mockReset()
    .mockResolvedValue({ id: "user-one", passwordEnabled: true });
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("PasswordSettings", () => {
  it("rejects mismatching confirmation before requesting an update", () => {
    render(<PasswordSettings isOnline />);
    openForm();
    fillPasswords({ confirmation: "different password" });
    submitForm();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The new passwords do not match.",
    );
    expect(mock.verifiedUpdate).not.toHaveBeenCalled();
    expect(mock.updatePassword).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "updates through reverification with other-session sign-out set to %s",
    async (signOutOthers) => {
      render(<PasswordSettings isOnline />);
      openForm();
      expect(
        screen.queryByLabelText("Current password"),
      ).not.toBeInTheDocument();
      expect(
        document.querySelector('[autocomplete="current-password"]'),
      ).toBeNull();
      fillPasswords();
      const signOut = screen.getByRole("checkbox", {
        name: "Sign out of other devices",
      });
      expect(signOut).not.toBeChecked();
      if (signOutOthers) fireEvent.click(signOut);
      submitForm();

      await screen.findByText("Password saved successfully.");
      const expected = {
        newPassword: "  new example password  ",
        signOutOfOtherSessions: signOutOthers,
      };
      expect(mock.verifiedUpdate).toHaveBeenCalledExactlyOnceWith(expected);
      expect(mock.updatePassword).toHaveBeenCalledExactlyOnceWith(expected);
    },
  );

  it("clears password fields and visibility/session choices after success", async () => {
    render(<PasswordSettings isOnline />);
    openForm();
    fillPasswords();
    fireEvent.click(screen.getByRole("checkbox", { name: "Show passwords" }));
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Sign out of other devices" }),
    );
    submitForm();

    await screen.findByText("Password saved successfully.");
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
    openForm();

    for (const label of ["New password", "Confirm new password"]) {
      expect(screen.getByLabelText(label)).toHaveValue("");
      expect(screen.getByLabelText(label)).toHaveAttribute("type", "password");
    }
    expect(
      screen.getByRole("checkbox", { name: "Show passwords" }),
    ).not.toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Sign out of other devices" }),
    ).not.toBeChecked();
    expect(
      screen.queryByText("Password saved successfully."),
    ).not.toBeInTheDocument();
  });

  it("shows Clerk's provider error without claiming success", async () => {
    mock.updatePassword.mockRejectedValueOnce(mock.apiError);
    render(<PasswordSettings isOnline />);
    openForm();
    fillPasswords();
    submitForm();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This password is too weak.",
    );
    expect(
      screen.queryByText("Password saved successfully."),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("New password")).toHaveValue(
      "  new example password  ",
    );
    expect(screen.getByRole("button", { name: "Save password" })).toBeEnabled();
  });

  it("handles cancelled reverification without calling the update or claiming success", async () => {
    mock.verificationError = mock.cancellation;
    render(<PasswordSettings isOnline />);
    openForm();
    fillPasswords();
    submitForm();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Verification was cancelled. Your password was not changed.",
    );
    expect(mock.verifiedUpdate).toHaveBeenCalledOnce();
    expect(mock.updatePassword).not.toHaveBeenCalled();
    expect(
      screen.queryByText("Password saved successfully."),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save password" })).toBeEnabled();
  });

  it("shows a connection error when an update fails unexpectedly", async () => {
    mock.updatePassword.mockRejectedValueOnce(new Error("Network unavailable"));
    render(<PasswordSettings isOnline />);
    openForm();
    fillPasswords();
    submitForm();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to change your password. Check your connection and try again.",
    );
    expect(
      screen.queryByText("Password saved successfully."),
    ).not.toBeInTheDocument();
  });

  it("does not claim success for an unresolved update response", async () => {
    mock.updatePassword.mockResolvedValueOnce(undefined);
    render(<PasswordSettings isOnline />);
    openForm();
    fillPasswords();
    submitForm();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(
      screen.queryByText("Password saved successfully."),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("New password")).toHaveValue(
      "  new example password  ",
    );
  });

  it("sets a first password without sending a current password", async () => {
    mock.auth.user = { ...mock.user, passwordEnabled: false };
    render(<PasswordSettings isOnline />);
    expect(screen.getByRole("button", { name: "Set password" })).toBeEnabled();
    openForm();
    expect(screen.queryByLabelText("Current password")).not.toBeInTheDocument();
    fillPasswords();
    submitForm();

    await screen.findByText("Password saved successfully.");
    const expected = {
      newPassword: "  new example password  ",
      signOutOfOtherSessions: false,
    };
    expect(mock.verifiedUpdate).toHaveBeenCalledExactlyOnceWith(expected);
    expect(mock.updatePassword).toHaveBeenCalledExactlyOnceWith(expected);
  });

  it("disables password editing while offline", () => {
    render(<PasswordSettings isOnline={false} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Connect to the internet to change your password.",
    );
    const change = screen.getByRole("button", { name: "Change password" });
    expect(change).toBeDisabled();
    fireEvent.click(change);
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
    expect(mock.verifiedUpdate).not.toHaveBeenCalled();
  });

  it("blocks an open form from submitting after the device goes offline", () => {
    const view = render(<PasswordSettings isOnline />);
    openForm();
    fillPasswords();
    view.rerender(<PasswordSettings isOnline={false} />);
    expect(screen.getByLabelText("New password")).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Save password" }),
    ).toBeDisabled();
    submitForm();
    expect(mock.verifiedUpdate).not.toHaveBeenCalled();
    expect(mock.updatePassword).not.toHaveBeenCalled();
  });

  it("discards the prior account's password fields and choices after an account switch", () => {
    const view = render(<PasswordSettings isOnline />);
    openForm();
    fillPasswords();
    fireEvent.click(screen.getByRole("checkbox", { name: "Show passwords" }));
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Sign out of other devices" }),
    );
    mock.auth.user = { ...mock.user, id: "user-two" };
    view.rerender(<PasswordSettings isOnline />);
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
    openForm();

    expect(screen.getByLabelText("New password")).toHaveValue("");
    expect(screen.getByLabelText("Confirm new password")).toHaveValue("");
    expect(
      screen.getByRole("checkbox", { name: "Show passwords" }),
    ).not.toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Sign out of other devices" }),
    ).not.toBeChecked();
    expect(mock.updatePassword).not.toHaveBeenCalled();
  });

  it("renders a preview fallback without calling Clerk hooks when configuration is missing", () => {
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "");
    render(<PasswordSettings isOnline />);
    expect(
      screen.getByText("Password changes are unavailable in this preview."),
    ).toBeInTheDocument();
    expect(mock.useUser).not.toHaveBeenCalled();
    expect(mock.useReverification).not.toHaveBeenCalled();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("waits for Clerk to load before showing password controls", () => {
    mock.auth.isLoaded = false;
    render(<PasswordSettings isOnline />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading password settings…",
    );
    expect(mock.useReverification).not.toHaveBeenCalled();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows a sign-in prompt when there is no active user", () => {
    mock.auth.user = null;
    render(<PasswordSettings isOnline />);
    expect(
      screen.getByText("Sign in to change your password."),
    ).toBeInTheDocument();
    expect(mock.useReverification).not.toHaveBeenCalled();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("prevents repeated submissions while an update is pending", async () => {
    let resolveUpdate!: (value: unknown) => void;
    mock.updatePassword.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveUpdate = resolve;
      }),
    );
    render(<PasswordSettings isOnline />);
    openForm();
    fillPasswords();
    submitForm();
    submitForm();

    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(mock.verifiedUpdate).toHaveBeenCalledOnce();
    expect(mock.updatePassword).toHaveBeenCalledOnce();
    resolveUpdate({ id: "user-one", passwordEnabled: true });
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "Password saved successfully.",
      );
    });
  });
});
