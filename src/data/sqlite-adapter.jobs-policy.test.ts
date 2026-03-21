import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SQLiteAdapter } from "./sqlite-adapter.js";

const OLD_NODE_ENV = process.env.NODE_ENV;
const OLD_ALLOW_NON_PG = process.env.ARGENT_ALLOW_NON_PG_WORKFORCE;
const OLD_VITEST = process.env.VITEST;

function createAdapterFixture() {
  const memuStore = {} as never;
  const tasksModule = { init: vi.fn(async () => undefined) } as never;
  const teamsModule = { init: vi.fn(async () => undefined) } as never;
  const adapter = new SQLiteAdapter(memuStore, tasksModule, teamsModule);
  return { adapter };
}

describe("SQLiteAdapter workforce jobs policy", () => {
  beforeEach(() => {
    delete process.env.VITEST;
    delete process.env.ARGENT_ALLOW_NON_PG_WORKFORCE;
    process.env.NODE_ENV = "production";
  });

  afterEach(() => {
    if (OLD_NODE_ENV === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = OLD_NODE_ENV;
    }
    if (OLD_ALLOW_NON_PG === undefined) {
      delete process.env.ARGENT_ALLOW_NON_PG_WORKFORCE;
    } else {
      process.env.ARGENT_ALLOW_NON_PG_WORKFORCE = OLD_ALLOW_NON_PG;
    }
    if (OLD_VITEST === undefined) {
      delete process.env.VITEST;
    } else {
      process.env.VITEST = OLD_VITEST;
    }
  });

  it("blocks SQLite workforce jobs in production by default", async () => {
    const { adapter } = createAdapterFixture();

    await expect(adapter.jobs.listTemplates()).rejects.toThrow(
      'workforce operation "listTemplates" is not supported on SQLite adapters',
    );
  });
});
