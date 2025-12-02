import { relations } from "drizzle-orm";
import { index, pgTableCreator, primaryKey, unique } from "drizzle-orm/pg-core";
import { type AdapterAccount } from "next-auth/adapters";

/**
 * This is an example of how to use the multi-project schema feature of Drizzle ORM. Use the same
 * database instance for multiple projects.
 *
 * @see https://orm.drizzle.team/docs/goodies#multi-project-schema
 */
export const createTable = pgTableCreator((name) => `genghis_${name}`);

export const users = createTable("user", (d) => ({
  id: d
    .varchar({ length: 255 })
    .notNull()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: d.varchar({ length: 255 }),
  email: d.varchar({ length: 255 }).notNull(),
  emailVerified: d
    .timestamp({
      mode: "date",
      withTimezone: true,
    })
    .$defaultFn(() => /* @__PURE__ */ new Date()),
  image: d.varchar({ length: 255 }),
  stripeCustomerId: d.varchar({ length: 255 }),
  role: d.varchar({ length: 50 }).default("user"), // "user" | "admin"
}));

export const usersRelations = relations(users, ({ many }) => ({
  accounts: many(accounts),
  orders: many(orders),
  creatives: many(creatives),
}));

export const accounts = createTable(
  "account",
  (d) => ({
    userId: d
      .varchar({ length: 255 })
      .notNull()
      .references(() => users.id),
    type: d.varchar({ length: 255 }).$type<AdapterAccount["type"]>().notNull(),
    provider: d.varchar({ length: 255 }).notNull(),
    providerAccountId: d.varchar({ length: 255 }).notNull(),
    refresh_token: d.text(),
    access_token: d.text(),
    expires_at: d.integer(),
    token_type: d.varchar({ length: 255 }),
    scope: d.varchar({ length: 255 }),
    id_token: d.text(),
    session_state: d.varchar({ length: 255 }),
  }),
  (t) => [
    primaryKey({ columns: [t.provider, t.providerAccountId] }),
    index("account_user_id_idx").on(t.userId),
  ],
);

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, { fields: [accounts.userId], references: [users.id] }),
}));

export const sessions = createTable(
  "session",
  (d) => ({
    sessionToken: d.varchar({ length: 255 }).notNull().primaryKey(),
    userId: d
      .varchar({ length: 255 })
      .notNull()
      .references(() => users.id),
    expires: d.timestamp({ mode: "date", withTimezone: true }).notNull(),
  }),
  (t) => [index("t_user_id_idx").on(t.userId)],
);

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const verificationTokens = createTable(
  "verification_token",
  (d) => ({
    identifier: d.varchar({ length: 255 }).notNull(),
    token: d.varchar({ length: 255 }).notNull(),
    expires: d.timestamp({ mode: "date", withTimezone: true }).notNull(),
  }),
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

// ============================
// BOARD TYPE
// ============================

export const boardTypes = createTable("board_type", (d) => ({
  id: d
    .uuid()
    .notNull()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: d.varchar({ length: 255 }).notNull(),
  description: d.text(),
  imageUrl: d.text(),
  slotCostPerDay: d.integer().notNull().default(0), // in cents
  backfillCostPerDay: d.integer().notNull().default(0), // in cents
  dimensionX: d.integer(),
  dimensionY: d.integer(),
}));

export const boardTypesRelations = relations(boardTypes, ({ many }) => ({
  boards: many(boards),
}));

// ============================
// BOARD
// ============================

export const boards = createTable("board", (d) => ({
  id: d
    .uuid()
    .notNull()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  boardTypeId: d
    .uuid()
    .notNull()
    .references(() => boardTypes.id),
  vehicleName: d.varchar({ length: 255 }),
  vehicleDescription: d.text(),
}));

export const boardsRelations = relations(boards, ({ one, many }) => ({
  boardType: one(boardTypes, {
    fields: [boards.boardTypeId],
    references: [boardTypes.id],
  }),
  slots: many(slots),
}));

// ============================
// SLOTS
// Each slot belongs to a Board and an Order
// ============================

export const slots = createTable(
  "slot",
  (d) => ({
    id: d
      .uuid()
      .notNull()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    boardId: d
      .uuid()
      .notNull()
      .references(() => boards.id),
    orderId: d
      .uuid()
      .notNull()
      .references(() => orders.id),
    startTime: d.timestamp({ withTimezone: true }).notNull(),
    endTime: d.timestamp({ withTimezone: true }).notNull(),
  }),
  (t) => [
    index("slot_board_time_idx").on(t.boardId, t.startTime, t.endTime),
    index("slot_order_id_idx").on(t.orderId),
  ],
);

export const slotsRelations = relations(slots, ({ one }) => ({
  board: one(boards, {
    fields: [slots.boardId],
    references: [boards.id],
  }),
  order: one(orders, {
    fields: [slots.orderId],
    references: [orders.id],
  }),
}));

// ============================
// BACKFILL
// Each backfill belongs to an Order (does not claim board time)
// ============================

export const backfills = createTable("backfill", (d) => ({
  id: d
    .uuid()
    .notNull()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  orderId: d
    .uuid()
    .notNull()
    .references(() => orders.id),
  hours: d.integer().notNull(),
  startTime: d.timestamp({ withTimezone: true }).notNull(),
  endTime: d.timestamp({ withTimezone: true }).notNull(),
}));

export const backfillsRelations = relations(backfills, ({ one }) => ({
  order: one(orders, {
    fields: [backfills.orderId],
    references: [orders.id],
  }),
}));

// ============================
// ORDER
// belongs to User
// may have many CreativeForOrder rows
// ============================

export const orders = createTable("order", (d) => ({
  id: d
    .uuid()
    .notNull()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: d
    .varchar({ length: 255 })
    .notNull()
    .references(() => users.id),
  totalPrice: d.integer().notNull(), // in cents
  currency: d.varchar({ length: 10 }).default("cad"),
  status: d.varchar({ length: 50 }), // 'pending', 'paid', 'failed', 'void'
  createdAt: d
    .timestamp({ withTimezone: true })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: d
    .timestamp({ withTimezone: true })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdate(() => new Date()),
  stripePaymentIntentId: d.varchar({ length: 255 }),
  isSubsidizedBySubscription: d.boolean().default(false),
  approved: d.boolean().default(false),
  approvedBy: d
    .varchar({ length: 255 })
    .references(() => users.id), // Admin user who approved
  approvedAt: d.timestamp({ withTimezone: true }), // When it was approved
  targetUrl: d.text(),
  utmTag: d.text(),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  user: one(users, {
    fields: [orders.userId],
    references: [users.id],
  }),
  slots: many(slots),
  backfills: many(backfills),
  creativeForOrders: many(creativeForOrders),
}));

// ============================
// CREATIVE
// basic info about creative files
// ============================

export const creatives = createTable("creative", (d) => ({
  id: d
    .uuid()
    .notNull()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: d
    .varchar({ length: 255 })
    .notNull()
    .references(() => users.id),
  fileName: d.varchar({ length: 255 }).notNull(),
  fileType: d.varchar({ length: 50 }).notNull(), // "image" or "video"
  filePath: d.text().notNull(), // e.g., "/uploads/userId/uuid-filename.ext"
  fileSize: d.bigint({ mode: "number" }).notNull(), // file size in bytes
  mimeType: d.varchar({ length: 100 }).notNull(), // e.g., "image/jpeg", "video/mp4"
  uploadDate: d
    .timestamp({ withTimezone: true })
    .notNull()
    .$defaultFn(() => new Date()),
  approved: d.boolean().default(false),
  approvedBy: d
    .varchar({ length: 255 })
    .references(() => users.id), // Admin user who approved
  approvedAt: d.timestamp({ withTimezone: true }), // When it was approved
}));

export const creativesRelations = relations(creatives, ({ one, many }) => ({
  user: one(users, {
    fields: [creatives.userId],
    references: [users.id],
  }),
  creativeForOrders: many(creativeForOrders),
}));

// ============================
// CREATIVE_FOR_ORDER (join table)
// many Creative <-> many Orders
// ============================

export const creativeForOrders = createTable(
  "creative_for_order",
  (d) => ({
    id: d
      .uuid()
      .notNull()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    orderId: d
      .uuid()
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    creativeId: d
      .uuid()
      .notNull()
      .references(() => creatives.id, { onDelete: "cascade" }),
  }),
  (t) => [
    // Unique constraint on order_id and creative_id combination
    unique().on(t.orderId, t.creativeId),
  ],
);

export const creativeForOrdersRelations = relations(
  creativeForOrders,
  ({ one }) => ({
    order: one(orders, {
      fields: [creativeForOrders.orderId],
      references: [orders.id],
    }),
    creative: one(creatives, {
      fields: [creativeForOrders.creativeId],
      references: [creatives.id],
    }),
  }),
);



