/**
 * Unified Data API for ArgentOS
 *
 * Single interface for querying across multiple SQLite databases:
 * - Dashboard DB: Tasks, events, tickets
 * - Memo DB: Memory/observations
 * - Sessions DB: Session metadata
 *
 * Features:
 * - Cross-database queries via SQLite ATTACH
 * - FTS5 full-text search
 * - Consistent API across all data types
 */

import type {
  DataAPIConfig,
  DatabasePaths,
  Task,
  TaskCreateInput,
  TaskUpdateInput,
  TaskFilter,
  ProjectCreateInput,
  ProjectWithChildren,
  UnifiedSearchOptions,
  UnifiedSearchResult,
} from "./types.js";
import { ConnectionManager, getDefaultDatabasePaths } from "./connection.js";
import { SearchModule } from "./search.js";
import { TasksModule } from "./tasks.js";
import { TeamsModule } from "./teams.js";

export class DataAPI {
  private conn: ConnectionManager;
  private _tasks: TasksModule;
  private _teams: TeamsModule;
  private _search: SearchModule;
  private initialized = false;

  constructor(config?: Partial<DataAPIConfig>) {
    const paths = config?.paths || getDefaultDatabasePaths();
    const fullConfig: DataAPIConfig = {
      paths,
      enableFTS: config?.enableFTS ?? true,
      readOnly: config?.readOnly ?? false,
    };

    this.conn = new ConnectionManager(fullConfig);
    this._tasks = new TasksModule(this.conn);
    this._teams = new TeamsModule(this.conn);
    this._search = new SearchModule(this.conn);
  }

  /**
   * Initialize the data API
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    await this.conn.init();
    await this._tasks.init();
    await this._teams.init();

    this.initialized = true;
  }

  /**
   * Close all connections
   */
  close(): void {
    this.conn.close();
    this.initialized = false;
  }

  // ============================================================================
  // Tasks API
  // ============================================================================

  get tasks(): TasksModule {
    return this._tasks;
  }

  // ============================================================================
  // Teams API
  // ============================================================================

  get teams(): TeamsModule {
    return this._teams;
  }

  /**
   * Create a new task
   */
  createTask(input: TaskCreateInput): Task {
    return this._tasks.create(input);
  }

  /**
   * Get a task by ID
   */
  getTask(id: string): Task | null {
    return this._tasks.get(id);
  }

  /**
   * Update a task
   */
  updateTask(id: string, input: TaskUpdateInput): Task | null {
    return this._tasks.update(id, input);
  }

  /**
   * Delete a task
   */
  deleteTask(id: string): boolean {
    return this._tasks.delete(id);
  }

  /**
   * List tasks with optional filtering
   */
  listTasks(filter?: TaskFilter): Task[] {
    return this._tasks.list(filter);
  }

  /**
   * Start a task
   */
  startTask(id: string): Task | null {
    return this._tasks.start(id);
  }

  /**
   * Complete a task
   */
  completeTask(id: string): Task | null {
    return this._tasks.complete(id);
  }

  /**
   * Block a task
   */
  blockTask(id: string, reason?: string): Task | null {
    return this._tasks.block(id, reason);
  }

  /**
   * Fail a task
   */
  failTask(id: string, reason?: string): Task | null {
    return this._tasks.fail(id, reason);
  }

  /**
   * Create a project with child tasks
   */
  createProject(input: ProjectCreateInput): ProjectWithChildren {
    return this._tasks.createProject(input);
  }

  /**
   * List projects with progress counts
   */
  listProjects(filter?: TaskFilter): ProjectWithChildren[] {
    return this._tasks.listProjects(filter);
  }

  /**
   * Get a project with all child tasks
   */
  getProjectWithChildren(id: string): ProjectWithChildren | null {
    return this._tasks.getProjectWithChildren(id);
  }

  // ============================================================================
  // Search API
  // ============================================================================

  get search(): SearchModule {
    return this._search;
  }

  /**
   * Unified search across all databases
   */
  async unifiedSearch(options: UnifiedSearchOptions): Promise<UnifiedSearchResult[]> {
    return this._search.search(options);
  }

  /**
   * Quick search helper
   */
  async quickSearch(query: string, limit = 20): Promise<UnifiedSearchResult[]> {
    return this._search.search({ query, limit });
  }

  // ============================================================================
  // Connection helpers
  // ============================================================================

  /**
   * Get the connection manager for advanced operations
   */
  getConnectionManager(): ConnectionManager {
    return this.conn;
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}

// ============================================================================
// Singleton instance for global access
// ============================================================================

let globalDataAPI: DataAPI | null = null;

/**
 * Get or create the global DataAPI instance
 */
export async function getDataAPI(config?: Partial<DataAPIConfig>): Promise<DataAPI> {
  if (!globalDataAPI) {
    globalDataAPI = new DataAPI(config);
    await globalDataAPI.init();
  }
  return globalDataAPI;
}

/**
 * Close the global DataAPI instance
 */
export function closeDataAPI(): void {
  if (globalDataAPI) {
    globalDataAPI.close();
    globalDataAPI = null;
  }
}

// ============================================================================
// Re-exports
// ============================================================================

export { ConnectionManager, getDefaultDatabasePaths } from "./connection.js";
export { TasksModule } from "./tasks.js";
export { TeamsModule } from "./teams.js";
export { SearchModule } from "./search.js";
export * from "./types.js";
