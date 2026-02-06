import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

/**
 * Sessions table - tracks all user sessions
 */
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
  metadata: text('metadata'), // JSON string for additional session data
}, (table) => ({
  createdAtIdx: index('idx_sessions_created_at').on(table.createdAt),
}));

/**
 * Research tasks table tracks all research queries and their lifecycle
 */
export const researchTasks = sqliteTable('research_tasks', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  query: text('query').notNull(),
  status: text('status').notNull().default('pending'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  statusIdx: index('idx_research_tasks_status').on(table.status),
  sessionIdIdx: index('idx_research_tasks_session_id').on(table.sessionId),
}));

/**
 * Repo candidates stores search results pending user approval
 */
export const repoCandidates = sqliteTable('repo_candidates', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull().references(() => researchTasks.id, { onDelete: 'cascade' }),
  fullName: text('full_name').notNull(),
  url: text('url').notNull(),
  stars: integer('stars').default(0),
  description: text('description'),
  isSelected: integer('is_selected').default(0),
  vectorizeId: text('vectorize_id'), // Reference to Vectorize index entry
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  taskIdIdx: index('idx_repo_candidates_task_id').on(table.taskId),
  selectedIdx: index('idx_repo_candidates_selected').on(table.taskId, table.isSelected),
}));

/**
 * Analysis results stores final analysis for approved repositories
 */
export const analysisResults = sqliteTable('analysis_results', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull().references(() => researchTasks.id, { onDelete: 'cascade' }),
  repoId: text('repo_id').notNull().references(() => repoCandidates.id, { onDelete: 'cascade' }),
  summary: text('summary'),
  findingsJson: text('findings_json'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  taskIdIdx: index('idx_analysis_results_task_id').on(table.taskId),
}));

/**
 * Request logs - tracks all API requests with session ID
 */
export const requestLogs = sqliteTable('request_logs', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  method: text('method').notNull(),
  path: text('path').notNull(),
  statusCode: integer('status_code'),
  timestamp: text('timestamp').notNull().default(sql`(datetime('now'))`),
  metadata: text('metadata'), // JSON string for request/response details
}, (table) => ({
  sessionIdIdx: index('idx_request_logs_session_id').on(table.sessionId),
  timestampIdx: index('idx_request_logs_timestamp').on(table.timestamp),
}));
