const express = require('express');

const { createHttpError } = require('../utils/response');

const router = express.Router();

router.post('/', async (req, res) => {
  // TODO: create document and persist into in-memory docs store.
  res.status(501).json(createHttpError(5000, 'POST /docs is not implemented yet'));
});

module.exports = router;
