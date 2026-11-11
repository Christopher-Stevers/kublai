import fs from "node:fs";
import path from "node:path";
import os from "node:os";
export function privateChatOptions() {
  const socket = process.env.CHAT_OVERVIEW_TEST_SOCKET;
  if (
    !socket ||
    !/^\/tmp\/foremanhq-chat-overview-pg\.[A-Za-z0-9]+$/.test(socket) ||
    fs.realpathSync(socket) !== socket
  )
    throw Error("Refusing unowned private socket");
  const stat = fs.statSync(socket),
    owner = JSON.parse(
      fs.readFileSync(path.join(socket, "owner.json"), "utf8"),
    );
  if (
    stat.uid !== process.getuid() ||
    owner.socket !== socket ||
    owner.database !== "chat_overview_proof" ||
    owner.port !== 55471 ||
    !Number.isSafeInteger(owner.pid)
  )
    throw Error("Private ownership mismatch");
  process.kill(owner.pid, 0);
  return {
    host: socket,
    port: 55471,
    database: "chat_overview_proof",
    user: os.userInfo().username,
    ssl: false,
    max: 1,
    connect_timeout: 3,
  };
}
export function assertClientOptions(client, options) {
  if (
    !client.options.host.includes(options.host) ||
    client.options.host.length !== 1 ||
    client.options.port.length !== 1 ||
    client.options.port.some((p) => Number(p) !== options.port) ||
    client.options.path !== options.host + "/.s.PGSQL." + options.port ||
    client.options.ssl !== false ||
    client.options.user !== options.user ||
    client.options.database !== options.database
  )
    throw Error("Actual client options not private");
}
export async function assertServerIdentity(client, options) {
  const [row] =
    await client`select current_database() as database, inet_server_addr()::text as address, current_setting('data_directory') as data_directory`;
  if (
    row.database !== options.database ||
    row.address !== null ||
    row.data_directory !== options.host + "/data"
  )
    throw Error("Server identity not private");
  return row;
}
