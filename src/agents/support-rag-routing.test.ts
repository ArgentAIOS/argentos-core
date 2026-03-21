import { describe, expect, it } from "vitest";
import {
  collectionMatchesAny,
  inferDepartmentKnowledgeCollections,
  inferSupportKnowledgeCollections,
  isSupportDepartment,
} from "./support-rag-routing.js";

describe("support-rag-routing", () => {
  it("detects support department IDs", () => {
    expect(isSupportDepartment("support")).toBe(true);
    expect(isSupportDepartment("support-tier-1")).toBe(true);
    expect(isSupportDepartment("operations")).toBe(false);
  });

  it("routes technical support queries to runbooks", () => {
    const collections = inferSupportKnowledgeCollections("dashboard login fails with auth error");
    expect(collections).toContain("support-runbooks");
  });

  it("routes sentiment-heavy queries to tone guidance", () => {
    const collections = inferSupportKnowledgeCollections("customer is angry and wants a manager");
    expect(collections).toContain("support-tone");
  });

  it("routes goodwill/exception queries to policy collections", () => {
    const collections = inferSupportKnowledgeCollections(
      "can we grant a one-time refund as a policy exception",
    );
    expect(collections).toContain("support-policy");
    expect(collections).toContain("support-goodwill");
    expect(collections).toContain("support-exceptions");
  });

  it("prefers explicit collection filters when provided", () => {
    const collections = inferDepartmentKnowledgeCollections({
      departmentId: "support",
      query: "login fails",
      explicitCollections: ["docpane"],
    });
    expect(collections).toEqual(["docpane"]);
  });

  it("matches normalized collection tags", () => {
    const wanted = new Set(["support-runbooks"]);
    expect(collectionMatchesAny("support runbooks", wanted)).toBe(true);
    expect(collectionMatchesAny("support-tone", wanted)).toBe(false);
  });
});
