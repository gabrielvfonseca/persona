import { describe, expect, it } from "vitest";
import { createReplyPolicy, mentionsName } from "../src/reply-policy";

describe("mentionsName", () => {
  it("matches exact name", () => {
    expect(mentionsName("hello Alice", "Alice")).toBe(true);
  });

  it("matches with @", () => {
    expect(mentionsName("hello @Alice", "Alice")).toBe(true);
  });

  it("case insensitive", () => {
    expect(mentionsName("hello alice", "Alice")).toBe(true);
    expect(mentionsName("hello ALICE", "Alice")).toBe(true);
  });

  it("does not match partial word", () => {
    expect(mentionsName("hello AliceSmith", "Alice")).toBe(false);
  });

  it("matches at start", () => {
    expect(mentionsName("Alice hello", "Alice")).toBe(true);
  });

  it("matches at end", () => {
    expect(mentionsName("hello Alice", "Alice")).toBe(true);
  });

  it("does not match if not mentioned", () => {
    expect(mentionsName("hello Bob", "Alice")).toBe(false);
  });
});

describe("createReplyPolicy", () => {
  it("defaults to addressed for direct messages", () => {
    const policy = createReplyPolicy();
    const result = policy.shouldReply({
      isGroup: false,
      chatId: "chat1",
      text: "hello",
      mentioned: false,
    });
    expect(result).toBe("never");
  });

  it("replies when mentioned in direct message with addressed policy", () => {
    const policy = createReplyPolicy();
    const result = policy.shouldReply({
      isGroup: false,
      chatId: "chat1",
      text: "hello bot",
      mentioned: true,
    });
    expect(result).toBe("always");
  });

  it("replies when name mentioned", () => {
    const policy = createReplyPolicy({ names: ["Bot"] });
    const result = policy.shouldReply({
      isGroup: false,
      chatId: "chat1",
      text: "hey Bot",
      mentioned: false,
    });
    expect(result).toBe("always");
  });

  it("direct always mode replies to everything", () => {
    const policy = createReplyPolicy({ direct: "always" });
    const result = policy.shouldReply({
      isGroup: false,
      chatId: "chat1",
      text: "hello",
      mentioned: false,
    });
    expect(result).toBe("always");
  });

  it("direct never mode without mention and no probability", () => {
    const policy = createReplyPolicy({ direct: "never" });
    const result = policy.shouldReply({
      isGroup: false,
      chatId: "chat1",
      text: "hello",
      mentioned: false,
    });
    expect(result).toBe("never");
  });

  it("direct never mode with mention replies always", () => {
    const policy = createReplyPolicy({ direct: "never" });
    const result = policy.shouldReply({
      isGroup: false,
      chatId: "chat1",
      text: "bot",
      mentioned: true,
    });
    expect(result).toBe("always");
  });

  it("group defaults to addressed", () => {
    const policy = createReplyPolicy();
    const result = policy.shouldReply({
      isGroup: true,
      chatId: "group1",
      text: "hello",
      mentioned: false,
    });
    expect(result).toBe("never");
  });

  it("group replies when mentioned", () => {
    const policy = createReplyPolicy();
    const result = policy.shouldReply({
      isGroup: true,
      chatId: "group1",
      text: "hello bot",
      mentioned: true,
    });
    expect(result).toBe("always");
  });

  it("group always mode", () => {
    const policy = createReplyPolicy({ group: "always" });
    const result = policy.shouldReply({
      isGroup: true,
      chatId: "group1",
      text: "hello",
      mentioned: false,
    });
    expect(result).toBe("always");
  });

  it("allowedGroups restricts groups", () => {
    const policy = createReplyPolicy({
      group: "always",
      allowedGroups: ["group1"],
    });
    const result1 = policy.shouldReply({
      isGroup: true,
      chatId: "group1",
      text: "hello",
      mentioned: false,
    });
    const result2 = policy.shouldReply({
      isGroup: true,
      chatId: "group2",
      text: "hello",
      mentioned: false,
    });
    expect(result1).toBe("always");
    expect(result2).toBe("never");
  });

  it("allowedGroups is a hard deny, even when the bot is mentioned", () => {
    const policy = createReplyPolicy({
      group: "always",
      names: ["Ana"],
      allowedGroups: ["group1"],
    });
    expect(
      policy.shouldReply({
        isGroup: true,
        chatId: "group2",
        text: "Ana, are you there?",
        mentioned: true,
      }),
    ).toBe("never");
  });

  it("allowedGroups with empty list allows all", () => {
    const policy = createReplyPolicy({
      group: "always",
      allowedGroups: [],
    });
    const result = policy.shouldReply({
      isGroup: true,
      chatId: "group2",
      text: "hello",
      mentioned: false,
    });
    expect(result).toBe("always");
  });

  it("unpromptedProbability triggers randomly", () => {
    const policy = createReplyPolicy({
      direct: "never",
      unpromptedProbability: 1.0,
      random: () => 0.5,
    });
    const result = policy.shouldReply({
      isGroup: false,
      chatId: "chat1",
      text: "hello",
      mentioned: false,
    });
    expect(result).toBe("always");
  });

  it("unpromptedProbability does not trigger when random too high", () => {
    const policy = createReplyPolicy({
      direct: "never",
      unpromptedProbability: 0.5,
      random: () => 0.8,
    });
    const result = policy.shouldReply({
      isGroup: false,
      chatId: "chat1",
      text: "hello",
      mentioned: false,
    });
    expect(result).toBe("never");
  });

  it("mentioned takes precedence", () => {
    const policy = createReplyPolicy({ names: ["Bot"], group: "never" });
    const result = policy.shouldReply({
      isGroup: true,
      chatId: "group1",
      text: "@Bot hello",
      mentioned: false,
    });
    expect(result).toBe("always");
  });
});
