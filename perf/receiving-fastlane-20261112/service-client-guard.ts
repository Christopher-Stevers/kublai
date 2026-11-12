// Operational fixture guard only; copied into the disposable validation tree.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

export async function assertPrivateClient(conn: any) {
  const socket = process.env.PURCHASE_TEST_SOCKET;
  const evidence = process.env.RECEIVING_RC_EVIDENCE;
  assert(socket && /^\/tmp\/foremanhq-purchase-pg\.[A-Za-z0-9]+$/.test(socket));
  assert(evidence && path.isAbsolute(evidence));
  const owner = JSON.parse(await fs.readFile(path.join(socket, "owner.json"), "utf8"));
  assert.equal(owner.socket, socket);
  assert.equal(owner.user, "receiving_rc_fixture");
  assert.equal(conn.options.path, `${socket}/.s.PGSQL.55461`);
  assert.deepEqual(conn.options.port, [55461]);
  assert.equal(conn.options.database, "purchase_integration");
  assert.equal(conn.options.user, owner.user);
  assert.equal(conn.options.ssl, false);
  assert.equal(conn.options.fetch_types, false);
  // The constructor options are checked BEFORE this first read-only SQL.
  const [actual] = await conn`select current_database() as database,
    current_user as username, inet_server_addr() as address,
    current_setting('port') as port, current_setting('data_directory') as directory,
    current_setting('unix_socket_directories') as sockets`;
  assert.equal(actual.database, "purchase_integration");
  assert.equal(actual.username, owner.user);
  assert.equal(actual.address, null);
  assert.equal(actual.port, "55461");
  assert.equal(await fs.realpath(actual.directory), await fs.realpath(path.join(socket, "data")));
  assert.equal(actual.sockets, socket);
  await fs.writeFile(path.join(evidence, "actual-client.json"), JSON.stringify({
    constructorCheckedBeforeSql: true, identityCheckedBeforeFixtureSql: true,
    ...actual, clientPath: conn.options.path,
  }, null, 2), { flag: "wx" });
}
