-- Migration: Create research tables for Human-in-the-Loop workflow
-- This migration sets up the D1 schema for the multi-agent research system

-- Research tasks table tracks all research queries and their lifecycle
CREATE TABLE IF NOT EXISTS research_tasks (
  id TEXT PRIMARY KEY,
  query TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Repo candidates stores search results pending user approval
CREATE TABLE IF NOT EXISTS repo_candidates (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  full_name TEXT NOT NULL,
  url TEXT NOT NULL,
  stars INTEGER DEFAULT 0,
  description TEXT,
  is_selected INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (task_id) REFERENCES research_tasks(id) ON DELETE CASCADE
);

-- Analysis results stores final analysis for approved repositories
CREATE TABLE IF NOT EXISTS analysis_results (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  repo_id TEXT NOT NULL,
  summary TEXT,
  findings_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (task_id) REFERENCES research_tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (repo_id) REFERENCES repo_candidates(id) ON DELETE CASCADE
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_research_tasks_status ON research_tasks(status);
CREATE INDEX IF NOT EXISTS idx_repo_candidates_task_id ON repo_candidates(task_id);
CREATE INDEX IF NOT EXISTS idx_repo_candidates_selected ON repo_candidates(task_id, is_selected);
CREATE INDEX IF NOT EXISTS idx_analysis_results_task_id ON analysis_results(task_id);
