import { Webhook } from "svix";
import { headers } from "next/headers";
import type { WebhookEvent } from "@clerk/nextjs/server";
import { db } from "~/server/db";
import { users } from "~/server/db/schema";
import { eq } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { env } from "~/env";

const userIdColumn = (users as unknown as { id: AnyPgColumn }).id;

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
  const body = await req.text();

  // Create a new Svix instance with your secret.
  const wh = new Webhook(env.CLERK_WEBHOOK_SECRET ?? "");

  let evt: WebhookEvent;

  // Verify the payload with the headers
  try {
    const signatureHeaders = {
      "svix-id": svix_id,
      "svix-timestamp": svix_timestamp,
      "svix-signature": svix_signature,
    };
    try {
      evt = wh.verify(body, signatureHeaders) as WebhookEvent;
    } catch (error) {
      const secondary = process.env.CLERK_WEBHOOK_SECRET_SECONDARY;
      if (!secondary) throw error;
      evt = new Webhook(secondary).verify(body, signatureHeaders) as WebhookEvent;
    }
  } catch (err) {
    console.error("Error verifying webhook:", err);
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

    // Atomic upsert handles retries and existing users without parsing wrapped
    // driver errors. Preserve organization membership, permissions and billing.
    await db.insert(users).values({
      id,
      name,
      email,
      image: image_url ?? null,
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: userIdColumn,
      set: {
        name,
        email,
        image: image_url ?? null,
        updatedAt: new Date(),
      },
    });
  }

  if (eventType === "user.deleted") {
    const { id } = evt.data;

    if (id) {
      // Delete user from database
      await db.delete(users).where(eq(userIdColumn, id));
    }
  }

  return new Response("", { status: 200 });
}
