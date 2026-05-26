function createRateLimiter() {
  // TODO: implement in-memory limiter first, then upgrade to Redis if needed.
  return {
    allow() {
      return true;
    },
  };
}

module.exports = {
  createRateLimiter,
};
