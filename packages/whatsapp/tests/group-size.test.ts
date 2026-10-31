import { describe, expect, it, vi } from "vitest";
import { createGroupSizeLookup } from "../src/groups";

function socketWithGroup(participants: number) {
  const groupMetadata = vi.fn((_jid: string) =>
    Promise.resolve({
      participants: Array.from({ length: participants }, (_, i) => ({
        id: `${i}`,
      })),
    })
  );
  return { groupMetadata, sock: { groupMetadata } };
}

describe("createGroupSizeLookup", () => {
  it("reports the member count of a group", async () => {
    const { sock } = socketWithGroup(4);
    const size = createGroupSizeLookup(sock);
    expect(await size("123@g.us")).toBe(4);
  });

  it("fetches each group once within the TTL", async () => {
    const { sock, groupMetadata } = socketWithGroup(3);
    let now = 0;
    const size = createGroupSizeLookup(sock, { now: () => now, ttlMs: 1000 });
    await size("g@g.us");
    now = 999;
    await size("g@g.us");
    expect(groupMetadata).toHaveBeenCalledTimes(1);
    now = 1000;
    await size("g@g.us");
    expect(groupMetadata).toHaveBeenCalledTimes(2);
  });

  it("returns undefined when the group cannot be read", async () => {
    const sock = {
      groupMetadata: (_jid: string): Promise<{ participants: unknown[] }> =>
        Promise.reject(new Error("not in group")),
    };
    expect(await createGroupSizeLookup(sock)("g@g.us")).toBeUndefined();
  });
});
