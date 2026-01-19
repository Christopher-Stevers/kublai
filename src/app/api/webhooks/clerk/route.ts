import { Webhook } from "svix";
import { headers } from "next/headers";
import type { WebhookEvent } from "@clerk/nextjs/server";
import { db } from "~/server/db";
import { users } from "~/server/db/schema";
import { eq } from "drizzle-orm";
import { env } from "~/env";

export async function POST(req: Request) {
  // Get the Svix headers for verification
  const headerPayload = await headers();
  const svix_id = headerPayload.get("svix-id");
  const svix_timestamp = headerPayload.get("svix-timestamp");
  const svix_signature = headerPayload.get("svix-signature");

  // If there are no headers, error out
  if (!svix_id || !svix_timestamp || !svix_signature) {
    return new Response("Error occurred -- no svix headers", {
      status: 400,
    });
  }

  // Get the body
  const payload = await req.json();
  const body = JSON.stringify(payload);

  // Create a new Svix instance with your secret.
  const wh = new Webhook(env.CLERK_WEBHOOK_SECRET ?? "");

  let evt: WebhookEvent;

  // Verify the payload with the headers
  try {
    evt = wh.verify(body, {
      "svix-id": svix_id,
      "svix-timestamp": svix_timestamp,
      "svix-signature": svix_signature,
    }) as WebhookEvent;
  } catch (err) {
    console.error("Error verifying webhook:", err);
    console.error("Payload body:", body);
    return new Response("Error occurred", {
      status: 400,
    });
  }

  // Handle the webhook
  const eventType = evt.type;
  console.log(`[Clerk Webhook] Received event: ${eventType} for user: ${evt.data.id}`);

  if (eventType === "user.created" || eventType === "user.updated") {
    const { id, email_addresses, first_name, last_name, image_url } = evt.data;

    // Extract email - use first available email or fallback to placeholder
    // Email is required in schema, so we must provide a value
    const email = email_addresses?.[0]?.email_address ?? `${id}@clerk.temp`;
    const name =
      first_name && last_name
        ? `${first_name} ${last_name}`
        : (first_name ?? last_name ?? null);

    // Upsert user in database - webhook is the single source of truth for user creation
    // Try insert first (for new users), then update if user already exists
    try {
      await db.insert(users).values({
        id,
        name: name ?? null,
        email: email, // Required field - use placeholder if no email
        image: image_url ?? null,
        role: "user",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    } catch (insertError) {
      // Check if this is a unique constraint violation (user already exists)
      const isUniqueConstraintError =
        insertError instanceof Error &&
        (insertError.message.includes("unique") ||
          insertError.message.includes("duplicate") ||
          insertError.message.includes("violates unique constraint"));

      if (isUniqueConstraintError) {
        // User already exists - update with latest data from Clerk
        // This handles cases where webhook fires multiple times or user was created elsewhere
        await db
          .update(users)
          .set({
            name: name ?? null,
            email: email, // Update email if it changed
            image: image_url ?? null,
            updatedAt: new Date(),
          })
          .where(eq(users.id, id));
      } else {
        // Re-throw if it's a different error (e.g., database connection issue)
        console.error("Error creating/updating user in webhook:", insertError);
        throw insertError;
      }
    }
  }

  if (eventType === "user.deleted") {
    const { id } = evt.data;

    if (id) {
      // Delete user from database
      await db.delete(users).where(eq(users.id, id));
    }
  }

  return new Response("", { status: 200 });
}
