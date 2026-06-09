const { z } = require('zod');

/**
 * Schema Zod para o response da API de token OAuth2 do Salesforce.
 */
const salesforceTokenResponseSchema = z.object({
  access_token: z.string(),
  signature: z.string(),
  scope: z.string(),
  instance_url: z.string().url(),
  id: z.string(),
  token_type: z.string(),
  issued_at: z.string(),
  api_instance_url: z.string(),
});

module.exports = { salesforceTokenResponseSchema };
