const createMemoryDocStore = require('./memory/docMemoryStore');
const { DOC_SEEDS } = require('./seed/docSeed');

function createDocStore() {
  const store = createMemoryDocStore();
  store.seedSync(DOC_SEEDS);
  return store;
}

module.exports = createDocStore();
