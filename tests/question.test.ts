import { describe, expect, it } from "vitest";
import { questionInputSchema, questionOutputSchema } from "@/lib/ai/question";

describe("question tool schemas", () => {
  it("supports single-select questions with UI-provided custom answers", () => {
    expect(questionInputSchema.safeParse({
      type: "single-select",
      question: "Which market should we prioritize?",
      options: [{ id: "smb", label: "SMB" }, { id: "enterprise", label: "Enterprise" }],
      otherPlaceholder: "Another market",
    }).success).toBe(true);
    expect(questionOutputSchema.safeParse({ type: "single-select", answer: "Mid-market", selectedOptionId: null }).success).toBe(true);
  });

  it("supports multiple-select and free-form questions", () => {
    expect(questionInputSchema.safeParse({
      type: "multiple-select",
      question: "Which channels are active?",
      options: [{ id: "sales", label: "Sales" }, { id: "partners", label: "Partners" }],
    }).success).toBe(true);
    expect(questionOutputSchema.safeParse({ type: "multiple-select", answers: ["Sales", "Partners"] }).success).toBe(true);
    expect(questionInputSchema.safeParse({ type: "free-form", question: "What changed?", multiline: true }).success).toBe(true);
    expect(questionOutputSchema.safeParse({ type: "free-form", answer: "We launched in June." }).success).toBe(true);
  });

  it("rejects choice questions without enough options", () => {
    expect(questionInputSchema.safeParse({ type: "single-select", question: "Choose", options: [{ id: "one", label: "One" }] }).success).toBe(false);
    expect(questionOutputSchema.safeParse({ type: "multiple-select", answers: [] }).success).toBe(false);
  });
});
