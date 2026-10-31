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
      chatId: "chat1",
      isGroup: false,
      mentioned: false,
      text: "hello",
    });
    expect(result).toBe("never");
  });

  it("replies when mentioned in direct message with addressed policy", () => {
    const policy = createReplyPolicy();
    const result = policy.shouldReply({
      chatId: "chat1",
      isGroup: false,
      mentioned: true,
      text: "hello bot",
    });
    expect(result).toBe("always");
  });

  it("replies when name mentioned", () => {
    const policy = createReplyPolicy({ names: ["Bot"] });
    const result = policy.shouldReply({
      chatId: "chat1",
      isGroup: false,
      mentioned: false,
      text: "hey Bot",
    });
    expect(result).toBe("always");
  });

  it("direct always mode replies to everything", () => {
    const policy = createReplyPolicy({ direct: "always" });
    const result = policy.shouldReply({
      chatId: "chat1",
      isGroup: false,
      mentioned: false,
      text: "hello",
    });
    expect(result).toBe("always");
  });

  it("direct never mode without mention and no probability", () => {
    const policy = createReplyPolicy({ direct: "never" });
    const result = policy.shouldReply({
      chatId: "chat1",
      isGroup: false,
      mentioned: false,
      text: "hello",
    });
    expect(result).toBe("never");
  });

  it("direct never mode with mention replies always", () => {
    const policy = createReplyPolicy({ direct: "never" });
    const result = policy.shouldReply({
      chatId: "chat1",
      isGroup: false,
      mentioned: true,
      text: "bot",
    });
    expect(result).toBe("always");
  });

  it("group defaults to addressed", () => {
    const policy = createReplyPolicy();
    const result = policy.shouldReply({
      chatId: "group1",
      isGroup: true,
      mentioned: false,
      text: "hello",
    });
    expect(result).toBe("never");
  });

  it("group replies when mentioned", () => {
    const policy = createReplyPolicy();
    const result = policy.shouldReply({
      chatId: "group1",
      isGroup: true,
      mentioned: true,
      text: "hello bot",
    });
    expect(result).toBe("always");
  });

  it("group always mode", () => {
    const policy = createReplyPolicy({ group: "always" });
    const result = policy.shouldReply({
      chatId: "group1",
      isGroup: true,
      mentioned: false,
      text: "hello",
    });
    expect(result).toBe("always");
  });

  it("allowedGroups restricts groups", () => {
    const policy = createReplyPolicy({
      allowedGroups: ["group1"],
      group: "always",
    });
    const result1 = policy.shouldReply({
      chatId: "group1",
      isGroup: true,
      mentioned: false,
      text: "hello",
    });
    const result2 = policy.shouldReply({
      chatId: "group2",
      isGroup: true,
      mentioned: false,
      text: "hello",
    });
    expect(result1).toBe("always");
    expect(result2).toBe("never");
  });

  it("allowedGroups is a hard deny, even when the bot is mentioned", () => {
    const policy = createReplyPolicy({
      allowedGroups: ["group1"],
      group: "always",
      names: ["Ana"],
    });
    expect(
      policy.shouldReply({
        chatId: "group2",
        isGroup: true,
        mentioned: true,
        text: "Ana, are you there?",
      })
    ).toBe("never");
  });

  it("allowedGroups with empty list allows all", () => {
    const policy = createReplyPolicy({
      allowedGroups: [],
      group: "always",
    });
    const result = policy.shouldReply({
      chatId: "group2",
      isGroup: true,
      mentioned: false,
      text: "hello",
    });
    expect(result).toBe("always");
  });

  it("unpromptedProbability triggers randomly", () => {
    const policy = createReplyPolicy({
      direct: "never",
      random: () => 0.5,
      unpromptedProbability: 1.0,
    });
    const result = policy.shouldReply({
      chatId: "chat1",
      isGroup: false,
      mentioned: false,
      text: "hello",
    });
    expect(result).toBe("always");
  });

  it("unpromptedProbability does not trigger when random too high", () => {
    const policy = createReplyPolicy({
      direct: "never",
      random: () => 0.8,
      unpromptedProbability: 0.5,
    });
    const result = policy.shouldReply({
      chatId: "chat1",
      isGroup: false,
      mentioned: false,
      text: "hello",
    });
    expect(result).toBe("never");
  });

  it("mentioned takes precedence", () => {
    const policy = createReplyPolicy({ group: "never", names: ["Bot"] });
    const result = policy.shouldReply({
      chatId: "group1",
      isGroup: true,
      mentioned: false,
      text: "@Bot hello",
    });
    expect(result).toBe("always");
  });
});
