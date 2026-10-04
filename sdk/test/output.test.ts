import { describe, expect, it } from "vitest";
import { assistantOutput } from "../src/output.js";

describe("assistantOutput", () => {
  it("is the text when there is text", () => expect(assistantOutput({ content: "Mars" })).toBe("Mars"));

  it("is the JCS of tool_calls when the answer is only tool calls", () => {
    const calls = [{ type: "function", id: "c1", function: { name: "get_weather", arguments: '{"city":"Paris"}' } }];
    expect(assistantOutput({ content: null, tool_calls: calls })).toBe(
      '[{"function":{"arguments":"{\\"city\\":\\"Paris\\"}","name":"get_weather"},"id":"c1","type":"function"}]',
    );
  });

  it("keeps an empty string as the output, and is undefined with nothing at all", () => {
    expect(assistantOutput({ content: "" })).toBe("");
    expect(assistantOutput({ content: null })).toBeUndefined();
    expect(assistantOutput(undefined)).toBeUndefined();
  });
});
