import { describe, expect, it } from "vitest";
import { stripEphemeralParts } from "@/lib/privacy";

describe("message persistence privacy", () => {
  it("replaces raw document text with a non-retention marker", () => {
    const parts = stripEphemeralParts([{ type: "text", text: "Uploaded plan.pdf" }, { type: "data-document-text", data: { text: "private plan" } }]);
    expect(JSON.stringify(parts)).not.toContain("private plan");
    expect(parts[1]).toEqual({ type: "data-document-status", data: { retained: false } });
  });
});
