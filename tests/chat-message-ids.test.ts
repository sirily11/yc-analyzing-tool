import { describe, expect, it } from "vitest";
import { streamText, type UIMessage } from "ai";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";

/**
 * The chat route persists onFinish's messages straight into a NOT NULL primary key,
 * so every message it hands back must carry an id. streamText's toUIMessageStream
 * only assigns one to the response message when generateMessageId is supplied, or
 * when the last original message is already an assistant message.
 */
async function finishedMessages(options: { generateMessageId?: () => string }) {
  const originalMessages: UIMessage[] = [
    { id: "user-1", role: "user", parts: [{ type: "text", text: "hi" }] },
  ];

  const model = new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream<LanguageModelV3StreamPart>({
        chunks: [
          { type: "text-start", id: "t1" },
          { type: "text-delta", id: "t1", delta: "hello" },
          { type: "text-end", id: "t1" },
          {
            type: "finish",
            finishReason: { unified: "stop", raw: "stop" },
            usage: {
              inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: 1, text: 1, reasoning: 0 },
            },
          },
        ],
        chunkDelayInMs: 0,
      }),
    }),
  });

  let finished: UIMessage[] = [];
  const stream = streamText({ model, prompt: "hi" }).toUIMessageStream({
    originalMessages,
    ...options,
    onFinish: ({ messages }) => { finished = messages as UIMessage[]; },
  });

  for await (const _ of stream) { /* drain so onFinish runs */ }
  return finished;
}

describe("chat stream message ids", () => {
  it("gives the assistant response message an id when one is generated", async () => {
    let counter = 0;
    const finished = await finishedMessages({ generateMessageId: () => `generated-${++counter}` });

    expect(finished.map((message) => message.role)).toEqual(["user", "assistant"]);
    for (const message of finished) expect(message.id).toBeTruthy();
  });

  it("leaves the response message without an id otherwise", async () => {
    const finished = await finishedMessages({});

    // Regression guard: this is the shape that violated the messages primary key,
    // so the route must always pass generateMessageId.
    expect(finished.at(-1)?.role).toBe("assistant");
    expect(finished.at(-1)?.id).toBeFalsy();
  });
});
