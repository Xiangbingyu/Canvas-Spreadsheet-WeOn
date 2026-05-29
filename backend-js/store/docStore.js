const storeConfig = require('../config/storeConfig');
const createMemoryDocStore = require('./memory/docMemoryStore');
const createDocMysqlStore = require('./mysql/docMysqlStore');
const { DOC_SEEDS } = require('../db/seed/docSeed');

function createDocStore() {
  const useMysqlStore = storeConfig.driver === 'mysql';
  const store = useMysqlStore
    ? createDocMysqlStore()
    : createMemoryDocStore();

  if (!useMysqlStore && typeof store.seedSync === 'function') {
    store.seedSync(DOC_SEEDS);
  }

  return store;
}

module.exports = createDocStore();
