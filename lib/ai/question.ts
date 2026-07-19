import { z } from "zod";

export const questionOptionSchema = z.object({
  id: z.string().min(1).max(60),
  label: z.string().min(1).max(120),
  description: z.string().min(1).max(200).optional(),
});

const questionBaseSchema = z.object({
  question: z.string().min(1).max(300),
});

export const questionInputSchema = z.discriminatedUnion("type", [
  questionBaseSchema.extend({
    type: z.literal("single-select"),
    options: z.array(questionOptionSchema).min(2).max(10),
    otherPlaceholder: z.string().min(1).max(100).optional(),
  }),
  questionBaseSchema.extend({
    type: z.literal("multiple-select"),
    options: z.array(questionOptionSchema).min(2).max(12),
  }),
  questionBaseSchema.extend({
    type: z.literal("free-form"),
    placeholder: z.string().min(1).max(120).optional(),
    multiline: z.boolean().optional(),
  }),
]);

export const questionOutputSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("single-select"), answer: z.string().min(1), selectedOptionId: z.string().min(1).nullable() }),
  z.object({ type: z.literal("multiple-select"), answers: z.array(z.string().min(1)).min(1) }),
  z.object({ type: z.literal("free-form"), answer: z.string().min(1) }),
]);

export type QuestionInput = z.infer<typeof questionInputSchema>;
export type QuestionOutput = z.infer<typeof questionOutputSchema>;
