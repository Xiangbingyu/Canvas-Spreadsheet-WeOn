const express = require('express');

const { createHttpSuccess } = require('../utils/response');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(
    createHttpSuccess({
      status: 'ok',
    })
  );
});

module.exports = router;
