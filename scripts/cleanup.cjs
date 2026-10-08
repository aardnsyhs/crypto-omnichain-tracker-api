require('dotenv/config');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');

async function main() {
  const args = process.argv.slice(2);
  if (
    args.some((arg) => !['--execute', '--dry-run'].includes(arg)) ||
    (args.includes('--execute') && args.includes('--dry-run'))
  )
    throw new Error('Use --dry-run (default) or --execute.');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
  const execute = args.includes('--execute');
  const batch = 500;
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 2000,
    statement_timeout: 5000,
  });
  const db = new PrismaClient({ adapter: new PrismaPg(pool) });
  const cutoff = new Date(Date.now() - 30 * 86400000);
  try {
    // Prune children first; only delete childless sessions to keep cascading deletes bounded.
    const history = await db.searchHistory.findMany({
      where: {
        OR: [{ searchedAt: { lt: cutoff } }, { userSession: { expiresAt: { lt: new Date() } } }],
      },
      orderBy: { searchedAt: 'asc' },
      take: batch,
      select: { id: true },
    });
    const logs = await db.apiRequestLog.findMany({
      where: { createdAt: { lt: cutoff } },
      orderBy: { createdAt: 'asc' },
      take: batch,
      select: { id: true },
    });
    const sessions = await db.userSession.findMany({
      where: { expiresAt: { lt: new Date() }, searchHistories: { none: {} } },
      orderBy: { expiresAt: 'asc' },
      take: batch,
      select: { id: true },
    });
    console.log(
      JSON.stringify({
        mode: execute ? 'execute' : 'dry-run',
        limitPerTable: batch,
        history: history.length,
        logs: logs.length,
        expiredChildlessSessions: sessions.length,
      }),
    );
    if (execute) {
      await db.$transaction([
        db.searchHistory.deleteMany({ where: { id: { in: history.map((v) => v.id) } } }),
        db.apiRequestLog.deleteMany({ where: { id: { in: logs.map((v) => v.id) } } }),
        db.userSession.deleteMany({
          where: {
            id: { in: sessions.map((v) => v.id) },
            expiresAt: { lt: new Date() },
            searchHistories: { none: {} },
          },
        }),
      ]);
    }
  } finally {
    await db.$disconnect();
    await pool.end();
  }
}
main().catch(() => {
  console.error(
    'Cleanup failed. Check DATABASE_URL, database availability, and schema. No credentials are logged.',
  );
  process.exitCode = 1;
});
