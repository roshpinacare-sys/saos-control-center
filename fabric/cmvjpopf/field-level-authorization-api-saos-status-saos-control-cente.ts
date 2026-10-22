import { Request, Response, NextFunction } from 'express';

/**
 * User roles supported by the SAOS control center.
 */
export type UserRole = 'ADMIN' | 'OPERATOR' | 'AUDITOR';

/**
 * Shape of the authenticated user attached to the request by the auth middleware.
 */
export interface AuthenticatedUser {
  role: UserRole;
  address: string;
  // other auth fields...
}

/**
 * Extend Express Request to include the authenticated user.
 */
declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

/**
 * Response schema definition — lists the fields that a role is allowed to see.
 * Fields not listed are stripped from the response.
 */
export interface ResponseSchema {
  [key: string]: boolean | ResponseSchema;
}

/**
 * Field-level authorization schemas per role.
 * - ADMIN: sees everything (empty schema = no filtering)
 * - OPERATOR: subset — sensitive fields explicitly denied
 * - AUDITOR: minimal read-only fields explicitly allowed
 */
export const responseSchemas: Record<UserRole, ResponseSchema> = {
  ADMIN: {},
  OPERATOR: {
    privateKeys: false,
    internalMetrics: false,
    debugInfo: false,
    rawConfig: false,
    secrets: false,
  },
  AUDITOR: {
    status: true,
    timestamp: true,
    version: true,
    healthSummary: true,
  },
};

/**
 * Deep-clone an object to avoid mutating the source.
 */
function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Recursively filter an object according to a schema.
 * @param obj - The object to filter (already cloned).
 * @param schema - The schema defining allowed/denied fields.
 * @param defaultAllow - Default behavior for fields not in schema (true = allow, false = deny).
 * @returns The filtered object.
 */
function filterObject(
  obj: Record<string, unknown>,
  schema: ResponseSchema,
  defaultAllow: boolean
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key in schema) {
      const rule = schema[key];
      if (rule === false) continue; // explicitly denied
      if (rule === true) {
        result[key] = value;
        continue;
      }
      // nested schema
      if (typeof rule === 'object' && value && typeof value === 'object') {
        result[key] = filterObject(value as Record<string, unknown>, rule, defaultAllow);
        continue;
      }
      // rule is true/false but value is not object — allow if true
      if (rule === true) result[key] = value;
      continue;
    }
    // key not in schema → apply default
    if (defaultAllow) result[key] = value;
  }
  return result;
}

/**
 * Create a field-filtering middleware for a given role.
 * The middleware reads `req.user.role`, selects the appropriate schema,
 * clones the response body, filters it, and replaces `res.json` to return the filtered version.
 *
 * @param getRole - Function to extract the role from the request (defaults to `req.user?.role`).
 * @returns Express middleware.
 */
export function fieldFilter(
  getRole: (req: Request) => UserRole | undefined = (req) => req.user?.role
) {
  return (req: Request, res: Response, next: NextFunction) => {
    const role = getRole(req) ?? 'AUDITOR'; // default to AUDITOR for unknown/missing roles
    const schema = responseSchemas[role] ?? responseSchemas.AUDITOR;
    const defaultAllow = role === 'ADMIN';

    const originalJson = res.json.bind(res);
    res.json = (body: unknown) => {
      // Only filter plain objects (not arrays, primitives, null)
      if (body && typeof body === 'object' && !Array.isArray(body)) {
        const cloned = deepClone(body as Record<string, unknown>);
        const filtered = filterObject(cloned, schema, defaultAllow);
        return originalJson(filtered);
      }
      return originalJson(body);
    };

    next();
  };
}

/**
 * Convenience middleware that applies field filtering for the authenticated user's role.
 * Assumes auth middleware has already run and attached `req.user`.
 */
export const applyFieldFilter = fieldFilter();
