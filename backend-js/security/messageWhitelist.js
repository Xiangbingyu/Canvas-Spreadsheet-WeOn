const { WS_MESSAGE_TYPES } = require('../protocol/messageTypes');

const WS_MESSAGE_WHITELIST = new Set(Object.values(WS_MESSAGE_TYPES));

module.exports = {
  WS_MESSAGE_WHITELIST,
};
