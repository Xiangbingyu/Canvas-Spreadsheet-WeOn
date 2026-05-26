const HTTP_RESPONSE_SCHEMA = {
  code: 'number',
  message: 'string',
  data: 'object|null',
};

const WS_RESPONSE_SCHEMA = {
  type: 'string',
  code: 'number',
  message: 'string',
  data: 'object|null',
};

module.exports = {
  HTTP_RESPONSE_SCHEMA,
  WS_RESPONSE_SCHEMA,
};
