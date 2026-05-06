import { SignUp } from "@clerk/nextjs";

const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
const hasUsableClerkKey =
  typeof publishableKey === "string" &&
  /^(pk|test|live)_/.test(publishableKey) &&
  publishableKey.length > 20;

export default function SignUpPage() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6 text-center">
      {hasUsableClerkKey ? (
        <SignUp />
      ) : (
        <div className="max-w-md space-y-3 rounded-lg border bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-semibold">Sign-up is not configured yet</h1>
          <p className="text-sm text-gray-600">
            Clerk is not configured. Add Clerk keys to
            <code className="mx-1 rounded bg-gray-100 px-1 py-0.5">.env</code>
            to enable authentication.
          </p>
        </div>
      )}
    </div>
  );
}
