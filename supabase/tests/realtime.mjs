// Started by hosted_workflows.py with two short-lived fixture sessions on stdin.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const { url, key, owner, other, id } = JSON.parse(readFileSync(0, "utf8"));
if (new URL(url).hostname !== "mbilemzzpoxdwujyswfk.supabase.co")
  throw Error("Wrong project");
const clients = [];
let delivered = false,
  leaked = false;
async function listen(token, receive) {
  const client = createClient(url, key, { accessToken: async () => token });
  clients.push(client);
  await client.realtime.setAuth(token);
  await new Promise((resolve, reject) => {
    client
      .channel("request-" + id)
      .on("system", {}, (message) => {
        if (message.extension !== "postgres_changes") return;
        if (message.status === "ok") resolve();
        else if (message.status === "error")
          reject(Error("Postgres subscription: " + message.message));
      })
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "requests",
          filter: "id=eq." + id,
        },
        receive,
      )
      .subscribe((status) => {
        if (["CHANNEL_ERROR", "TIMED_OUT"].includes(status))
          reject(Error(status));
      });
  });
}
const deadline = setTimeout(() => process.exit(2), 35000);
try {
  await Promise.all([
    listen(owner, () => {
      delivered = true;
    }),
    listen(other, () => {
      leaked = true;
    }),
  ]);
  console.log("ready");
  for (let i = 0; i < 100 && !delivered; i++)
    await new Promise((resolve) => setTimeout(resolve, 200));
  await new Promise((resolve) => setTimeout(resolve, 1200));
  if (leaked) throw Error("Unrelated customer received a private change");
  if (!delivered) throw Error("Owner did not receive the expected update");
  console.log("verified");
} finally {
  clearTimeout(deadline);
  await Promise.all(clients.map((c) => c.removeAllChannels()));
  clients.forEach((c) => c.realtime.disconnect());
}
// Node's WebSocket transport can keep an idle handle after the acknowledged leave.
process.exit(0);
