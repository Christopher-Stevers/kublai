"use client";
// Only copied into disposable lab snapshots. Never referenced by production config.
import { Fragment } from "react";
const user = {
  id: "perf-lab-user",
  fullName: "Speed Lab",
  firstName: "Speed",
  lastName: "Lab",
  imageUrl: "",
  emailAddresses: [{ emailAddress: "perf-lab@example.invalid" }],
  primaryEmailAddress: { emailAddress: "perf-lab@example.invalid" },
  passwordEnabled: false,
  twoFactorEnabled: false,
};
export function ClerkProvider({ children }) {
  return <Fragment>{children}</Fragment>;
}
export function useUser() {
  return { isLoaded: true, isSignedIn: true, user };
}
export function useAuth() {
  return {
    isLoaded: true,
    isSignedIn: true,
    userId: user.id,
    sessionId: "perf-lab-session",
    getToken: async () => null,
  };
}
export function useClerk() {
  return {
    signOut: async () => {
      throw new Error("Sign-out is outside the isolated speed lab");
    },
    openUserProfile: () => {},
  };
}
export function useReverification(callback) {
  return callback;
}
export function SignIn() {
  return <p>Lab authentication stub — sign-in timing excluded</p>;
}
export const SignUp = SignIn;
