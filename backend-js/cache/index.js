const cacheStore = require('./cacheStore');

async function close() {
  await cacheStore.close();
}

module.exports = {
  close,
};
