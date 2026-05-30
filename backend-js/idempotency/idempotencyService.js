const eventIdStore = require('./eventIdStore');
const idempotencyConfig = require('../config/idempotencyConfig');

async function getRecord(eventId) {
  if (!eventId) {
    return null;
  }

  return eventIdStore.get(eventId);
}

async function beginProcessing(eventId) {
  if (!eventId) {
    return true;
  }

  return eventIdStore.begin(eventId, {
    ttlMs: idempotencyConfig.ttlMs,
  });
}

async function completeProcessing(eventId, response) {
  if (!eventId) {
    return;
  }

  await eventIdStore.complete(eventId, response, {
    ttlMs: idempotencyConfig.ttlMs,
  });
}

async function waitForCompleted(eventId) {
  if (!eventId) {
    return null;
  }

  const startedAt = Date.now();

  while (Date.now() - startedAt < idempotencyConfig.processingWaitTimeoutMs) {
    const current = await getRecord(eventId);

    if (!current) {
      return null;
    }

    if (current.status === 'completed') {
      return current;
    }

    await new Promise((resolve) => setTimeout(resolve, idempotencyConfig.processingPollIntervalMs));
  }

  return getRecord(eventId);
}

async function deleteRecord(eventId) {
  if (!eventId) {
    return;
  }

  await eventIdStore.delete(eventId);
}

async function close() {
  if (typeof eventIdStore.close === 'function') {
    await eventIdStore.close();
  }
}

module.exports = {
  getRecord,
  beginProcessing,
  completeProcessing,
  waitForCompleted,
  deleteRecord,
  close,
};
