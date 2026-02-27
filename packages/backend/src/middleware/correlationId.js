const { v4: uuidv4 } = require('uuid');
const logger = require('../config/logger');

function correlationId(req, res, next) {
  const id = req.headers['x-correlation-id'] || uuidv4();
  req.correlationId = id;
  res.setHeader('x-correlation-id', id);
  req.logger = logger.child({ correlationId: id });
  next();
}

module.exports = correlationId;
