// Building blocks shared by the OpenAPI contributions. A domain only writes its own
// features/<domain>/<domain>.docs.ts, openapi.ts merges them.

export const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
export const id = { type: 'integer', format: 'int64', minimum: 1, example: 12 };
export const dateTime = { type: 'string', format: 'date-time', example: '2026-03-12T09:00:00Z' };
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
  const names: Record<number, string> = { 400: 'BadRequest', 401: 'Unauthorized', 403: 'Forbidden', 404: 'NotFound', 409: 'Conflict', 503: 'ServiceUnavailable' };
  return Object.fromEntries(statuses.map((status) => [String(status), errorResponse(names[status] as string)]));
};

export const messageOnly = envelope({ message: { type: 'string', example: 'Completed successfully' } });

export const sharedSchemas = {
  Error: {
    type: 'object',
    properties: { success: { type: 'boolean', example: false }, message: { type: 'string', example: 'Invalid or expired token' } },
  },
  Person: {
    type: 'object',
    properties: { id, first_name: { type: 'string', example: 'Sarah' }, last_name: nullable({ type: 'string', example: 'Chen' }), email: { type: 'string', format: 'email', example: 'sarah.chen@magi.edu' } },
  },
  // permitted urls/apps can be granted at exam, module and student level, and are merged and
  // copied onto every attempt once it starts - exams, modules and students (auth) all answer with them
  PermittedUrl: {
    type: 'object',
    properties: { id, url: { type: 'string', format: 'uri', example: 'https://docs.python.org/3/' } },
  },
  PermittedApp: {
    type: 'object',
    properties: { id, name: { type: 'string', example: 'Visual Studio Code' } },
  },
};
