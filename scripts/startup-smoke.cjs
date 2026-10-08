const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { randomBytes } = require('node:crypto');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function main() {
  const base = {
    ...process.env,
    NODE_ENV: 'production',
    SESSION_SECRET: randomBytes(32).toString('hex'),
    WEB_ORIGIN: 'https://tracker.ardiansyah.app',
    API_HOST: '127.0.0.1',
    PORT: '54009',
    DOTENV_CONFIG_PATH: '/nonexistent/tracker-smoke-env',
  };
  const invalid = spawn(process.execPath, ['dist/src/main.js'], {
    env: { ...base, SESSION_SECRET: 'dev-insecure-session-secret-change-in-prod' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let invalidLog = '';
  invalid.stderr.on('data', (data) => {
    invalidLog += data;
  });
  const [invalidCode] = await once(invalid, 'exit');
  assert.equal(invalidCode, 1);
  assert.match(invalidLog, /SESSION_SECRET/);
  const child = spawn(process.execPath, ['dist/src/main.js'], {
    env: base,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (data) => {
    output += data;
  });
  child.stderr.on('data', (data) => {
    output += data;
  });
  try {
    let response;
    for (let i = 0; i < 80; i++) {
      if (child.exitCode !== null) break;
      try {
        response = await fetch('http://127.0.0.1:54009/health/ready', {
          signal: AbortSignal.timeout(3000),
        });
        if (response.ok) break;
      } catch {}
      await delay(100);
    }
    assert.equal(response?.status, 200, output);
    const initialized = await fetch('http://127.0.0.1:54009/v1/session', {
      headers: { Origin: base.WEB_ORIGIN },
    });
    assert.equal(initialized.status, 204);
    assert.match(initialized.headers.get('set-cookie'), /Secure/);
    assert.match(initialized.headers.get('set-cookie'), /HttpOnly/);
    assert.equal(initialized.headers.get('access-control-allow-origin'), base.WEB_ORIGIN);
    console.log(
      'PASS: production entrypoint, fail-fast invalid secret, readiness, CORS, Secure/HttpOnly session cookie.',
    );
  } finally {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await once(child, 'exit');
    }
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
