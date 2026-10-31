/** Lists the WhatsApp groups this linked device is in, with their JIDs. */
import { listGroups, withSocket } from "@persona/whatsapp";
import { parseConfig } from "../src/config";

const config = parseConfig(process.env);

const groups = await withSocket((sock) => listGroups(sock), {
  authDir: config.AUTH_DIR,
});
for (const g of groups) {
  console.log(`${g.id}\t${g.participants}\t${g.subject}`);
}
