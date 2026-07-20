import { createClient } from "@libsql/client";

const chatId = process.argv[2];
const client = createClient({
  url: process.env.TURSO_DATABASE_URL || "file:local.db",
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const chat = await client.execute({ sql: "select id, title, updated_at from chats where id = ?", args: [chatId] });
console.log("chat:", chat.rows);

const msgs = await client.execute({ sql: "select id, role, sequence, created_at from messages where chat_id = ? order by sequence", args: [chatId] });
console.log("messages:", msgs.rows);

const recent = await client.execute("select chat_id, count(*) n, max(created_at) last from messages group by chat_id order by last desc limit 5");
console.log("recent chats with messages:", recent.rows);

const res = await client.execute("select id, feature, status, reserved_points, settled_points, created_at from credit_reservations order by created_at desc limit 5");
console.log("reservations:", res.rows);

const usage = await client.execute("select feature, model, status, cost_nano_usd, charged_points, created_at from usage_events order by created_at desc limit 5");
console.log("usage_events:", usage.rows);
