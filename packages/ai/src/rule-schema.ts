import { RULE_FIELDS, RULE_OPERATORS } from "@huntloop/db/rules";

/**
 * The scoring-rule expression as JSON Schema, one level of nesting deep. The
 * depth bound is `validateExpression`'s: a schema cannot count depth.
 */
export function ruleExpressionSchema() {
  const condition = {
    type: "object",
    additionalProperties: false,
    required: ["field", "op"],
    properties: {
      field: { type: "string", enum: [...RULE_FIELDS] },
      op: { type: "string", enum: [...RULE_OPERATORS] },
      value: {
        anyOf: [
          { type: "string" },
          { type: "number" },
          { type: "array", items: { type: "string" } },
        ],
      },
    },
  };

  return {
    anyOf: [
      condition,
      {
        type: "object",
        additionalProperties: false,
        required: ["all"],
        properties: { all: { type: "array", minItems: 1, items: condition } },
      },
      {
        type: "object",
        additionalProperties: false,
        required: ["any"],
        properties: { any: { type: "array", minItems: 1, items: condition } },
      },
      {
        type: "object",
        additionalProperties: false,
        required: ["not"],
        properties: { not: condition },
      },
    ],
  };
}
