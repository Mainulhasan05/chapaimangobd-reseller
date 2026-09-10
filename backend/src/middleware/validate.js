'use strict';

const { badRequest } = require('../utils/errors');

/**
 * One zod schema per endpoint, applied here. Controllers never re-check shapes.
 * Parsed output replaces the raw input, so a controller cannot accidentally read
 * an unvalidated field.
 */
function validate(schemas) {
  return (req, _res, next) => {
    try {
      ['body', 'query', 'params'].forEach((part) => {
        if (!schemas[part]) return;
        const result = schemas[part].safeParse(req[part]);
        if (!result.success) {
          const fields = {};
          result.error.issues.forEach((issue) => {
            const key = issue.path.join('.') || part;
            if (!fields[key]) fields[key] = issue.message;
          });
          throw badRequest('VALIDATION_FAILED', 'Some fields are invalid', fields);
        }
        // req.query is a getter on newer Express; assign through defineProperty.
        Object.defineProperty(req, part, { value: result.data, writable: true, configurable: true });
      });
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = validate;
