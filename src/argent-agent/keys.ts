/**
 * Argent Agent — API Key Manager
 *
 * Reads API keys from the dashboard's service-keys.json store.
 * Provides a unified way to access keys for providers.
 *
 * Built for Argent Core - February 16, 2026
 */

import { readFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";

// ============================================================================
// Types
// ============================================================================

export interface ServiceKey {
  id: string;
  name: string;
  variable: string;
  value: string;
  service: string;
  category: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ServiceKeysStore {
  version: number;
  keys: ServiceKey[];
}

// ============================================================================
// Key Manager
// ============================================================================

export class KeyManager {
  private keysPath: string;
  private cache: ServiceKeysStore | null = null;
  private cacheTime: number = 0;
  private cacheTTL = 60000; // 1 minute cache

  constructor(keysPath?: string) {
    this.keysPath = keysPath || join(homedir(), ".argentos", "service-keys.json");
  }

  /**
   * Load keys from disk (with caching)
   */
  private async load(): Promise<ServiceKeysStore> {
    const now = Date.now();

    // Return cached if fresh
    if (this.cache && now - this.cacheTime < this.cacheTTL) {
      return this.cache;
    }

    // Load from disk
    try {
      const content = await readFile(this.keysPath, "utf-8");
      this.cache = JSON.parse(content);
      this.cacheTime = now;
      return this.cache!;
    } catch (error) {
      throw new Error(`Failed to load service keys from ${this.keysPath}: ${error}`);
    }
  }

  /**
   * Get a key by environment variable name
   */
  async getKey(variable: string): Promise<string | null> {
    const store = await this.load();
    const key = store.keys.find((k) => k.variable === variable && k.enabled);
    return key?.value || null;
  }

  /**
   * Get all keys for a service
   */
  async getKeysForService(service: string): Promise<ServiceKey[]> {
    const store = await this.load();
    return store.keys.filter((k) => k.service === service && k.enabled);
  }

  /**
   * Get the first enabled key for a service
   */
  async getFirstKeyForService(service: string): Promise<string | null> {
    const keys = await this.getKeysForService(service);
    return keys[0]?.value || null;
  }

  /**
   * Get provider API key by provider name
   *
   * Maps provider names to service names and returns the appropriate key.
   */
  async getProviderKey(provider: string): Promise<string | null> {
    // Map provider names to service names and variable names
    const providerMap: Record<string, { service?: string; variable?: string }> = {
      anthropic: { service: "Anthropic" },
      openai: { service: "OpenAI" },
      "openai-codex": { service: "OpenAI" },
      google: { service: "Google" },
      "google-vertex": { service: "Google" },
      "google-gemini-cli": { service: "Google" },
      zai: { service: "Z.AI" },
      xai: { service: "xAI" },
      groq: { service: "Groq" },
      mistral: { service: "Mistral" },
      minimax: { service: "MiniMax" },
      perplexity: { service: "Perplexity" },
      deepseek: { service: "DeepSeek" },
      inception: { service: "Inception", variable: "INCEPTION_API_KEY" },
    };

    const mapping = providerMap[provider.toLowerCase()];

    if (!mapping) {
      return null;
    }

    // If variable specified, try that first
    if (mapping.variable) {
      const key = await this.getKey(mapping.variable);
      if (key) return key;
    }

    // Otherwise get first key for service
    if (mapping.service) {
      return this.getFirstKeyForService(mapping.service);
    }

    return null;
  }

  /**
   * Get all enabled keys
   */
  async getAllKeys(): Promise<ServiceKey[]> {
    const store = await this.load();
    return store.keys.filter((k) => k.enabled);
  }

  /**
   * Invalidate cache (force reload on next access)
   */
  invalidateCache(): void {
    this.cache = null;
    this.cacheTime = 0;
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let defaultKeyManager: KeyManager | null = null;

/**
 * Get the default key manager instance
 */
export function getKeyManager(): KeyManager {
  if (!defaultKeyManager) {
    defaultKeyManager = new KeyManager();
  }
  return defaultKeyManager;
}

/**
 * Convenience function: get a provider key
 */
export async function getProviderKey(provider: string): Promise<string | null> {
  return getKeyManager().getProviderKey(provider);
}

/**
 * Convenience function: get a key by variable name
 */
export async function getKey(variable: string): Promise<string | null> {
  return getKeyManager().getKey(variable);
}
