const assert = require('node:assert/strict');
const { once } = require('node:events');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.resolve(__dirname, '..');

async function closeProjectResources() {
  const cacheModulePath = path.join(projectRoot, 'cache', 'index.js');

  if (require.cache[cacheModulePath]) {
    await require(cacheModulePath).close();
  }
}

function clearBackendRequireCache() {
  for (const modulePath of Object.keys(require.cache)) {
    if (
      modulePath.startsWith(projectRoot) &&
      !modulePath.includes(`${path.sep}node_modules${path.sep}`) &&
      modulePath !== __filename
    ) {
      delete require.cache[modulePath];
    }
  }
}

async function createTestServer() {
  await closeProjectResources();
  clearBackendRequireCache();

  const app = require('../app');
  const server = app.listen(0);

  await once(server, 'listening');

  const { port } = server.address();

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    async close() {
      server.close();
      await once(server, 'close');
    },
  };
}

test('GET /api-test serves the backend api test page', async () => {
  const server = await createTestServer();

  try {
    const response = await fetch(`${server.baseUrl}/api-test`);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /text\/html/);
    assert.match(html, /Backend API Test Page/);
    assert.match(html, /join, presence, set_cell, set_title, add_sheet, import_sheet, undo, redo/);
    assert.match(html, /method:\s*'GET'/);
    assert.match(html, /path:\s*'\/docs'/);
    assert.match(html, /method:\s*'POST'/);
  } finally {
    await server.close();
  }
});
