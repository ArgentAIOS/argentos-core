import { describe, expect, it } from "vitest";
import { cycleGridSort, gridSortIndicator, type GridSortState } from "./app-forge-grid-sort.js";

const NO_SORT: GridSortState = { sortFieldId: "", sortDirection: "asc" };

describe("app-forge grid sort — cycleGridSort", () => {
  it("activates ascending sort when an unsorted column is clicked", () => {
    expect(cycleGridSort(NO_SORT, "name")).toEqual({
      sortFieldId: "name",
      sortDirection: "asc",
    });
  });

  it("flips ascending to descending when the active column is clicked again", () => {
    expect(cycleGridSort({ sortFieldId: "name", sortDirection: "asc" }, "name")).toEqual({
      sortFieldId: "name",
      sortDirection: "desc",
    });
  });

  it("clears the sort when the active descending column is clicked", () => {
    expect(cycleGridSort({ sortFieldId: "name", sortDirection: "desc" }, "name")).toEqual({
      sortFieldId: "",
      sortDirection: "asc",
    });
  });

  it("switches to a new column (ascending) when a different column is clicked", () => {
    expect(cycleGridSort({ sortFieldId: "name", sortDirection: "desc" }, "status")).toEqual({
      sortFieldId: "status",
      sortDirection: "asc",
    });
  });

  it("trims whitespace on the clicked field id", () => {
    expect(cycleGridSort(NO_SORT, "  status  ")).toEqual({
      sortFieldId: "status",
      sortDirection: "asc",
    });
  });

  it("ignores empty / whitespace-only field clicks and returns the current state", () => {
    const current: GridSortState = { sortFieldId: "name", sortDirection: "desc" };
    expect(cycleGridSort(current, "")).toBe(current);
    expect(cycleGridSort(current, "   ")).toBe(current);
  });

  it("cycles deterministically through asc -> desc -> none -> asc", () => {
    let state: GridSortState = NO_SORT;
    state = cycleGridSort(state, "name");
    expect(state).toEqual({ sortFieldId: "name", sortDirection: "asc" });
    state = cycleGridSort(state, "name");
    expect(state).toEqual({ sortFieldId: "name", sortDirection: "desc" });
    state = cycleGridSort(state, "name");
    expect(state).toEqual({ sortFieldId: "", sortDirection: "asc" });
    state = cycleGridSort(state, "name");
    expect(state).toEqual({ sortFieldId: "name", sortDirection: "asc" });
  });
});

describe("app-forge grid sort — gridSortIndicator", () => {
  it("returns 'none' when no column is sorted", () => {
    expect(gridSortIndicator(NO_SORT, "name")).toBe("none");
  });

  it("returns 'none' for columns other than the active one", () => {
    expect(gridSortIndicator({ sortFieldId: "name", sortDirection: "asc" }, "status")).toBe("none");
  });

  it("returns 'asc' for the active ascending column", () => {
    expect(gridSortIndicator({ sortFieldId: "name", sortDirection: "asc" }, "name")).toBe("asc");
  });

  it("returns 'desc' for the active descending column", () => {
    expect(gridSortIndicator({ sortFieldId: "name", sortDirection: "desc" }, "name")).toBe("desc");
  });

  it("returns 'none' for an empty field id even if a sort is active", () => {
    expect(gridSortIndicator({ sortFieldId: "name", sortDirection: "asc" }, "")).toBe("none");
  });
});
