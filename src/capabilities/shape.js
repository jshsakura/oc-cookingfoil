/**
 * Short builders for the JSON Schemas of capability outputs (define.js `output`). Every property
 * of obj() is required unless named in `optional`; other keys may be present too.
 */
const described = (schema, description) => (description ? { ...schema, description } : schema);

export const str = (description) => described({ type: "string" }, description);
export const int = (description) => described({ type: "integer" }, description);
export const num = (description) => described({ type: "number" }, description);
export const bool = (description) => described({ type: "boolean" }, description);
export const oneOf = (values, description) => described({ enum: values }, description);
export const arr = (items, description) => described({ type: "array", items }, description);
export const nullable = (schema) => ({ ...schema, type: [schema.type, "null"] });

export function obj(properties, { optional = [], description } = {}) {
  const required = Object.keys(properties).filter((k) => !optional.includes(k));
  return described({ type: "object", properties, ...(required.length ? { required } : {}) }, description);
}

/** A title id: 16 hexadecimal digits. */
export const titleId = (description = "16 hex digits") => described({ type: "string", pattern: "^[0-9A-F]{16}$" }, description);
