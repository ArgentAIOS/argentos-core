/**
 * Unified Data API Types
 *
 * Shared types for the ArgentOS data layer that spans multiple SQLite databases.
 */

// ============================================================================
// Tasks (from Dashboard DB)
// ============================================================================

export type TaskPriority = "urgent" | "high" | "normal" | "low" | "background";
export type TaskStatus =
  | "pending"
  | "in_progress"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled";
export type TaskSource = "user" | "agent" | "heartbeat" | "schedule" | "channel" | "job";

export type TaskAssignee = string;

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  source: TaskSource;
  assignee?: TaskAssignee;

  // Accountability
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  dueAt?: number;

  // Context
  agentId?: string;
  sessionId?: string;
  channelId?: string;
  parentTaskId?: string;

  // Team support
  dependsOn?: string[];
  teamId?: string;

  // Metadata
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface TaskCreateInput {
  title: string;
  description?: string;
  priority?: TaskPriority;
  source?: TaskSource;
  assignee?: TaskAssignee;
  dueAt?: number;
  agentId?: string;
  channelId?: string;
  parentTaskId?: string;
  dependsOn?: string[];
  teamId?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface TaskUpdateInput {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  assignee?: TaskAssignee | null;
  dueAt?: number;
  dependsOn?: string[];
  teamId?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface TaskFilter {
  status?: TaskStatus | TaskStatus[];
  priority?: TaskPriority | TaskPriority[];
  source?: TaskSource | TaskSource[];
  assignee?: TaskAssignee | null;
  agentId?: string;
  channelId?: string;
  teamId?: string;
  tags?: string[];
  dueBefore?: number;
  dueAfter?: number;
  isProject?: boolean;
  parentTaskId?: string;
  limit?: number;
  offset?: number;
}

export interface ProjectCreateInput {
  title: string;
  description?: string;
  priority?: TaskPriority;
  tags?: string[];
  source?: TaskSource;
  agentId?: string;
  tasks: TaskCreateInput[];
}

export interface ProjectWithChildren {
  project: Task;
  tasks: Task[];
  taskCount: number;
  completedCount: number;
}

// ============================================================================
// Memory / Observations (from Memo DB)
// ============================================================================

export type ObservationType =
  | "session_start"
  | "session_end"
  | "tool_call"
  | "tool_result"
  | "user_message"
  | "assistant_message"
  | "error"
  | "note"
  | "learning";

export interface Observation {
  id: number;
  sessionId: string;
  type: ObservationType;
  content: string;
  timestamp: number;
  agentId?: string;
  channelId?: string;
  metadata?: Record<string, unknown>;
}

export interface ObservationCreateInput {
  sessionId: string;
  type: ObservationType;
  content: string;
  agentId?: string;
  channelId?: string;
  metadata?: Record<string, unknown>;
}

export interface MemorySearchResult {
  observation: Observation;
  score: number;
  snippet: string;
}

export interface MemoryFilter {
  sessionId?: string;
  type?: ObservationType | ObservationType[];
  agentId?: string;
  channelId?: string;
  since?: number;
  until?: number;
  limit?: number;
  offset?: number;
}

// ============================================================================
// Sessions
// ============================================================================

export type SessionStatus = "active" | "idle" | "completed" | "error";

export interface Session {
  id: string;
  agentId: string;
  channelId?: string;
  status: SessionStatus;
  startedAt: number;
  lastActivityAt: number;
  endedAt?: number;
  messageCount: number;
  tokenCount?: number;
  metadata?: Record<string, unknown>;
}

export interface SessionFilter {
  agentId?: string;
  channelId?: string;
  status?: SessionStatus | SessionStatus[];
  since?: number;
  until?: number;
  limit?: number;
  offset?: number;
}

// ============================================================================
// Unified Search
// ============================================================================

export type SearchResultType = "task" | "observation" | "session";

export interface UnifiedSearchResult {
  type: SearchResultType;
  id: string | number;
  title: string;
  snippet: string;
  score: number;
  timestamp: number;
  source: string; // database name
}

export interface UnifiedSearchOptions {
  query: string;
  types?: SearchResultType[];
  agentId?: string;
  channelId?: string;
  since?: number;
  until?: number;
  limit?: number;
}

// ============================================================================
// Teams
// ============================================================================

export type TeamStatus = "active" | "completed" | "disbanded";
export type TeamMemberRole = "lead" | "worker";
export type TeamMemberStatus = "active" | "idle" | "completed" | "failed";

export interface Team {
  id: string;
  name: string;
  leadSessionKey: string;
  status: TeamStatus;
  createdAt: number;
  updatedAt: number;
  config?: Record<string, unknown>;
}

export interface TeamMember {
  teamId: string;
  sessionKey: string;
  role: TeamMemberRole;
  label?: string;
  status: TeamMemberStatus;
  joinedAt: number;
  lastActiveAt?: number;
}

export interface TeamWithMembers {
  team: Team;
  members: TeamMember[];
}

export interface TeamCreateInput {
  name: string;
  leadSessionKey: string;
  config?: Record<string, unknown>;
}

// ============================================================================
// Jobs
// ============================================================================

export type JobExecutionMode = "simulate" | "live";
export type JobDeploymentStage = "simulate" | "shadow" | "limited-live" | "live";
export type JobRunStatus = "running" | "completed" | "blocked" | "failed";
export type JobEventSource = "internal_hook" | "webhook" | "manual" | "system";
export type JobPromotionState =
  | "draft"
  | "in-review"
  | "approved-next-stage"
  | "held"
  | "rolled-back";
export type JobRunReviewStatus = "pending" | "approved" | "held" | "rolled-back";

export interface JobRelationshipContract {
  relationshipObjective?: string;
  toneProfile?: string;
  trustPriorities?: string[];
  continuityRequirements?: string[];
  honestyRules?: string[];
  handoffStyle?: string;
  relationalFailureModes?: string[];
}

export interface JobTemplate {
  id: string;
  name: string;
  departmentId?: string;
  description?: string;
  rolePrompt: string;
  sop?: string;
  successDefinition?: string;
  defaultMode: JobExecutionMode;
  defaultStage?: JobDeploymentStage;
  toolsAllow?: string[];
  toolsDeny?: string[];
  relationshipContract?: JobRelationshipContract;
  tags?: string[];
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface JobTemplateCreateInput {
  name: string;
  departmentId?: string;
  description?: string;
  rolePrompt: string;
  sop?: string;
  successDefinition?: string;
  defaultMode?: JobExecutionMode;
  defaultStage?: JobDeploymentStage;
  toolsAllow?: string[];
  toolsDeny?: string[];
  relationshipContract?: JobRelationshipContract;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface JobAssignment {
  id: string;
  templateId: string;
  agentId: string;
  title: string;
  enabled: boolean;
  cadenceMinutes: number;
  executionMode: JobExecutionMode;
  deploymentStage?: JobDeploymentStage;
  promotionState?: JobPromotionState;
  scopeLimit?: string;
  reviewRequired?: boolean;
  nextRunAt?: number;
  lastRunAt?: number;
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
}

export interface JobAssignmentCreateInput {
  templateId: string;
  agentId: string;
  title?: string;
  enabled?: boolean;
  cadenceMinutes?: number;
  executionMode?: JobExecutionMode;
  deploymentStage?: JobDeploymentStage;
  promotionState?: JobPromotionState;
  scopeLimit?: string;
  reviewRequired?: boolean;
  nextRunAt?: number;
  metadata?: Record<string, unknown>;
}

export interface JobRun {
  id: string;
  assignmentId: string;
  templateId: string;
  agentId: string;
  taskId: string;
  executionMode: JobExecutionMode;
  deploymentStage?: JobDeploymentStage;
  reviewStatus?: JobRunReviewStatus;
  reviewedBy?: string;
  reviewedAt?: number;
  status: JobRunStatus;
  summary?: string;
  blockers?: string;
  createdAt: number;
  startedAt: number;
  endedAt?: number;
  metadata?: Record<string, unknown>;
}

export interface JobRunCreateInput {
  assignmentId: string;
  templateId: string;
  agentId: string;
  taskId: string;
  executionMode: JobExecutionMode;
  deploymentStage?: JobDeploymentStage;
  reviewStatus?: JobRunReviewStatus;
  reviewedBy?: string;
  reviewedAt?: number;
  status?: JobRunStatus;
  summary?: string;
  blockers?: string;
  metadata?: Record<string, unknown>;
}

export interface JobEvent {
  id: string;
  eventType: string;
  source: JobEventSource;
  idempotencyKey?: string;
  targetAgentId?: string;
  payload?: Record<string, unknown>;
  createdAt: number;
  processedAt?: number;
  outcome?: string;
  metadata?: Record<string, unknown>;
}

export interface JobEventEnqueueInput {
  eventType: string;
  source: JobEventSource;
  idempotencyKey?: string;
  targetAgentId?: string;
  payload?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface JobRunReviewInput {
  reviewStatus: JobRunReviewStatus;
  reviewedBy?: string;
  notes?: string;
  action?: "promote" | "hold" | "rollback";
  targetStage?: JobDeploymentStage;
}

export interface JobTaskContext {
  assignment: JobAssignment;
  template: JobTemplate;
}

// ============================================================================
// Database Connection
// ============================================================================

export interface DatabasePaths {
  dashboard: string; // Tasks, events, tickets
  memo: string; // Memory/observations
  sessions: string; // Session metadata
}

export interface DataAPIConfig {
  paths: DatabasePaths;
  enableFTS?: boolean;
  readOnly?: boolean;
}
