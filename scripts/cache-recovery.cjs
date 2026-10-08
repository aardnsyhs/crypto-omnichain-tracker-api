const assert = require('node:assert/strict');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { CacheService } = require('../dist/src/cache/cache.service');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(check) {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await delay(100);
  }
  throw new Error('Recovery timed out');
}
async function main() {
  const reservation = net.createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const start = () =>
    spawn(
      'redis-server',
      ['--bind', '127.0.0.1', '--port', String(port), '--save', '', '--appendonly', 'no'],
      { stdio: 'ignore' },
    );
  process.env.REDIS_URL = `redis://127.0.0.1:${port}`;
  let server = start();
  const cache = new CacheService();
  try {
    await cache.onModuleInit();
    await waitFor(() => cache.ping());
    assert.equal(await cache.set('recovery-test', { ok: true }, 10), true);
    assert.deepEqual(await cache.get('recovery-test'), { ok: true });
    server.kill('SIGTERM');
    await once(server, 'exit');
    await waitFor(() => !cache.isHealthy());
    assert.equal(await cache.get('recovery-test'), null);
    assert.equal(await cache.ping(), false);
    server = start();
    await waitFor(() => cache.ping());
    assert.equal(await cache.set('after-outage', { ok: true }, 10), true);
    assert.deepEqual(await cache.get('after-outage'), { ok: true });
    console.log('PASS: Redis outage bypass and automatic reconnect without application restart.');
  } finally {
    await cache.onModuleDestroy();
    server.kill('SIGTERM');
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
