function allocateSeq(doc) {
  // TODO: replace with centralized seq allocation when real logic is added.
  return doc && typeof doc.seq === 'number' ? doc.seq + 1 : 1;
}

function buildBroadcastPayload(type, data) {
  return {
    type,
    data,
  };
}

module.exports = {
  allocateSeq,
  buildBroadcastPayload,
};
