// Building blocks shared by the OpenAPI contributions. A domain only writes its own
// features/<domain>/<domain>.docs.ts, openapi.ts merges them.

export const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
export const id = { type: 'integer', format: 'int64', minimum: 1 };
export const dateTime = { type: 'string', format: 'date-time' };
// siblings of $ref are ignored in OpenAPI 3.0, so a nullable reference (always an object here) is wrapped in allOf,
// nullable only takes effect next to an explicit type, and a nullable enum has to list null itself
export const nullable = (schema: Record<string, any>) => {
  if ('$ref' in schema) return { type: 'object', allOf: [schema], nullable: true };
  return { ...schema, nullable: true, ...('enum' in schema ? { enum: [...schema.enum, null] } : {}) };
};

export const envelope = (properties: Record<string, object> = {}) => ({
  type: 'object',
  properties: { success: { type: 'boolean', example: true }, ...properties },
});

export const json = (schema: object) => ({ 'application/json': { schema } });
export const ok = (description: string, schema: object) => ({ description, content: json(schema) });
const errorResponse = (name: string) => ({ $ref: `#/components/responses/${name}` });

export const pathParam = (name: string, description: string) => ({
  name, in: 'path', required: true, description, schema: id,
});

export const authed = { security: [{ cookieAuth: [] }] };
export const errors = (...statuses: number[]) => {
  const names: Record<number, string> = { 400: 'BadRequest', 401: 'Unauthorized', 403: 'Forbidden', 404: 'NotFound', 409: 'Conflict' };
  return Object.fromEntries(statuses.map((status) => [String(status), errorResponse(names[status] as string)]));
};

export const messageOnly = envelope({ message: { type: 'string' } });

export const sharedSchemas = {
  Error: {
    type: 'object',
    properties: { success: { type: 'boolean', example: false }, message: { type: 'string' } },
  },
  Person: {
    type: 'object',
    properties: { id, first_name: { type: 'string' }, last_name: nullable({ type: 'string' }), email: { type: 'string', format: 'email' } },
  },
  // permitted urls belong to an exam and are copied onto every attempt of it, so both domains answer with them
  PermittedUrl: {
    type: 'object',
    properties: { id, url: { type: 'string', format: 'uri' } },
  },
};
