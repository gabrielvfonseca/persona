import { describe, expect, it } from "vitest";
import { extractMessages } from "../src/payload";

describe("extractMessages", () => {
  it("extracts text messages", () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                messages: [
                  {
                    from: "5511999",
                    id: "m1",
                    text: { body: "hi" },
                    timestamp: "123",
                    type: "text",
                  },
                ],
                messaging_product: "whatsapp",
                metadata: {
                  display_phone_number: "+15551234567",
                  phone_number_id: "101",
                },
              },
            },
          ],
          id: "123",
        },
      ],
      object: "whatsapp_business_account",
    };
    const msgs = extractMessages(payload, "101");
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.from).toBe("5511999");
    expect(msgs[0]?.text).toBe("hi");
  });
  it("filters by phone number id", () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                messages: [
                  {
                    from: "5511999",
                    id: "m1",
                    text: { body: "hi" },
                    timestamp: "123",
                    type: "text",
                  },
                ],
                messaging_product: "whatsapp",
                metadata: { phone_number_id: "101" },
              },
            },
          ],
          id: "123",
        },
      ],
      object: "whatsapp_business_account",
    };
    expect(extractMessages(payload, "999")).toHaveLength(0);
  });
  it("skips non-text messages", () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                messages: [
                  {
                    from: "5511999",
                    id: "m1",
                    timestamp: "123",
                    type: "image",
                  },
                ],
                messaging_product: "whatsapp",
                metadata: { phone_number_id: "101" },
              },
            },
          ],
          id: "123",
        },
      ],
      object: "whatsapp_business_account",
    };
    expect(extractMessages(payload, "101")).toHaveLength(0);
  });
});
