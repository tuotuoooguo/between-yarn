import { sql } from "drizzle-orm";
import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const yarnProjects = sqliteTable("yarn_projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  yarnAName: text("yarn_a_name").notNull(),
  yarnBName: text("yarn_b_name").notNull(),
  yarnAKey: text("yarn_a_key").notNull(),
  yarnBKey: text("yarn_b_key").notNull(),
  previewKey: text("preview_key").notNull(),
  colorA: text("color_a").notNull(),
  colorB: text("color_b").notNull(),
  userId: text("user_id"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_yarn_projects_created_at").on(table.createdAt), index("idx_yarn_projects_user_created_at").on(table.userId, table.createdAt)]);

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  avatarUrl: text("avatar_url"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_sessions_user_id").on(table.userId), index("idx_sessions_expires_at").on(table.expiresAt)]);
