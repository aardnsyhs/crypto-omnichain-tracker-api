const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { BlockchairClient } = require('../dist/src/providers/blockchair/blockchair.client');
async function main() {
  let status = 200;
  let body = { data: null };
  let hang = false;
  const server = http.createServer((req, res) => {
    if (hang) return;
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  process.env.BLOCKCHAIR_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.BLOCKCHAIR_TIMEOUT_MS = '100';
  const client = new BlockchairClient();
  try {
    assert.equal((await client.fetchGlobalStats()).data, null);
    for (const code of [402, 429]) {
      status = code;
      assert.equal((await client.fetchGlobalStats()).isRateLimited, true);
      assert.equal((await client.fetchChainStats('bitcoin')).statusCode, code);
      await assert.rejects(
        client.fetchTransaction('ethereum', '0x' + 'a'.repeat(64)),
        (error) => error.code === 'UPSTREAM_RATE_LIMITED',
      );
      status = 200;
      body = { data: null, context: { code } };
      assert.equal((await client.fetchGlobalStats()).isRateLimited, true);
    }
    hang = true;
    await assert.rejects(
      client.fetchTransaction('ethereum', '0x' + 'b'.repeat(64)),
      (error) => error.code === 'UPSTREAM_TIMEOUT',
    );
    assert.equal((await client.fetchGlobalStats()).data, null);
    console.log(
      'PASS: actual Axios provider contract, data:null, HTTP 402/429, provider quota context, transaction and stats timeout.',
    );
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
