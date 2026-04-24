#!/usr/bin/env bash
# ensure-pg-tables.sh — Create all ArgentOS PG tables if they don't exist.
# Safe to run multiple times (uses CREATE TABLE IF NOT EXISTS).
# Does NOT rename, alter, or drop any existing tables.
# Generated from Drizzle schema via: npx drizzle-kit generate
set -euo pipefail

PG_PORT="${ARGENT_PG_PORT:-5433}"
PG_DB="${ARGENT_PG_DB:-argentos}"
CONN="postgres://localhost:${PG_PORT}/${PG_DB}"

echo "Ensuring ArgentOS PostgreSQL tables exist (port ${PG_PORT}, db ${PG_DB})..."

psql "$CONN" -v ON_ERROR_STOP=0 <<'ENDOFSQL'

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS "agents" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'active' NOT NULL,
	"config" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "auth_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"provider" text NOT NULL,
	"credential_type" text NOT NULL,
	"encrypted_payload" text NOT NULL,
	"email" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_used_at" timestamp with time zone,
	"cooldown_until" timestamp with time zone,
	"error_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "category_items" (
	"item_id" text NOT NULL,
	"category_id" text NOT NULL,
	CONSTRAINT "category_items_item_id_category_id_pk" PRIMARY KEY("item_id","category_id")
);
CREATE TABLE IF NOT EXISTS "dispatch_contract_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "dispatch_contract_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"contract_id" text NOT NULL,
	"status" text NOT NULL,
	"event_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS "dispatch_contracts" (
	"contract_id" text PRIMARY KEY NOT NULL,
	"task_id" text,
	"task" text NOT NULL,
	"target_agent_id" text NOT NULL,
	"dispatched_by" text NOT NULL,
	"tool_grant_snapshot" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"timeout_ms" integer NOT NULL,
	"heartbeat_interval_ms" integer NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"last_heartbeat_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"failure_reason" text,
	"result_summary" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS "entities" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"name" text NOT NULL,
	"entity_type" text DEFAULT 'person' NOT NULL,
	"relationship" text,
	"bond_strength" real DEFAULT 0.5 NOT NULL,
	"emotional_texture" text,
	"profile_summary" text,
	"first_mentioned_at" timestamp with time zone,
	"last_mentioned_at" timestamp with time zone,
	"memory_count" integer DEFAULT 0 NOT NULL,
	"embedding" text,
	"visibility" text DEFAULT 'private' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "item_entities" (
	"item_id" text NOT NULL,
	"entity_id" text NOT NULL,
	"role" text DEFAULT 'mentioned',
	CONSTRAINT "item_entities_item_id_entity_id_pk" PRIMARY KEY("item_id","entity_id")
);
CREATE TABLE IF NOT EXISTS "job_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"template_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"title" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"cadence_minutes" integer DEFAULT 1440 NOT NULL,
	"execution_mode" text DEFAULT 'simulate' NOT NULL,
	"deployment_stage" text,
	"promotion_state" text,
	"scope_limit" text,
	"review_required" boolean DEFAULT true NOT NULL,
	"next_run_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "job_events" (
	"id" text PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"source" text NOT NULL,
	"idempotency_key" text,
	"target_agent_id" text,
	"payload" jsonb DEFAULT '{}'::jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"outcome" text
);
CREATE TABLE IF NOT EXISTS "job_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"assignment_id" text NOT NULL,
	"template_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"task_id" text NOT NULL,
	"execution_mode" text NOT NULL,
	"deployment_stage" text,
	"review_status" text,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"status" text DEFAULT 'running' NOT NULL,
	"summary" text,
	"blockers" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
CREATE TABLE IF NOT EXISTS "job_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"department_id" text,
	"description" text,
	"role_prompt" text NOT NULL,
	"sop" text,
	"success_definition" text,
	"default_mode" text DEFAULT 'simulate' NOT NULL,
	"default_stage" text,
	"tools_allow" jsonb DEFAULT '[]'::jsonb,
	"tools_deny" jsonb DEFAULT '[]'::jsonb,
	"relationship_contract" jsonb DEFAULT '{}'::jsonb,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "knowledge_collection_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"collection_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"can_read" boolean DEFAULT true NOT NULL,
	"can_write" boolean DEFAULT false NOT NULL,
	"is_owner" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "knowledge_collections" (
	"id" text PRIMARY KEY NOT NULL,
	"collection_name" text NOT NULL,
	"collection_tag" text NOT NULL,
	"owner_agent_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "knowledge_observation_evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"observation_id" text NOT NULL,
	"stance" text NOT NULL,
	"weight" real DEFAULT 1 NOT NULL,
	"excerpt" text,
	"item_id" text,
	"lesson_id" text,
	"reflection_id" text,
	"entity_id" text,
	"source_created_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "knowledge_observations" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"kind" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text,
	"canonical_key" text NOT NULL,
	"summary" text NOT NULL,
	"detail" text,
	"confidence" real DEFAULT 0.5 NOT NULL,
	"confidence_components" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"freshness" real DEFAULT 1 NOT NULL,
	"revalidation_due_at" timestamp with time zone,
	"support_count" integer DEFAULT 0 NOT NULL,
	"source_diversity" integer DEFAULT 0 NOT NULL,
	"contradiction_weight" real DEFAULT 0 NOT NULL,
	"operator_confirmed" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"first_supported_at" timestamp with time zone,
	"last_supported_at" timestamp with time zone,
	"last_contradicted_at" timestamp with time zone,
	"supersedes_observation_id" text,
	"embedding" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "lessons" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"type" text NOT NULL,
	"context" text NOT NULL,
	"action" text NOT NULL,
	"outcome" text NOT NULL,
	"lesson" text NOT NULL,
	"correction" text,
	"confidence" real DEFAULT 0.5 NOT NULL,
	"occurrences" integer DEFAULT 1 NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"related_tools" jsonb DEFAULT '[]'::jsonb,
	"source_episode_ids" jsonb DEFAULT '[]'::jsonb,
	"embedding" text,
	"visibility" text DEFAULT 'private' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "memory_categories" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"embedding" text,
	"summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "memory_items" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"resource_id" text,
	"memory_type" text NOT NULL,
	"summary" text NOT NULL,
	"embedding" text,
	"happened_at" timestamp with time zone,
	"content_hash" text,
	"reinforcement_count" integer DEFAULT 1 NOT NULL,
	"last_reinforced_at" timestamp with time zone,
	"extra" jsonb DEFAULT '{}'::jsonb,
	"emotional_valence" real DEFAULT 0 NOT NULL,
	"emotional_arousal" real DEFAULT 0 NOT NULL,
	"mood_at_capture" text,
	"significance" text DEFAULT 'routine' NOT NULL,
	"reflection" text,
	"lesson" text,
	"visibility" text DEFAULT 'private' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "model_feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"tier" text NOT NULL,
	"session_type" text NOT NULL,
	"complexity_score" real DEFAULT 0 NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"success" boolean DEFAULT true NOT NULL,
	"error_type" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"tool_call_count" integer DEFAULT 0 NOT NULL,
	"user_feedback" text,
	"session_key" text,
	"profile" text,
	"self_eval_score" real,
	"self_eval_reasoning" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "observations" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "observations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"session_id" text NOT NULL,
	"agent_id" text,
	"type" text DEFAULT 'tool_result' NOT NULL,
	"tool_name" text,
	"input" text,
	"output" text,
	"summary" text,
	"channel_id" text,
	"importance" integer DEFAULT 5 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "reflections" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"trigger_type" text NOT NULL,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"content" text NOT NULL,
	"lessons_extracted" jsonb DEFAULT '[]'::jsonb,
	"entities_involved" jsonb DEFAULT '[]'::jsonb,
	"self_insights" jsonb DEFAULT '[]'::jsonb,
	"mood" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "resources" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"url" text DEFAULT '' NOT NULL,
	"modality" text DEFAULT 'text' NOT NULL,
	"local_path" text,
	"caption" text,
	"embedding" text,
	"visibility" text DEFAULT 'private' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "service_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"variable" text NOT NULL,
	"name" text NOT NULL,
	"encrypted_value" text NOT NULL,
	"service" text,
	"category" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"source" text DEFAULT 'manual',
	"allowed_roles" text[] DEFAULT '{}'::text[] NOT NULL,
	"allowed_agents" text[] DEFAULT '{}'::text[] NOT NULL,
	"allowed_teams" text[] DEFAULT '{}'::text[] NOT NULL,
	"deny_all" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"session_key" text NOT NULL,
	"channel_id" text,
	"status" text DEFAULT 'active' NOT NULL,
	"project_path" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"message_count" integer DEFAULT 0 NOT NULL,
	"token_count" integer DEFAULT 0,
	"summary" text,
	"metadata" jsonb DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS "shared_knowledge" (
	"id" text PRIMARY KEY NOT NULL,
	"source_agent_id" text NOT NULL,
	"source_item_id" text,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"embedding" text,
	"confidence" real DEFAULT 0.5 NOT NULL,
	"endorsements" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"source" text DEFAULT 'user' NOT NULL,
	"assignee" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"due_at" timestamp with time zone,
	"session_id" text,
	"channel_id" text,
	"parent_task_id" text,
	"depends_on" jsonb DEFAULT '[]'::jsonb,
	"team_id" text,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"job_assignment_id" text,
	"job_template_id" text
);
CREATE TABLE IF NOT EXISTS "team_members" (
	"team_id" text NOT NULL,
	"session_key" text NOT NULL,
	"role" text DEFAULT 'worker' NOT NULL,
	"label" text,
	"status" text DEFAULT 'active' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_active_at" timestamp with time zone,
	CONSTRAINT "team_members_team_id_session_key_pk" PRIMARY KEY("team_id","session_key")
);
CREATE TABLE IF NOT EXISTS "teams" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"lead_session_key" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"config" jsonb
);
CREATE TABLE IF NOT EXISTS "workflow_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"workflow_version" integer NOT NULL,
	"status" text DEFAULT 'created',
	"trigger_type" text NOT NULL,
	"trigger_payload" jsonb,
	"current_node_id" text,
	"variables" jsonb DEFAULT '{}'::jsonb,
	"total_tokens_used" integer DEFAULT 0,
	"total_cost_usd" numeric(10, 4) DEFAULT '0',
	"started_at" timestamp with time zone DEFAULT now(),
	"ended_at" timestamp with time zone,
	"error" text,
	"metadata" jsonb DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS "workflow_step_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"node_id" text NOT NULL,
	"node_kind" text NOT NULL,
	"status" text DEFAULT 'pending',
	"agent_id" text,
	"task_id" text,
	"idempotency_key" text,
	"input_context" jsonb,
	"output_items" jsonb,
	"variables_set" jsonb DEFAULT '{}'::jsonb,
	"tokens_used" integer DEFAULT 0,
	"cost_usd" numeric(10, 4) DEFAULT '0',
	"model_used" text,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"duration_ms" integer,
	"retry_count" integer DEFAULT 0,
	"error" text,
	"approval_status" text,
	"approved_by" text,
	"approval_note" text,
	"edited_output" jsonb
);
CREATE TABLE IF NOT EXISTS "workflow_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"version" integer NOT NULL,
	"nodes" jsonb NOT NULL,
	"edges" jsonb NOT NULL,
	"canvas_layout" jsonb,
	"changed_by" text,
	"change_summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "workflows" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"owner_agent_id" text DEFAULT 'argent',
	"department_id" text,
	"version" integer DEFAULT 1,
	"is_active" boolean DEFAULT true,
	"nodes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"edges" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"canvas_layout" jsonb DEFAULT '{}'::jsonb,
	"default_on_error" jsonb DEFAULT '{"strategy":"fail","notifyOnError":true}'::jsonb,
	"error_workflow_id" text,
	"max_run_duration_ms" integer DEFAULT 3600000,
	"max_run_cost_usd" numeric(10, 4),
	"monthly_budget_usd" numeric(10, 4),
	"trigger_type" text,
	"trigger_config" jsonb,
	"next_fire_at" timestamp with time zone,
	"deployment_stage" text DEFAULT 'live',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "category_items" ADD CONSTRAINT "category_items_item_id_memory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."memory_items"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "category_items" ADD CONSTRAINT "category_items_category_id_memory_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."memory_categories"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "dispatch_contract_events" ADD CONSTRAINT "dispatch_contract_events_contract_id_dispatch_contracts_contract_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."dispatch_contracts"("contract_id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "entities" ADD CONSTRAINT "entities_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "item_entities" ADD CONSTRAINT "item_entities_item_id_memory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."memory_items"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "item_entities" ADD CONSTRAINT "item_entities_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "job_assignments" ADD CONSTRAINT "job_assignments_template_id_job_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."job_templates"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "job_runs" ADD CONSTRAINT "job_runs_assignment_id_job_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."job_assignments"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "job_runs" ADD CONSTRAINT "job_runs_template_id_job_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."job_templates"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "job_runs" ADD CONSTRAINT "job_runs_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "knowledge_collection_grants" ADD CONSTRAINT "knowledge_collection_grants_collection_id_knowledge_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."knowledge_collections"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "knowledge_observation_evidence" ADD CONSTRAINT "knowledge_observation_evidence_observation_id_knowledge_observations_id_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."knowledge_observations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "knowledge_observation_evidence" ADD CONSTRAINT "knowledge_observation_evidence_item_id_memory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."memory_items"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "knowledge_observation_evidence" ADD CONSTRAINT "knowledge_observation_evidence_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "knowledge_observation_evidence" ADD CONSTRAINT "knowledge_observation_evidence_reflection_id_reflections_id_fk" FOREIGN KEY ("reflection_id") REFERENCES "public"."reflections"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "knowledge_observation_evidence" ADD CONSTRAINT "knowledge_observation_evidence_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "knowledge_observations" ADD CONSTRAINT "knowledge_observations_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "knowledge_observations" ADD CONSTRAINT "knowledge_observations_supersedes_observation_id_knowledge_observations_id_fk" FOREIGN KEY ("supersedes_observation_id") REFERENCES "public"."knowledge_observations"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "memory_categories" ADD CONSTRAINT "memory_categories_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "memory_items" ADD CONSTRAINT "memory_items_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "memory_items" ADD CONSTRAINT "memory_items_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "model_feedback" ADD CONSTRAINT "model_feedback_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "observations" ADD CONSTRAINT "observations_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "observations" ADD CONSTRAINT "observations_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "reflections" ADD CONSTRAINT "reflections_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "resources" ADD CONSTRAINT "resources_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "shared_knowledge" ADD CONSTRAINT "shared_knowledge_source_agent_id_agents_id_fk" FOREIGN KEY ("source_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "shared_knowledge" ADD CONSTRAINT "shared_knowledge_source_item_id_memory_items_id_fk" FOREIGN KEY ("source_item_id") REFERENCES "public"."memory_items"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "workflow_step_runs" ADD CONSTRAINT "workflow_step_runs_run_id_workflow_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "idx_agents_status" ON "agents" USING btree ("status");
CREATE UNIQUE INDEX "idx_auth_credentials_profile" ON "auth_credentials" USING btree ("profile_id");
CREATE INDEX "idx_auth_credentials_provider" ON "auth_credentials" USING btree ("provider");
CREATE INDEX "idx_auth_credentials_type" ON "auth_credentials" USING btree ("credential_type");
CREATE INDEX "idx_auth_credentials_enabled" ON "auth_credentials" USING btree ("enabled");
CREATE INDEX "idx_dispatch_contract_events_contract" ON "dispatch_contract_events" USING btree ("contract_id");
CREATE INDEX "idx_dispatch_contract_events_time" ON "dispatch_contract_events" USING btree ("event_at");
CREATE INDEX "idx_dispatch_contracts_status" ON "dispatch_contracts" USING btree ("status");
CREATE INDEX "idx_dispatch_contracts_target_agent" ON "dispatch_contracts" USING btree ("target_agent_id");
CREATE INDEX "idx_dispatch_contracts_task" ON "dispatch_contracts" USING btree ("task_id");
CREATE INDEX "idx_dispatch_contracts_created" ON "dispatch_contracts" USING btree ("created_at");
CREATE UNIQUE INDEX "idx_entities_agent_name" ON "entities" USING btree ("agent_id","name");
CREATE INDEX "idx_entities_type" ON "entities" USING btree ("entity_type");
CREATE INDEX "idx_entities_bond" ON "entities" USING btree ("bond_strength");
CREATE INDEX "idx_entities_agent" ON "entities" USING btree ("agent_id");
CREATE INDEX "idx_item_entities_entity" ON "item_entities" USING btree ("entity_id");
CREATE INDEX "idx_job_assignments_agent" ON "job_assignments" USING btree ("agent_id");
CREATE INDEX "idx_job_assignments_next_run" ON "job_assignments" USING btree ("next_run_at");
CREATE UNIQUE INDEX "idx_job_events_idempotency_key" ON "job_events" USING btree ("idempotency_key");
CREATE INDEX "idx_job_events_unprocessed" ON "job_events" USING btree ("processed_at","created_at");
CREATE INDEX "idx_job_runs_assignment" ON "job_runs" USING btree ("assignment_id");
CREATE INDEX "idx_job_runs_task" ON "job_runs" USING btree ("task_id");
CREATE INDEX "idx_job_templates_name" ON "job_templates" USING btree ("name");
CREATE UNIQUE INDEX "idx_knowledge_collection_grants_unique" ON "knowledge_collection_grants" USING btree ("collection_id","agent_id");
CREATE INDEX "idx_knowledge_collection_grants_agent" ON "knowledge_collection_grants" USING btree ("agent_id");
CREATE INDEX "idx_knowledge_collection_grants_collection" ON "knowledge_collection_grants" USING btree ("collection_id");
CREATE UNIQUE INDEX "idx_knowledge_collections_tag" ON "knowledge_collections" USING btree ("collection_tag");
CREATE INDEX "idx_knowledge_collections_owner" ON "knowledge_collections" USING btree ("owner_agent_id");
CREATE INDEX "idx_knowledge_obs_evidence_observation" ON "knowledge_observation_evidence" USING btree ("observation_id");
CREATE INDEX "idx_knowledge_obs_evidence_stance" ON "knowledge_observation_evidence" USING btree ("stance");
CREATE INDEX "idx_knowledge_obs_evidence_item" ON "knowledge_observation_evidence" USING btree ("item_id");
CREATE INDEX "idx_knowledge_obs_evidence_lesson" ON "knowledge_observation_evidence" USING btree ("lesson_id");
CREATE INDEX "idx_knowledge_obs_evidence_reflection" ON "knowledge_observation_evidence" USING btree ("reflection_id");
CREATE INDEX "idx_knowledge_obs_evidence_entity" ON "knowledge_observation_evidence" USING btree ("entity_id");
CREATE INDEX "idx_knowledge_obs_agent_kind_status" ON "knowledge_observations" USING btree ("agent_id","kind","status");
CREATE INDEX "idx_knowledge_obs_agent_subject_status" ON "knowledge_observations" USING btree ("agent_id","subject_type","subject_id","status");
CREATE INDEX "idx_knowledge_obs_agent_canonical" ON "knowledge_observations" USING btree ("agent_id","canonical_key");
CREATE INDEX "idx_knowledge_obs_agent_revalidation_due" ON "knowledge_observations" USING btree ("agent_id","revalidation_due_at");
CREATE INDEX "idx_knowledge_obs_agent_last_supported" ON "knowledge_observations" USING btree ("agent_id","last_supported_at");
CREATE INDEX "idx_knowledge_obs_visibility" ON "knowledge_observations" USING btree ("visibility");
CREATE INDEX "idx_lessons_agent" ON "lessons" USING btree ("agent_id");
CREATE INDEX "idx_lessons_type" ON "lessons" USING btree ("type");
CREATE INDEX "idx_lessons_confidence" ON "lessons" USING btree ("confidence");
CREATE INDEX "idx_lessons_created" ON "lessons" USING btree ("created_at");
CREATE INDEX "idx_lessons_last_seen" ON "lessons" USING btree ("last_seen");
CREATE UNIQUE INDEX "idx_categories_agent_name" ON "memory_categories" USING btree ("agent_id","name");
CREATE INDEX "idx_categories_agent" ON "memory_categories" USING btree ("agent_id");
CREATE INDEX "idx_items_agent" ON "memory_items" USING btree ("agent_id");
CREATE INDEX "idx_items_resource" ON "memory_items" USING btree ("resource_id");
CREATE INDEX "idx_items_type" ON "memory_items" USING btree ("memory_type");
CREATE INDEX "idx_items_hash" ON "memory_items" USING btree ("content_hash");
CREATE INDEX "idx_items_created" ON "memory_items" USING btree ("created_at");
CREATE INDEX "idx_items_reinforced" ON "memory_items" USING btree ("last_reinforced_at");
CREATE INDEX "idx_items_significance" ON "memory_items" USING btree ("significance");
CREATE INDEX "idx_items_visibility" ON "memory_items" USING btree ("visibility");
CREATE TABLE IF NOT EXISTS "personal_skill_candidates" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"operator_id" text,
	"profile_id" text,
	"scope" text DEFAULT 'operator' NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"trigger_patterns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"procedure_outline" text,
	"preconditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"execution_steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expected_outcomes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"related_tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_memory_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_episode_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_task_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_lesson_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"supersedes_candidate_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"superseded_by_candidate_id" text,
	"conflicts_with_candidate_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"contradiction_count" integer DEFAULT 0 NOT NULL,
	"evidence_count" integer DEFAULT 0 NOT NULL,
	"recurrence_count" integer DEFAULT 1 NOT NULL,
	"confidence" real DEFAULT 0.5 NOT NULL,
	"strength" real DEFAULT 0.5 NOT NULL,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"success_count" integer DEFAULT 0 NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"state" text DEFAULT 'candidate' NOT NULL,
	"operator_notes" text,
	"last_reviewed_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"last_reinforced_at" timestamp with time zone,
	"last_contradicted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "personal_skill_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"candidate_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"actor_type" text NOT NULL,
	"action" text NOT NULL,
	"reason" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "personal_skill_candidates"
  ADD COLUMN IF NOT EXISTS "scope" text DEFAULT 'operator' NOT NULL,
  ADD COLUMN IF NOT EXISTS "preconditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "execution_steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "expected_outcomes" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "supersedes_candidate_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "superseded_by_candidate_id" text,
  ADD COLUMN IF NOT EXISTS "conflicts_with_candidate_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "contradiction_count" integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS "strength" real DEFAULT 0.5 NOT NULL,
  ADD COLUMN IF NOT EXISTS "usage_count" integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS "success_count" integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS "failure_count" integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS "last_reinforced_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "last_contradicted_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "operator_notes" text;
CREATE INDEX "idx_personal_skill_candidates_agent" ON "personal_skill_candidates" USING btree ("agent_id");
CREATE INDEX "idx_personal_skill_candidates_state" ON "personal_skill_candidates" USING btree ("state");
CREATE INDEX "idx_personal_skill_candidates_scope" ON "personal_skill_candidates" USING btree ("scope");
CREATE INDEX "idx_personal_skill_candidates_confidence" ON "personal_skill_candidates" USING btree ("confidence");
CREATE INDEX "idx_personal_skill_candidates_updated" ON "personal_skill_candidates" USING btree ("updated_at");
CREATE INDEX "idx_personal_skill_reviews_candidate" ON "personal_skill_reviews" USING btree ("candidate_id","created_at");
CREATE INDEX "idx_personal_skill_reviews_agent" ON "personal_skill_reviews" USING btree ("agent_id","created_at");
CREATE INDEX "idx_mf_agent" ON "model_feedback" USING btree ("agent_id");
CREATE INDEX "idx_mf_provider_model" ON "model_feedback" USING btree ("provider","model");
CREATE INDEX "idx_mf_tier" ON "model_feedback" USING btree ("tier");
CREATE INDEX "idx_mf_session_type" ON "model_feedback" USING btree ("session_type");
CREATE INDEX "idx_mf_created" ON "model_feedback" USING btree ("created_at");
CREATE INDEX "idx_mf_success" ON "model_feedback" USING btree ("success");
CREATE INDEX "idx_observations_session" ON "observations" USING btree ("session_id");
CREATE INDEX "idx_observations_agent" ON "observations" USING btree ("agent_id");
CREATE INDEX "idx_observations_type" ON "observations" USING btree ("type");
CREATE INDEX "idx_observations_created" ON "observations" USING btree ("created_at");
CREATE INDEX "idx_observations_importance" ON "observations" USING btree ("importance");
CREATE INDEX "idx_reflections_agent" ON "reflections" USING btree ("agent_id");
CREATE INDEX "idx_reflections_trigger" ON "reflections" USING btree ("trigger_type");
CREATE INDEX "idx_reflections_created" ON "reflections" USING btree ("created_at");
CREATE INDEX "idx_resources_url" ON "resources" USING btree ("url");
CREATE INDEX "idx_resources_agent" ON "resources" USING btree ("agent_id");
CREATE INDEX "idx_resources_created" ON "resources" USING btree ("created_at");
CREATE UNIQUE INDEX "idx_service_keys_variable" ON "service_keys" USING btree ("variable");
CREATE INDEX "idx_service_keys_category" ON "service_keys" USING btree ("category");
CREATE INDEX "idx_service_keys_enabled" ON "service_keys" USING btree ("enabled");
CREATE UNIQUE INDEX "idx_sessions_key" ON "sessions" USING btree ("session_key");
CREATE INDEX "idx_sessions_agent" ON "sessions" USING btree ("agent_id");
CREATE INDEX "idx_sessions_status" ON "sessions" USING btree ("status");
CREATE INDEX "idx_sessions_started" ON "sessions" USING btree ("started_at");
CREATE INDEX "idx_shared_knowledge_agent" ON "shared_knowledge" USING btree ("source_agent_id");
CREATE INDEX "idx_shared_knowledge_category" ON "shared_knowledge" USING btree ("category");
CREATE INDEX "idx_shared_knowledge_confidence" ON "shared_knowledge" USING btree ("confidence");
CREATE INDEX "idx_tasks_status" ON "tasks" USING btree ("status");
CREATE INDEX "idx_tasks_priority" ON "tasks" USING btree ("priority");
CREATE INDEX "idx_tasks_agent" ON "tasks" USING btree ("agent_id");
CREATE INDEX "idx_tasks_due" ON "tasks" USING btree ("due_at");
CREATE INDEX "idx_tasks_team" ON "tasks" USING btree ("team_id");
CREATE INDEX "idx_tasks_job_assignment" ON "tasks" USING btree ("job_assignment_id");
CREATE INDEX "idx_tasks_job_template" ON "tasks" USING btree ("job_template_id");
CREATE INDEX "idx_team_members_session" ON "team_members" USING btree ("session_key");
CREATE INDEX "idx_teams_status" ON "teams" USING btree ("status");
CREATE INDEX "idx_wfruns_workflow" ON "workflow_runs" USING btree ("workflow_id");
CREATE INDEX "idx_wfruns_status" ON "workflow_runs" USING btree ("status");
CREATE INDEX "idx_wfruns_started" ON "workflow_runs" USING btree ("started_at");
CREATE INDEX "idx_stepruns_run" ON "workflow_step_runs" USING btree ("run_id");
CREATE INDEX "idx_stepruns_status" ON "workflow_step_runs" USING btree ("status");
CREATE UNIQUE INDEX "idx_stepruns_idempotency" ON "workflow_step_runs" USING btree ("idempotency_key");
CREATE UNIQUE INDEX "idx_workflow_versions_unique" ON "workflow_versions" USING btree ("workflow_id","version");
CREATE INDEX "idx_workflow_versions_workflow" ON "workflow_versions" USING btree ("workflow_id");
CREATE INDEX "idx_workflows_trigger" ON "workflows" USING btree ("trigger_type");
CREATE INDEX "idx_workflows_owner" ON "workflows" USING btree ("owner_agent_id");
CREATE INDEX "idx_workflows_active" ON "workflows" USING btree ("is_active");
ENDOFSQL

echo "Done. All tables ensured."
