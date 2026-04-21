import { boolean, integer, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const catalogSchema = pgSchema("catalog");

export const products = catalogSchema.table("products", {
  id: uuid("id").defaultRandom().primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  priceCents: integer("price_cents").notNull(),
  status: text("status").notNull(),
  featured: boolean("featured").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const announcements = catalogSchema.table("announcements", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  tone: text("tone").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
