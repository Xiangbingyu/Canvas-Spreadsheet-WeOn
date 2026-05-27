function createOperationRef({ sourceSeq, docId, clientId } = {}) {
  return {
    sourceSeq,
    docId,
    clientId,
  };
}

module.exports = {
  createOperationRef,
};
