import { describe, expect, it } from "vitest";
import { extractMessages } from "../../src/cloud/payload";

describe("extractMessages", () => {
  it("extracts text messages", () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "123",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: {
                  display_phone_number: "+15551234567",
                  phone_number_id: "101",
                },
                messages: [
                  {
                    from: "5511999",
                    id: "m1",
                    timestamp: "123",
                    type: "text",
                    text: { body: "hi" },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const msgs = extractMessages(payload, "101");
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.from).toBe("5511999");
    expect(msgs[0]?.text).toBe("hi");
  });
  it("filters by phone number id", () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "123",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: { phone_number_id: "101" },
                messages: [
                  {
                    from: "5511999",
                    id: "m1",
                    timestamp: "123",
                    type: "text",
                    text: { body: "hi" },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    expect(extractMessages(payload, "999")).toHaveLength(0);
  });
  it("skips non-text messages", () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "123",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: { phone_number_id: "101" },
                messages: [
                  {
                    from: "5511999",
                    id: "m1",
                    timestamp: "123",
                    type: "image",
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    expect(extractMessages(payload, "101")).toHaveLength(0);
  });
});
