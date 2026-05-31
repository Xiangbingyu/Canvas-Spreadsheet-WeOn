function applyHttpSecurity(app) {
  app.use((req, res, next) => {
    // Minimal CORS support for the backend test page and cross-origin API debugging.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }

    next();
  });

  return app;
}

module.exports = {
  applyHttpSecurity,
};
