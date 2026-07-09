/**
 * GENERATED FILE — do not edit by hand.
 * Full PostgreSQL schema for a fresh ArgentOS database, applied by
 * PgAdapter.init() only when the database has no core tables yet.
 * Regenerate with scripts/generate-pg-bootstrap.ts (see its header).
 */
export const PG_BOOTSTRAP_SCHEMA_SQL = `
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;
CREATE TABLE public.agents (
    id text NOT NULL,
    name text NOT NULL,
    role text,
    status text DEFAULT 'active'::text NOT NULL,
    config jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.appforge_bases (
    id text NOT NULL,
    app_id text NOT NULL,
    name text NOT NULL,
    description text,
    active_table_id text,
    revision integer DEFAULT 0 NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.appforge_idempotency_keys (
    idempotency_key text NOT NULL,
    operation text NOT NULL,
    resource_type text NOT NULL,
    resource_id text NOT NULL,
    response jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.appforge_records (
    id text NOT NULL,
    base_id text NOT NULL,
    table_id text NOT NULL,
    "values" jsonb DEFAULT '{}'::jsonb NOT NULL,
    revision integer DEFAULT 0 NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.appforge_tables (
    id text NOT NULL,
    base_id text NOT NULL,
    name text NOT NULL,
    fields jsonb DEFAULT '[]'::jsonb NOT NULL,
    revision integer DEFAULT 0 NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.auth_credentials (
    id text NOT NULL,
    profile_id text NOT NULL,
    provider text NOT NULL,
    credential_type text NOT NULL,
    encrypted_payload text NOT NULL,
    email text,
    enabled boolean DEFAULT true NOT NULL,
    last_used_at timestamp with time zone,
    cooldown_until timestamp with time zone,
    error_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.category_items (
    item_id text NOT NULL,
    category_id text NOT NULL
);
CREATE TABLE public.dispatch_contract_events (
    id bigint NOT NULL,
    contract_id text NOT NULL,
    status text NOT NULL,
    event_at timestamp with time zone DEFAULT now() NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL
);
ALTER TABLE public.dispatch_contract_events ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.dispatch_contract_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
CREATE TABLE public.dispatch_contracts (
    contract_id text NOT NULL,
    task_id text,
    task text NOT NULL,
    target_agent_id text NOT NULL,
    dispatched_by text NOT NULL,
    tool_grant_snapshot jsonb DEFAULT '[]'::jsonb NOT NULL,
    timeout_ms integer NOT NULL,
    heartbeat_interval_ms integer NOT NULL,
    status text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    accepted_at timestamp with time zone,
    started_at timestamp with time zone,
    last_heartbeat_at timestamp with time zone,
    completed_at timestamp with time zone,
    failed_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    failure_reason text,
    result_summary text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL
);
CREATE TABLE public.entities (
    id text NOT NULL,
    agent_id text NOT NULL,
    name text NOT NULL,
    entity_type text DEFAULT 'person'::text NOT NULL,
    relationship text,
    bond_strength real DEFAULT 0.5 NOT NULL,
    emotional_texture text,
    profile_summary text,
    first_mentioned_at timestamp with time zone,
    last_mentioned_at timestamp with time zone,
    memory_count integer DEFAULT 0 NOT NULL,
    embedding public.vector(768),
    visibility text DEFAULT 'private'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.item_entities (
    item_id text NOT NULL,
    entity_id text NOT NULL,
    role text DEFAULT 'mentioned'::text
);
CREATE TABLE public.job_assignments (
    id text NOT NULL,
    template_id text NOT NULL,
    agent_id text NOT NULL,
    title text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    cadence_minutes integer DEFAULT 1440 NOT NULL,
    execution_mode text DEFAULT 'simulate'::text NOT NULL,
    deployment_stage text,
    promotion_state text,
    scope_limit text,
    review_required boolean DEFAULT true NOT NULL,
    next_run_at timestamp with time zone,
    last_run_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.job_events (
    id text NOT NULL,
    event_type text NOT NULL,
    source text NOT NULL,
    idempotency_key text,
    target_agent_id text,
    payload jsonb DEFAULT '{}'::jsonb,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    processed_at timestamp with time zone,
    outcome text
);
CREATE TABLE public.job_runs (
    id text NOT NULL,
    assignment_id text NOT NULL,
    template_id text NOT NULL,
    agent_id text NOT NULL,
    task_id text NOT NULL,
    execution_mode text NOT NULL,
    deployment_stage text,
    review_status text,
    reviewed_by text,
    reviewed_at timestamp with time zone,
    status text DEFAULT 'running'::text NOT NULL,
    summary text,
    blockers text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    ended_at timestamp with time zone
);
CREATE TABLE public.job_templates (
    id text NOT NULL,
    name text NOT NULL,
    department_id text,
    description text,
    role_prompt text NOT NULL,
    sop text,
    success_definition text,
    default_mode text DEFAULT 'simulate'::text NOT NULL,
    default_stage text,
    tools_allow jsonb DEFAULT '[]'::jsonb,
    tools_deny jsonb DEFAULT '[]'::jsonb,
    relationship_contract jsonb DEFAULT '{}'::jsonb,
    tags jsonb DEFAULT '[]'::jsonb,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.knowledge_collection_grants (
    id text NOT NULL,
    collection_id text NOT NULL,
    agent_id text NOT NULL,
    can_read boolean DEFAULT true NOT NULL,
    can_write boolean DEFAULT false NOT NULL,
    is_owner boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.knowledge_collections (
    id text NOT NULL,
    collection_name text NOT NULL,
    collection_tag text NOT NULL,
    owner_agent_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.knowledge_observation_evidence (
    id text NOT NULL,
    observation_id text NOT NULL,
    stance text NOT NULL,
    weight real DEFAULT 1 NOT NULL,
    excerpt text,
    item_id text,
    lesson_id text,
    reflection_id text,
    entity_id text,
    source_created_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.knowledge_observations (
    id text NOT NULL,
    agent_id text NOT NULL,
    kind text NOT NULL,
    subject_type text NOT NULL,
    subject_id text,
    canonical_key text NOT NULL,
    summary text NOT NULL,
    detail text,
    confidence real DEFAULT 0.5 NOT NULL,
    confidence_components jsonb DEFAULT '{}'::jsonb NOT NULL,
    freshness real DEFAULT 1 NOT NULL,
    revalidation_due_at timestamp with time zone,
    support_count integer DEFAULT 0 NOT NULL,
    source_diversity integer DEFAULT 0 NOT NULL,
    contradiction_weight real DEFAULT 0 NOT NULL,
    operator_confirmed boolean DEFAULT false NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    first_supported_at timestamp with time zone,
    last_supported_at timestamp with time zone,
    last_contradicted_at timestamp with time zone,
    supersedes_observation_id text,
    embedding text,
    tags jsonb DEFAULT '[]'::jsonb NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    visibility text DEFAULT 'private'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.lessons (
    id text NOT NULL,
    agent_id text NOT NULL,
    type text NOT NULL,
    context text NOT NULL,
    action text NOT NULL,
    outcome text NOT NULL,
    lesson text NOT NULL,
    correction text,
    confidence real DEFAULT 0.5 NOT NULL,
    occurrences integer DEFAULT 1 NOT NULL,
    last_seen timestamp with time zone DEFAULT now() NOT NULL,
    tags jsonb DEFAULT '[]'::jsonb,
    related_tools jsonb DEFAULT '[]'::jsonb,
    source_episode_ids jsonb DEFAULT '[]'::jsonb,
    embedding public.vector(768),
    visibility text DEFAULT 'private'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.memory_categories (
    id text NOT NULL,
    agent_id text NOT NULL,
    name text NOT NULL,
    description text,
    embedding public.vector(768),
    summary text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.memory_items (
    id text NOT NULL,
    agent_id text NOT NULL,
    resource_id text,
    memory_type text NOT NULL,
    summary text NOT NULL,
    embedding public.vector(768),
    happened_at timestamp with time zone,
    content_hash text,
    reinforcement_count integer DEFAULT 1 NOT NULL,
    last_reinforced_at timestamp with time zone,
    extra jsonb DEFAULT '{}'::jsonb,
    emotional_valence real DEFAULT 0 NOT NULL,
    emotional_arousal real DEFAULT 0 NOT NULL,
    mood_at_capture text,
    significance text DEFAULT 'routine'::text NOT NULL,
    reflection text,
    lesson text,
    visibility text DEFAULT 'private'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.model_feedback (
    id text NOT NULL,
    agent_id text NOT NULL,
    provider text NOT NULL,
    model text NOT NULL,
    tier text NOT NULL,
    session_type text NOT NULL,
    complexity_score real DEFAULT 0 NOT NULL,
    duration_ms integer DEFAULT 0 NOT NULL,
    success boolean DEFAULT true NOT NULL,
    error_type text,
    input_tokens integer DEFAULT 0 NOT NULL,
    output_tokens integer DEFAULT 0 NOT NULL,
    total_tokens integer DEFAULT 0 NOT NULL,
    tool_call_count integer DEFAULT 0 NOT NULL,
    user_feedback text,
    session_key text,
    profile text,
    self_eval_score real,
    self_eval_reasoning text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.observations (
    id bigint NOT NULL,
    session_id text NOT NULL,
    agent_id text,
    type text DEFAULT 'tool_result'::text NOT NULL,
    tool_name text,
    input text,
    output text,
    summary text,
    channel_id text,
    importance integer DEFAULT 5 NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public.observations ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.observations_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
CREATE TABLE public.personal_skill_candidates (
    id text NOT NULL,
    agent_id text NOT NULL,
    operator_id text,
    profile_id text,
    scope text DEFAULT 'operator'::text NOT NULL,
    title text NOT NULL,
    summary text NOT NULL,
    trigger_patterns jsonb DEFAULT '[]'::jsonb NOT NULL,
    procedure_outline text,
    preconditions jsonb DEFAULT '[]'::jsonb NOT NULL,
    execution_steps jsonb DEFAULT '[]'::jsonb NOT NULL,
    expected_outcomes jsonb DEFAULT '[]'::jsonb NOT NULL,
    related_tools jsonb DEFAULT '[]'::jsonb NOT NULL,
    source_memory_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    source_episode_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    source_task_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    source_lesson_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    supersedes_candidate_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    superseded_by_candidate_id text,
    conflicts_with_candidate_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    contradiction_count integer DEFAULT 0 NOT NULL,
    evidence_count integer DEFAULT 0 NOT NULL,
    recurrence_count integer DEFAULT 1 NOT NULL,
    confidence real DEFAULT 0.5 NOT NULL,
    strength real DEFAULT 0.5 NOT NULL,
    usage_count integer DEFAULT 0 NOT NULL,
    success_count integer DEFAULT 0 NOT NULL,
    failure_count integer DEFAULT 0 NOT NULL,
    state text DEFAULT 'candidate'::text NOT NULL,
    operator_notes text,
    last_reviewed_at timestamp with time zone,
    last_used_at timestamp with time zone,
    last_reinforced_at timestamp with time zone,
    last_contradicted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.personal_skill_reviews (
    id text NOT NULL,
    candidate_id text NOT NULL,
    agent_id text NOT NULL,
    actor_type text NOT NULL,
    action text NOT NULL,
    reason text,
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.reflections (
    id text NOT NULL,
    agent_id text NOT NULL,
    trigger_type text NOT NULL,
    period_start timestamp with time zone,
    period_end timestamp with time zone,
    content text NOT NULL,
    lessons_extracted jsonb DEFAULT '[]'::jsonb,
    entities_involved jsonb DEFAULT '[]'::jsonb,
    self_insights jsonb DEFAULT '[]'::jsonb,
    mood text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.resources (
    id text NOT NULL,
    agent_id text NOT NULL,
    url text DEFAULT ''::text NOT NULL,
    modality text DEFAULT 'text'::text NOT NULL,
    local_path text,
    caption text,
    embedding public.vector(768),
    visibility text DEFAULT 'private'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.service_keys (
    id text NOT NULL,
    variable text NOT NULL,
    name text NOT NULL,
    encrypted_value text NOT NULL,
    service text,
    category text,
    enabled boolean DEFAULT true NOT NULL,
    source text DEFAULT 'manual'::text,
    allowed_roles text[] DEFAULT '{}'::text[] NOT NULL,
    allowed_agents text[] DEFAULT '{}'::text[] NOT NULL,
    allowed_teams text[] DEFAULT '{}'::text[] NOT NULL,
    deny_all boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.sessions (
    id text NOT NULL,
    agent_id text NOT NULL,
    session_key text NOT NULL,
    channel_id text,
    status text DEFAULT 'active'::text NOT NULL,
    project_path text,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    last_activity_at timestamp with time zone DEFAULT now() NOT NULL,
    ended_at timestamp with time zone,
    message_count integer DEFAULT 0 NOT NULL,
    token_count integer DEFAULT 0,
    summary text,
    metadata jsonb DEFAULT '{}'::jsonb
);
CREATE TABLE public.shared_knowledge (
    id text NOT NULL,
    source_agent_id text NOT NULL,
    source_item_id text,
    category text NOT NULL,
    title text NOT NULL,
    content text NOT NULL,
    embedding public.vector(768),
    confidence real DEFAULT 0.5 NOT NULL,
    endorsements integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.tasks (
    id text NOT NULL,
    agent_id text,
    title text NOT NULL,
    description text,
    status text DEFAULT 'pending'::text NOT NULL,
    priority text DEFAULT 'normal'::text NOT NULL,
    source text DEFAULT 'user'::text NOT NULL,
    assignee text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    due_at timestamp with time zone,
    session_id text,
    channel_id text,
    parent_task_id text,
    depends_on jsonb DEFAULT '[]'::jsonb,
    team_id text,
    tags jsonb DEFAULT '[]'::jsonb,
    metadata jsonb DEFAULT '{}'::jsonb,
    job_assignment_id text,
    job_template_id text
);
CREATE TABLE public.team_members (
    team_id text NOT NULL,
    session_key text NOT NULL,
    role text DEFAULT 'worker'::text NOT NULL,
    label text,
    status text DEFAULT 'active'::text NOT NULL,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    last_active_at timestamp with time zone
);
CREATE TABLE public.teams (
    id text NOT NULL,
    name text NOT NULL,
    lead_session_key text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    config jsonb
);
CREATE TABLE public.workflow_approvals (
    id text NOT NULL,
    run_id text NOT NULL,
    workflow_id text NOT NULL,
    node_id text NOT NULL,
    workflow_name text,
    node_label text,
    message text NOT NULL,
    side_effect_class text,
    previous_output_preview jsonb,
    approve_action jsonb DEFAULT '{}'::jsonb,
    deny_action jsonb DEFAULT '{}'::jsonb,
    timeout_at timestamp with time zone,
    timeout_action text DEFAULT 'deny'::text,
    status text DEFAULT 'pending'::text,
    requested_at timestamp with time zone DEFAULT now(),
    resolved_at timestamp with time zone,
    resolved_by text,
    resolution_note text,
    notification_status text DEFAULT 'pending'::text,
    notification_error text,
    metadata jsonb DEFAULT '{}'::jsonb
);
CREATE TABLE public.workflow_runs (
    id text NOT NULL,
    workflow_id text NOT NULL,
    workflow_version integer NOT NULL,
    status text DEFAULT 'created'::text,
    trigger_type text NOT NULL,
    trigger_payload jsonb,
    current_node_id text,
    variables jsonb DEFAULT '{}'::jsonb,
    total_tokens_used integer DEFAULT 0,
    total_cost_usd numeric(10,4) DEFAULT '0'::numeric,
    started_at timestamp with time zone DEFAULT now(),
    ended_at timestamp with time zone,
    error text,
    metadata jsonb DEFAULT '{}'::jsonb
);
CREATE TABLE public.workflow_step_runs (
    id text NOT NULL,
    run_id text NOT NULL,
    node_id text NOT NULL,
    node_kind text NOT NULL,
    status text DEFAULT 'pending'::text,
    agent_id text,
    task_id text,
    idempotency_key text,
    input_context jsonb,
    output_items jsonb,
    variables_set jsonb DEFAULT '{}'::jsonb,
    tokens_used integer DEFAULT 0,
    cost_usd numeric(10,4) DEFAULT '0'::numeric,
    model_used text,
    started_at timestamp with time zone,
    ended_at timestamp with time zone,
    duration_ms integer,
    retry_count integer DEFAULT 0,
    error text,
    approval_status text,
    approved_by text,
    approval_note text,
    edited_output jsonb
);
CREATE TABLE public.workflow_versions (
    id text NOT NULL,
    workflow_id text NOT NULL,
    version integer NOT NULL,
    nodes jsonb NOT NULL,
    edges jsonb NOT NULL,
    canvas_layout jsonb,
    changed_by text,
    change_summary text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.workflows (
    id text NOT NULL,
    name text NOT NULL,
    description text,
    owner_agent_id text DEFAULT 'argent'::text,
    department_id text,
    version integer DEFAULT 1,
    is_active boolean DEFAULT true,
    nodes jsonb DEFAULT '[]'::jsonb NOT NULL,
    edges jsonb DEFAULT '[]'::jsonb NOT NULL,
    canvas_layout jsonb DEFAULT '{}'::jsonb,
    default_on_error jsonb DEFAULT '{"strategy": "fail", "notifyOnError": true}'::jsonb,
    error_workflow_id text,
    max_run_duration_ms integer DEFAULT 3600000,
    max_run_cost_usd numeric(10,4),
    monthly_budget_usd numeric(10,4),
    trigger_type text,
    trigger_config jsonb,
    next_fire_at timestamp with time zone,
    deployment_stage text DEFAULT 'live'::text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE ONLY public.agents
    ADD CONSTRAINT agents_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.appforge_bases
    ADD CONSTRAINT appforge_bases_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.appforge_idempotency_keys
    ADD CONSTRAINT appforge_idempotency_keys_pkey PRIMARY KEY (idempotency_key);
ALTER TABLE ONLY public.appforge_records
    ADD CONSTRAINT appforge_records_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.appforge_tables
    ADD CONSTRAINT appforge_tables_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.auth_credentials
    ADD CONSTRAINT auth_credentials_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.category_items
    ADD CONSTRAINT category_items_item_id_category_id_pk PRIMARY KEY (item_id, category_id);
ALTER TABLE ONLY public.dispatch_contract_events
    ADD CONSTRAINT dispatch_contract_events_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.dispatch_contracts
    ADD CONSTRAINT dispatch_contracts_pkey PRIMARY KEY (contract_id);
ALTER TABLE ONLY public.entities
    ADD CONSTRAINT entities_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.item_entities
    ADD CONSTRAINT item_entities_item_id_entity_id_pk PRIMARY KEY (item_id, entity_id);
ALTER TABLE ONLY public.job_assignments
    ADD CONSTRAINT job_assignments_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.job_events
    ADD CONSTRAINT job_events_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.job_runs
    ADD CONSTRAINT job_runs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.job_templates
    ADD CONSTRAINT job_templates_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.knowledge_collection_grants
    ADD CONSTRAINT knowledge_collection_grants_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.knowledge_collections
    ADD CONSTRAINT knowledge_collections_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.knowledge_observation_evidence
    ADD CONSTRAINT knowledge_observation_evidence_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.knowledge_observations
    ADD CONSTRAINT knowledge_observations_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.lessons
    ADD CONSTRAINT lessons_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.memory_categories
    ADD CONSTRAINT memory_categories_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.memory_items
    ADD CONSTRAINT memory_items_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.model_feedback
    ADD CONSTRAINT model_feedback_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.observations
    ADD CONSTRAINT observations_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.personal_skill_candidates
    ADD CONSTRAINT personal_skill_candidates_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.personal_skill_reviews
    ADD CONSTRAINT personal_skill_reviews_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.reflections
    ADD CONSTRAINT reflections_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.resources
    ADD CONSTRAINT resources_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.service_keys
    ADD CONSTRAINT service_keys_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.shared_knowledge
    ADD CONSTRAINT shared_knowledge_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.team_members
    ADD CONSTRAINT team_members_team_id_session_key_pk PRIMARY KEY (team_id, session_key);
ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.workflow_approvals
    ADD CONSTRAINT workflow_approvals_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.workflow_runs
    ADD CONSTRAINT workflow_runs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.workflow_step_runs
    ADD CONSTRAINT workflow_step_runs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.workflow_versions
    ADD CONSTRAINT workflow_versions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.workflows
    ADD CONSTRAINT workflows_pkey PRIMARY KEY (id);
CREATE INDEX idx_agents_status ON public.agents USING btree (status);
CREATE INDEX idx_appforge_bases_app ON public.appforge_bases USING btree (app_id);
CREATE INDEX idx_appforge_bases_updated ON public.appforge_bases USING btree (updated_at);
CREATE INDEX idx_appforge_idempotency_created ON public.appforge_idempotency_keys USING btree (created_at);
CREATE INDEX idx_appforge_idempotency_resource ON public.appforge_idempotency_keys USING btree (resource_type, resource_id);
CREATE INDEX idx_appforge_records_base_table ON public.appforge_records USING btree (base_id, table_id);
CREATE INDEX idx_appforge_records_table ON public.appforge_records USING btree (table_id);
CREATE INDEX idx_appforge_records_table_updated ON public.appforge_records USING btree (table_id, updated_at);
CREATE INDEX idx_appforge_tables_base ON public.appforge_tables USING btree (base_id);
CREATE INDEX idx_appforge_tables_base_position ON public.appforge_tables USING btree (base_id, "position");
CREATE INDEX idx_auth_credentials_enabled ON public.auth_credentials USING btree (enabled);
CREATE UNIQUE INDEX idx_auth_credentials_profile ON public.auth_credentials USING btree (profile_id);
CREATE INDEX idx_auth_credentials_provider ON public.auth_credentials USING btree (provider);
CREATE INDEX idx_auth_credentials_type ON public.auth_credentials USING btree (credential_type);
CREATE INDEX idx_categories_agent ON public.memory_categories USING btree (agent_id);
CREATE UNIQUE INDEX idx_categories_agent_name ON public.memory_categories USING btree (agent_id, name);
CREATE INDEX idx_categories_embedding ON public.memory_categories USING hnsw (embedding public.vector_cosine_ops) WITH (m='16', ef_construction='64');
CREATE INDEX idx_categories_fts ON public.memory_categories USING gin (to_tsvector('english'::regconfig, ((((name || ' '::text) || COALESCE(description, ''::text)) || ' '::text) || COALESCE(summary, ''::text))));
CREATE INDEX idx_dispatch_contract_events_contract ON public.dispatch_contract_events USING btree (contract_id);
CREATE INDEX idx_dispatch_contract_events_time ON public.dispatch_contract_events USING btree (event_at);
CREATE INDEX idx_dispatch_contracts_created ON public.dispatch_contracts USING btree (created_at);
CREATE INDEX idx_dispatch_contracts_status ON public.dispatch_contracts USING btree (status);
CREATE INDEX idx_dispatch_contracts_target_agent ON public.dispatch_contracts USING btree (target_agent_id);
CREATE INDEX idx_dispatch_contracts_task ON public.dispatch_contracts USING btree (task_id);
CREATE INDEX idx_entities_agent ON public.entities USING btree (agent_id);
CREATE UNIQUE INDEX idx_entities_agent_name ON public.entities USING btree (agent_id, name);
CREATE INDEX idx_entities_bond ON public.entities USING btree (bond_strength);
CREATE INDEX idx_entities_embedding ON public.entities USING hnsw (embedding public.vector_cosine_ops) WITH (m='16', ef_construction='64');
CREATE INDEX idx_entities_name_trgm ON public.entities USING gin (name public.gin_trgm_ops);
CREATE INDEX idx_entities_type ON public.entities USING btree (entity_type);
CREATE INDEX idx_item_entities_entity ON public.item_entities USING btree (entity_id);
CREATE INDEX idx_items_agent ON public.memory_items USING btree (agent_id);
CREATE INDEX idx_items_created ON public.memory_items USING btree (created_at);
CREATE INDEX idx_items_embedding ON public.memory_items USING hnsw (embedding public.vector_cosine_ops) WITH (m='16', ef_construction='64');
CREATE INDEX idx_items_extra ON public.memory_items USING gin (extra);
CREATE INDEX idx_items_fts ON public.memory_items USING gin (to_tsvector('english'::regconfig, ((((summary || ' '::text) || COALESCE(reflection, ''::text)) || ' '::text) || COALESCE(lesson, ''::text))));
CREATE INDEX idx_items_hash ON public.memory_items USING btree (content_hash);
CREATE INDEX idx_items_reinforced ON public.memory_items USING btree (last_reinforced_at);
CREATE INDEX idx_items_resource ON public.memory_items USING btree (resource_id);
CREATE INDEX idx_items_significance ON public.memory_items USING btree (significance);
CREATE INDEX idx_items_summary_trgm ON public.memory_items USING gin (summary public.gin_trgm_ops);
CREATE INDEX idx_items_type ON public.memory_items USING btree (memory_type);
CREATE INDEX idx_items_visibility ON public.memory_items USING btree (visibility);
CREATE INDEX idx_job_assignments_agent ON public.job_assignments USING btree (agent_id);
CREATE INDEX idx_job_assignments_next_run ON public.job_assignments USING btree (next_run_at);
CREATE UNIQUE INDEX idx_job_events_idempotency_key ON public.job_events USING btree (idempotency_key);
CREATE INDEX idx_job_events_unprocessed ON public.job_events USING btree (processed_at, created_at);
CREATE INDEX idx_job_runs_assignment ON public.job_runs USING btree (assignment_id);
CREATE INDEX idx_job_runs_task ON public.job_runs USING btree (task_id);
CREATE INDEX idx_job_templates_name ON public.job_templates USING btree (name);
CREATE INDEX idx_knowledge_collection_grants_agent ON public.knowledge_collection_grants USING btree (agent_id);
CREATE INDEX idx_knowledge_collection_grants_collection ON public.knowledge_collection_grants USING btree (collection_id);
CREATE UNIQUE INDEX idx_knowledge_collection_grants_unique ON public.knowledge_collection_grants USING btree (collection_id, agent_id);
CREATE INDEX idx_knowledge_collections_owner ON public.knowledge_collections USING btree (owner_agent_id);
CREATE UNIQUE INDEX idx_knowledge_collections_tag ON public.knowledge_collections USING btree (collection_tag);
CREATE UNIQUE INDEX idx_knowledge_obs_active_canonical_unique ON public.knowledge_observations USING btree (agent_id, canonical_key) WHERE (status = 'active'::text);
CREATE INDEX idx_knowledge_obs_agent_canonical ON public.knowledge_observations USING btree (agent_id, canonical_key);
CREATE INDEX idx_knowledge_obs_agent_confidence_freshness ON public.knowledge_observations USING btree (agent_id, confidence DESC, freshness DESC);
CREATE INDEX idx_knowledge_obs_agent_kind_status ON public.knowledge_observations USING btree (agent_id, kind, status);
CREATE INDEX idx_knowledge_obs_agent_last_supported ON public.knowledge_observations USING btree (agent_id, last_supported_at);
CREATE INDEX idx_knowledge_obs_agent_revalidation_due ON public.knowledge_observations USING btree (agent_id, revalidation_due_at);
CREATE INDEX idx_knowledge_obs_agent_subject_status ON public.knowledge_observations USING btree (agent_id, subject_type, subject_id, status);
CREATE INDEX idx_knowledge_obs_evidence_entity ON public.knowledge_observation_evidence USING btree (entity_id);
CREATE INDEX idx_knowledge_obs_evidence_item ON public.knowledge_observation_evidence USING btree (item_id);
CREATE INDEX idx_knowledge_obs_evidence_lesson ON public.knowledge_observation_evidence USING btree (lesson_id);
CREATE INDEX idx_knowledge_obs_evidence_observation ON public.knowledge_observation_evidence USING btree (observation_id);
CREATE INDEX idx_knowledge_obs_evidence_reflection ON public.knowledge_observation_evidence USING btree (reflection_id);
CREATE INDEX idx_knowledge_obs_evidence_stance ON public.knowledge_observation_evidence USING btree (stance);
CREATE INDEX idx_knowledge_obs_fts ON public.knowledge_observations USING gin (to_tsvector('english'::regconfig, ((((summary || ' '::text) || COALESCE(detail, ''::text)) || ' '::text) || translate(COALESCE((tags)::text, ''::text), '[]\"'::text, '    '::text))));
CREATE INDEX idx_knowledge_obs_visibility ON public.knowledge_observations USING btree (visibility);
CREATE INDEX idx_lessons_agent ON public.lessons USING btree (agent_id);
CREATE INDEX idx_lessons_confidence ON public.lessons USING btree (confidence);
CREATE INDEX idx_lessons_created ON public.lessons USING btree (created_at);
CREATE INDEX idx_lessons_embedding ON public.lessons USING hnsw (embedding public.vector_cosine_ops) WITH (m='16', ef_construction='64');
CREATE INDEX idx_lessons_fts ON public.lessons USING gin (to_tsvector('english'::regconfig, ((((((((context || ' '::text) || action) || ' '::text) || outcome) || ' '::text) || lesson) || ' '::text) || COALESCE(correction, ''::text))));
CREATE INDEX idx_lessons_last_seen ON public.lessons USING btree (last_seen);
CREATE INDEX idx_lessons_type ON public.lessons USING btree (type);
CREATE INDEX idx_mf_agent ON public.model_feedback USING btree (agent_id);
CREATE INDEX idx_mf_created ON public.model_feedback USING btree (created_at);
CREATE INDEX idx_mf_provider_model ON public.model_feedback USING btree (provider, model);
CREATE INDEX idx_mf_session_type ON public.model_feedback USING btree (session_type);
CREATE INDEX idx_mf_success ON public.model_feedback USING btree (success);
CREATE INDEX idx_mf_tier ON public.model_feedback USING btree (tier);
CREATE INDEX idx_observations_agent ON public.observations USING btree (agent_id);
CREATE INDEX idx_observations_created ON public.observations USING btree (created_at);
CREATE INDEX idx_observations_fts ON public.observations USING gin (to_tsvector('english'::regconfig, ((COALESCE(summary, ''::text) || ' '::text) || COALESCE(output, ''::text))));
CREATE INDEX idx_observations_importance ON public.observations USING btree (importance);
CREATE INDEX idx_observations_session ON public.observations USING btree (session_id);
CREATE INDEX idx_observations_type ON public.observations USING btree (type);
CREATE INDEX idx_personal_skill_candidates_agent ON public.personal_skill_candidates USING btree (agent_id);
CREATE INDEX idx_personal_skill_candidates_confidence ON public.personal_skill_candidates USING btree (confidence);
CREATE INDEX idx_personal_skill_candidates_scope ON public.personal_skill_candidates USING btree (scope);
CREATE INDEX idx_personal_skill_candidates_state ON public.personal_skill_candidates USING btree (state);
CREATE INDEX idx_personal_skill_candidates_updated ON public.personal_skill_candidates USING btree (updated_at);
CREATE INDEX idx_personal_skill_reviews_agent ON public.personal_skill_reviews USING btree (agent_id, created_at);
CREATE INDEX idx_personal_skill_reviews_candidate ON public.personal_skill_reviews USING btree (candidate_id, created_at);
CREATE INDEX idx_reflections_agent ON public.reflections USING btree (agent_id);
CREATE INDEX idx_reflections_created ON public.reflections USING btree (created_at);
CREATE INDEX idx_reflections_trigger ON public.reflections USING btree (trigger_type);
CREATE INDEX idx_resources_agent ON public.resources USING btree (agent_id);
CREATE INDEX idx_resources_created ON public.resources USING btree (created_at);
CREATE INDEX idx_resources_url ON public.resources USING btree (url);
CREATE INDEX idx_service_keys_category ON public.service_keys USING btree (category);
CREATE INDEX idx_service_keys_enabled ON public.service_keys USING btree (enabled);
CREATE UNIQUE INDEX idx_service_keys_variable ON public.service_keys USING btree (variable);
CREATE INDEX idx_sessions_agent ON public.sessions USING btree (agent_id);
CREATE UNIQUE INDEX idx_sessions_key ON public.sessions USING btree (session_key);
CREATE INDEX idx_sessions_started ON public.sessions USING btree (started_at);
CREATE INDEX idx_sessions_status ON public.sessions USING btree (status);
CREATE INDEX idx_shared_knowledge_agent ON public.shared_knowledge USING btree (source_agent_id);
CREATE INDEX idx_shared_knowledge_category ON public.shared_knowledge USING btree (category);
CREATE INDEX idx_shared_knowledge_confidence ON public.shared_knowledge USING btree (confidence);
CREATE INDEX idx_shared_knowledge_embedding ON public.shared_knowledge USING hnsw (embedding public.vector_cosine_ops) WITH (m='16', ef_construction='64');
CREATE INDEX idx_shared_knowledge_fts ON public.shared_knowledge USING gin (to_tsvector('english'::regconfig, ((title || ' '::text) || content)));
CREATE INDEX idx_stepruns_active ON public.workflow_step_runs USING btree (status) WHERE (status = ANY (ARRAY['running'::text, 'pending'::text, 'queued'::text, 'retrying'::text]));
CREATE UNIQUE INDEX idx_stepruns_idempotency ON public.workflow_step_runs USING btree (idempotency_key);
CREATE INDEX idx_stepruns_run ON public.workflow_step_runs USING btree (run_id);
CREATE INDEX idx_stepruns_status ON public.workflow_step_runs USING btree (status);
CREATE INDEX idx_tasks_agent ON public.tasks USING btree (agent_id);
CREATE INDEX idx_tasks_due ON public.tasks USING btree (due_at);
CREATE INDEX idx_tasks_fts ON public.tasks USING gin (to_tsvector('english'::regconfig, ((title || ' '::text) || COALESCE(description, ''::text))));
CREATE INDEX idx_tasks_job_assignment ON public.tasks USING btree (job_assignment_id);
CREATE INDEX idx_tasks_job_template ON public.tasks USING btree (job_template_id);
CREATE INDEX idx_tasks_priority ON public.tasks USING btree (priority);
CREATE INDEX idx_tasks_status ON public.tasks USING btree (status);
CREATE INDEX idx_tasks_team ON public.tasks USING btree (team_id);
CREATE INDEX idx_team_members_session ON public.team_members USING btree (session_key);
CREATE INDEX idx_teams_status ON public.teams USING btree (status);
CREATE INDEX idx_wfruns_active ON public.workflow_runs USING btree (status) WHERE (status <> ALL (ARRAY['completed'::text, 'failed'::text, 'cancelled'::text]));
CREATE INDEX idx_wfruns_created ON public.workflow_runs USING btree (started_at DESC);
CREATE INDEX idx_wfruns_started ON public.workflow_runs USING btree (started_at);
CREATE INDEX idx_wfruns_status ON public.workflow_runs USING btree (status);
CREATE INDEX idx_wfruns_workflow ON public.workflow_runs USING btree (workflow_id);
CREATE INDEX idx_workflow_approvals_pending ON public.workflow_approvals USING btree (status, requested_at DESC) WHERE (status = 'pending'::text);
CREATE INDEX idx_workflow_approvals_run ON public.workflow_approvals USING btree (run_id);
CREATE UNIQUE INDEX idx_workflow_approvals_run_node ON public.workflow_approvals USING btree (run_id, node_id);
CREATE INDEX idx_workflow_approvals_status ON public.workflow_approvals USING btree (status);
CREATE INDEX idx_workflow_approvals_workflow ON public.workflow_approvals USING btree (workflow_id, requested_at);
CREATE UNIQUE INDEX idx_workflow_versions_unique ON public.workflow_versions USING btree (workflow_id, version);
CREATE INDEX idx_workflow_versions_workflow ON public.workflow_versions USING btree (workflow_id);
CREATE INDEX idx_workflows_active ON public.workflows USING btree (is_active);
CREATE INDEX idx_workflows_next_fire ON public.workflows USING btree (next_fire_at) WHERE ((is_active = true) AND (trigger_type = 'cron'::text));
CREATE INDEX idx_workflows_owner ON public.workflows USING btree (owner_agent_id);
CREATE INDEX idx_workflows_trigger ON public.workflows USING btree (trigger_type);
ALTER TABLE ONLY public.appforge_records
    ADD CONSTRAINT appforge_records_base_id_appforge_bases_id_fk FOREIGN KEY (base_id) REFERENCES public.appforge_bases(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.appforge_records
    ADD CONSTRAINT appforge_records_table_id_appforge_tables_id_fk FOREIGN KEY (table_id) REFERENCES public.appforge_tables(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.appforge_tables
    ADD CONSTRAINT appforge_tables_base_id_appforge_bases_id_fk FOREIGN KEY (base_id) REFERENCES public.appforge_bases(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.category_items
    ADD CONSTRAINT category_items_category_id_memory_categories_id_fk FOREIGN KEY (category_id) REFERENCES public.memory_categories(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.category_items
    ADD CONSTRAINT category_items_item_id_memory_items_id_fk FOREIGN KEY (item_id) REFERENCES public.memory_items(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.dispatch_contract_events
    ADD CONSTRAINT dispatch_contract_events_contract_id_dispatch_contracts_contrac FOREIGN KEY (contract_id) REFERENCES public.dispatch_contracts(contract_id) ON DELETE CASCADE;
ALTER TABLE ONLY public.entities
    ADD CONSTRAINT entities_agent_id_agents_id_fk FOREIGN KEY (agent_id) REFERENCES public.agents(id);
ALTER TABLE ONLY public.item_entities
    ADD CONSTRAINT item_entities_entity_id_entities_id_fk FOREIGN KEY (entity_id) REFERENCES public.entities(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.item_entities
    ADD CONSTRAINT item_entities_item_id_memory_items_id_fk FOREIGN KEY (item_id) REFERENCES public.memory_items(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.job_assignments
    ADD CONSTRAINT job_assignments_template_id_job_templates_id_fk FOREIGN KEY (template_id) REFERENCES public.job_templates(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.job_runs
    ADD CONSTRAINT job_runs_assignment_id_job_assignments_id_fk FOREIGN KEY (assignment_id) REFERENCES public.job_assignments(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.job_runs
    ADD CONSTRAINT job_runs_task_id_tasks_id_fk FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.job_runs
    ADD CONSTRAINT job_runs_template_id_job_templates_id_fk FOREIGN KEY (template_id) REFERENCES public.job_templates(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.knowledge_collection_grants
    ADD CONSTRAINT knowledge_collection_grants_collection_id_knowledge_collections FOREIGN KEY (collection_id) REFERENCES public.knowledge_collections(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.knowledge_observation_evidence
    ADD CONSTRAINT knowledge_observation_evidence_entity_id_entities_id_fk FOREIGN KEY (entity_id) REFERENCES public.entities(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.knowledge_observation_evidence
    ADD CONSTRAINT knowledge_observation_evidence_item_id_memory_items_id_fk FOREIGN KEY (item_id) REFERENCES public.memory_items(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.knowledge_observation_evidence
    ADD CONSTRAINT knowledge_observation_evidence_lesson_id_lessons_id_fk FOREIGN KEY (lesson_id) REFERENCES public.lessons(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.knowledge_observation_evidence
    ADD CONSTRAINT knowledge_observation_evidence_observation_id_knowledge_observa FOREIGN KEY (observation_id) REFERENCES public.knowledge_observations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.knowledge_observation_evidence
    ADD CONSTRAINT knowledge_observation_evidence_reflection_id_reflections_id_fk FOREIGN KEY (reflection_id) REFERENCES public.reflections(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.knowledge_observations
    ADD CONSTRAINT knowledge_observations_agent_id_agents_id_fk FOREIGN KEY (agent_id) REFERENCES public.agents(id);
ALTER TABLE ONLY public.knowledge_observations
    ADD CONSTRAINT knowledge_observations_supersedes_observation_id_knowledge_obse FOREIGN KEY (supersedes_observation_id) REFERENCES public.knowledge_observations(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.lessons
    ADD CONSTRAINT lessons_agent_id_agents_id_fk FOREIGN KEY (agent_id) REFERENCES public.agents(id);
ALTER TABLE ONLY public.memory_categories
    ADD CONSTRAINT memory_categories_agent_id_agents_id_fk FOREIGN KEY (agent_id) REFERENCES public.agents(id);
ALTER TABLE ONLY public.memory_items
    ADD CONSTRAINT memory_items_agent_id_agents_id_fk FOREIGN KEY (agent_id) REFERENCES public.agents(id);
ALTER TABLE ONLY public.memory_items
    ADD CONSTRAINT memory_items_resource_id_resources_id_fk FOREIGN KEY (resource_id) REFERENCES public.resources(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.model_feedback
    ADD CONSTRAINT model_feedback_agent_id_agents_id_fk FOREIGN KEY (agent_id) REFERENCES public.agents(id);
ALTER TABLE ONLY public.observations
    ADD CONSTRAINT observations_agent_id_agents_id_fk FOREIGN KEY (agent_id) REFERENCES public.agents(id);
ALTER TABLE ONLY public.observations
    ADD CONSTRAINT observations_session_id_sessions_id_fk FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.personal_skill_candidates
    ADD CONSTRAINT personal_skill_candidates_agent_id_agents_id_fk FOREIGN KEY (agent_id) REFERENCES public.agents(id);
ALTER TABLE ONLY public.personal_skill_reviews
    ADD CONSTRAINT personal_skill_reviews_agent_id_agents_id_fk FOREIGN KEY (agent_id) REFERENCES public.agents(id);
ALTER TABLE ONLY public.reflections
    ADD CONSTRAINT reflections_agent_id_agents_id_fk FOREIGN KEY (agent_id) REFERENCES public.agents(id);
ALTER TABLE ONLY public.resources
    ADD CONSTRAINT resources_agent_id_agents_id_fk FOREIGN KEY (agent_id) REFERENCES public.agents(id);
ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_agent_id_agents_id_fk FOREIGN KEY (agent_id) REFERENCES public.agents(id);
ALTER TABLE ONLY public.shared_knowledge
    ADD CONSTRAINT shared_knowledge_source_agent_id_agents_id_fk FOREIGN KEY (source_agent_id) REFERENCES public.agents(id);
ALTER TABLE ONLY public.shared_knowledge
    ADD CONSTRAINT shared_knowledge_source_item_id_memory_items_id_fk FOREIGN KEY (source_item_id) REFERENCES public.memory_items(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_agent_id_agents_id_fk FOREIGN KEY (agent_id) REFERENCES public.agents(id);
ALTER TABLE ONLY public.team_members
    ADD CONSTRAINT team_members_team_id_teams_id_fk FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.workflow_approvals
    ADD CONSTRAINT workflow_approvals_run_id_workflow_runs_id_fk FOREIGN KEY (run_id) REFERENCES public.workflow_runs(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.workflow_approvals
    ADD CONSTRAINT workflow_approvals_workflow_id_workflows_id_fk FOREIGN KEY (workflow_id) REFERENCES public.workflows(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.workflow_runs
    ADD CONSTRAINT workflow_runs_workflow_id_workflows_id_fk FOREIGN KEY (workflow_id) REFERENCES public.workflows(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.workflow_step_runs
    ADD CONSTRAINT workflow_step_runs_run_id_workflow_runs_id_fk FOREIGN KEY (run_id) REFERENCES public.workflow_runs(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.workflow_versions
    ADD CONSTRAINT workflow_versions_workflow_id_workflows_id_fk FOREIGN KEY (workflow_id) REFERENCES public.workflows(id) ON DELETE CASCADE;
CREATE POLICY agent_own_categories ON public.memory_categories USING ((agent_id = current_setting('app.agent_id'::text, true)));
CREATE POLICY agent_own_entities ON public.entities USING ((agent_id = current_setting('app.agent_id'::text, true)));
CREATE POLICY agent_own_feedback ON public.model_feedback USING ((agent_id = current_setting('app.agent_id'::text, true)));
CREATE POLICY agent_own_items ON public.memory_items USING ((agent_id = current_setting('app.agent_id'::text, true)));
CREATE POLICY agent_own_knowledge_observations ON public.knowledge_observations USING ((agent_id = current_setting('app.agent_id'::text, true)));
CREATE POLICY agent_own_lessons ON public.lessons USING ((agent_id = current_setting('app.agent_id'::text, true)));
CREATE POLICY agent_own_observations ON public.observations USING ((agent_id = current_setting('app.agent_id'::text, true)));
CREATE POLICY agent_own_reflections ON public.reflections USING ((agent_id = current_setting('app.agent_id'::text, true)));
CREATE POLICY agent_own_resources ON public.resources USING ((agent_id = current_setting('app.agent_id'::text, true)));
CREATE POLICY agent_own_sessions ON public.sessions USING ((agent_id = current_setting('app.agent_id'::text, true)));
CREATE POLICY agent_visible_knowledge_observation_evidence ON public.knowledge_observation_evidence USING ((EXISTS ( SELECT 1
   FROM public.knowledge_observations ko
  WHERE ((ko.id = knowledge_observation_evidence.observation_id) AND ((ko.agent_id = current_setting('app.agent_id'::text, true)) OR (ko.visibility = ANY (ARRAY['family'::text, 'public'::text])) OR ((ko.visibility = 'team'::text) AND (ko.agent_id IN ( SELECT tm.session_key
           FROM public.team_members tm
          WHERE (tm.team_id IN ( SELECT tm2.team_id
                   FROM public.team_members tm2
                  WHERE (tm2.session_key = current_setting('app.agent_id'::text, true))))))))))));
ALTER TABLE public.entities ENABLE ROW LEVEL SECURITY;
CREATE POLICY family_shared_entities ON public.entities FOR SELECT USING ((visibility = ANY (ARRAY['family'::text, 'public'::text])));
CREATE POLICY family_shared_items ON public.memory_items FOR SELECT USING ((visibility = ANY (ARRAY['family'::text, 'public'::text])));
CREATE POLICY family_shared_knowledge_observations ON public.knowledge_observations FOR SELECT USING ((visibility = ANY (ARRAY['family'::text, 'public'::text])));
CREATE POLICY family_shared_lessons ON public.lessons FOR SELECT USING ((visibility = ANY (ARRAY['family'::text, 'public'::text])));
CREATE POLICY family_shared_resources ON public.resources FOR SELECT USING ((visibility = ANY (ARRAY['family'::text, 'public'::text])));
ALTER TABLE public.knowledge_observation_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lessons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memory_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.model_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reflections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY team_shared_items ON public.memory_items FOR SELECT USING (((visibility = 'team'::text) AND (agent_id IN ( SELECT tm.session_key
   FROM public.team_members tm
  WHERE (tm.team_id IN ( SELECT tm2.team_id
           FROM public.team_members tm2
          WHERE (tm2.session_key = current_setting('app.agent_id'::text, true))))))));
CREATE POLICY team_shared_knowledge_observations ON public.knowledge_observations FOR SELECT USING (((visibility = 'team'::text) AND (agent_id IN ( SELECT tm.session_key
   FROM public.team_members tm
  WHERE (tm.team_id IN ( SELECT tm2.team_id
           FROM public.team_members tm2
          WHERE (tm2.session_key = current_setting('app.agent_id'::text, true))))))));
`;
