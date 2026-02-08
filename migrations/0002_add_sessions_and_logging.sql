-- Migration: Add sessions and request logging
-- This migration adds session management and request tracking

-- Sessions table - tracks all user sessions
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  metadata TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON sessions(created_at);

-- Request logs table - tracks all API requests with session ID
CREATE TABLE IF NOT EXISTS request_logs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  status_code INTEGER,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  metadata TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_request_logs_session_id ON request_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_request_logs_timestamp ON request_logs(timestamp);

-- Add vectorize_id column to repo_candidates for Vectorize integration
ALTER TABLE repo_candidates ADD COLUMN vectorize_id TEXT;

-- Add session_id to research_tasks (nullable to support existing rows)
-- Existing rows will have NULL session_id until updated
ALTER TABLE research_tasks ADD COLUMN session_id TEXT;

-- Create index for session_id on research_tasks
CREATE INDEX IF NOT EXISTS idx_research_tasks_session_id ON research_tasks(session_id);
