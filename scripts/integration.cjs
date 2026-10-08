const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Test } = require('@nestjs/testing');
const { ValidationPipe } = require('@nestjs/common');
const cookieParser = require('cookie-parser');
const request = require('supertest');
const { AppModule } = require('../dist/src/app.module');
const { PrismaService } = require('../dist/src/database/prisma.service');
const { CacheService } = require('../dist/src/cache/cache.service');
const { BlockchairClient } = require('../dist/src/providers/blockchair/blockchair.client');
const { EvmRpcService } = require('../dist/src/providers/rpc/evm-rpc.service');
const { HttpExceptionFilter } = require('../dist/src/common/filters/http-exception.filter');
const {
  ETHEREUM_SUCCESS_FIXTURE,
  ETHEREUM_SUCCESS_HASH,
} = require('../dist/src/providers/blockchair/fixtures/ethereum-success.fixture');

async function main() {
  if (process.env.NODE_ENV !== 'test' || !process.env.DATABASE_URL || !process.env.REDIS_URL)
    throw new Error('Use NODE_ENV=test with isolated DATABASE_URL and REDIS_URL.');
  let providerCalls = 0;
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(BlockchairClient)
    .useValue({
      fetchTransaction: async () => {
        providerCalls++;
        await new Promise((resolve) => setTimeout(resolve, 30));
        return { data: ETHEREUM_SUCCESS_FIXTURE, statusCode: 200, durationMs: 30 };
      },
      fetchGlobalStats: async () => ({
        data: null,
        statusCode: 429,
        isRateLimited: true,
        durationMs: 1,
      }),
    })
    .overrideProvider(EvmRpcService)
    .useValue({
      enrichTransaction: async () => ({
        receipt: null,
        transaction: null,
        inputData: null,
        gasUsed: null,
        status: 'unknown',
        logs: [],
        tokenMetadataMap: new Map(),
        temporaryFailure: false,
      }),
    })
    .compile();
  const app = module.createNestApplication({ logger: false });
  app.set('trust proxy', false);
  app.use(cookieParser('integration-only-secret'));
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.setGlobalPrefix('v1', { exclude: ['health/{*path}'] });
  await app.init();
  const db = app.get(PrismaService);
  const cache = app.get(CacheService);
  const api = () => request(app.getHttpServer());
  try {
    const count = await db.userSession.count();
    for (let i = 0; i < 35; i++) {
      const live = await api().get('/health/live').expect(200);
      assert.equal(live.headers['set-cookie'], undefined);
    }
    assert.equal(await db.userSession.count(), count);
    const ready = await api().get('/health/ready').expect(200);
    assert.equal(ready.body.status, 'ready');
    const healthy = db.isHealthy.bind(db);
    db.isHealthy = async () => false;
    const down = await api().get('/health/ready').expect(503);
    assert.equal(down.body.status, 'unavailable');
    db.isHealthy = healthy;
    const ping = cache.ping.bind(cache);
    cache.ping = async () => false;
    assert.equal((await api().get('/health/ready').expect(200)).body.status, 'degraded');
    cache.ping = ping;
    await api().get('/v1/overview').expect(200);
    assert.equal(await db.userSession.count(), count);

    const a = await api().get('/v1/session').expect(204);
    const b = await api().get('/v1/session').expect(204);
    const cookieA = a.headers['set-cookie'][0].split(';')[0];
    const cookieB = b.headers['set-cookie'][0].split(';')[0];
    assert.notEqual(cookieA, cookieB);
    await cache.del(`transaction:v2:ethereum:${ETHEREUM_SUCCESS_HASH}`);
    const ids = [randomUUID(), randomUUID()];
    const [one, two] = await Promise.all(
      [cookieA, cookieB].map((cookie, i) =>
        api()
          .post('/v1/transactions/lookup')
          .set('Cookie', cookie)
          .set('x-request-id', ids[i])
          .send({ chain: 'ethereum', transactionHash: ETHEREUM_SUCCESS_HASH })
          .expect(200),
      ),
    );
    assert.equal(providerCalls, 1);
    assert.equal(one.body.meta.requestId, ids[0]);
    assert.equal(two.body.meta.requestId, ids[1]);
    assert.equal(await db.apiRequestLog.count({ where: { requestId: { in: ids } } }), 2);
    const historyA = (await api().get('/v1/history').set('Cookie', cookieA).expect(200)).body.data;
    const historyB = (await api().get('/v1/history').set('Cookie', cookieB).expect(200)).body.data;
    assert.equal(historyA.length, 1);
    assert.equal(historyB.length, 1);
    assert.notEqual(historyA[0].id, historyB[0].id);
    const unsigned = decodeURIComponent(cookieA.split('=')[1]).slice(2).split('.')[0];
    const invalid = await api()
      .get('/v1/history')
      .set('Cookie', `omnichain_session=${unsigned}`)
      .expect(200);
    assert.deepEqual(invalid.body.data, []);
    const tampered = await api()
      .get('/v1/history')
      .set('Cookie', cookieA + 'tampered')
      .expect(200);
    assert.deepEqual(tampered.body.data, []);
    await api()
      .post('/v1/transactions/lookup')
      .set('Cookie', cookieA)
      .send({ chain: 'ethereum', transactionHash: ETHEREUM_SUCCESS_HASH, refresh: true })
      .expect(200);
    const cooldown = await api()
      .post('/v1/transactions/lookup')
      .set('Cookie', cookieA)
      .send({ chain: 'ethereum', transactionHash: ETHEREUM_SUCCESS_HASH, refresh: true })
      .expect(429);
    assert.ok(cooldown.headers['retry-after']);

    let limited = false;
    for (let i = 0; i < 35; i++) {
      const response = await api()
        .get('/v1/history')
        .set('Cookie', cookieA)
        .set('X-Forwarded-For', `203.0.113.${i + 1}`);
      if (response.status === 429) {
        limited = true;
        assert.equal(response.body.error.code, 'RATE_LIMIT_EXCEEDED');
        assert.ok(response.headers['retry-after']);
        break;
      }
    }
    assert.ok(limited, 'untrusted forwarded headers must not evade the actual throttler');
    app.set('trust proxy', ['127.0.0.1/32', '::1/128']);
    await api()
      .get('/v1/history')
      .set('Cookie', cookieA)
      .set('X-Forwarded-For', '203.0.113.200, 198.51.100.10')
      .expect(200);
    for (let i = 0; i < 31; i++)
      await api()
        .get('/v1/history')
        .set('Cookie', cookieA)
        .set('X-Forwarded-For', `203.0.113.${i + 1}, 198.51.100.10`);
    await api()
      .get('/v1/history')
      .set('Cookie', cookieA)
      .set('X-Forwarded-For', '203.0.113.240, 198.51.100.10')
      .expect(429);
    await api()
      .get('/v1/history')
      .set('Cookie', cookieA)
      .set('X-Forwarded-For', '198.51.100.11')
      .expect(200);
    console.log(
      'PASS: real PostgreSQL/Redis, health, session bootstrap, signed-cookie rejection, concurrent lookup and telemetry, history isolation, refresh cooldown, actual throttler and proxy spoofing.',
    );
  } finally {
    await app.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
