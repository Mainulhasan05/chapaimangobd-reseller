'use strict';

const { z } = require('zod');

/**
 * The preferences screen sends back the rows it changed, or all of them. Each
 * channel is optional so a row can change one switch. Event types are checked
 * against the signed-in role by the service, not here.
 */
const updatePreferences = z.object({
  events: z
    .array(
      z
        .object({
          eventType: z.string().trim().min(1).max(60),
          push: z.boolean().optional(),
          telegram: z.boolean().optional(),
          sms: z.boolean().optional(),
        })
        .strict()
    )
    .min(1)
    .max(50),
});

module.exports = { updatePreferences };
