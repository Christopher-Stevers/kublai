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
    return new Response("Error occurred", {
      status: 400,
    });
  }

  // Handle the webhook
  const eventType = evt.type;

  if (eventType === "user.created" || eventType === "user.updated") {
    const { id, email_addresses, first_name, last_name, image_url } = evt.data;

    const email = email_addresses?.[0]?.email_address ?? "";
    const name =
      first_name && last_name
        ? `${first_name} ${last_name}`
        : (first_name ?? last_name ?? null);

    // Upsert user in database
    const existingUser = await db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);

    if (existingUser.length > 0) {
      // Update existing user
      await db
        .update(users)
        .set({
          name: name ?? null,
          email: email,
          image: image_url ?? null,
          updatedAt: new Date(),
        })
        .where(eq(users.id, id));
    } else {
      // Create new user
      await db.insert(users).values({
        id,
        name: name ?? null,
        email: email,
        image: image_url ?? null,
        role: "user",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
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
