// `clampElapsed()` is the sole cap on ct_heat_entries.elapsed_secs — both the
// tap path and the manual-entry path must call it (handoff §5.2, §6). Flags
// `elapsed_secs` written from anything other than a direct clampElapsed()
// call or a `.elapsed` member read off its result (e.g. `clampElapsed(...).elapsed`
// or `const { elapsed } = clampElapsed(...)` destructured into the payload).
const ELAPSED_NAME = /^elapsed_?secs$/i;

function isClampedValue(valueNode) {
  if (!valueNode) return false;
  if (valueNode.type === 'CallExpression') {
    return valueNode.callee.type === 'Identifier' && valueNode.callee.name === 'clampElapsed';
  }
  if (valueNode.type === 'MemberExpression') {
    return valueNode.property.type === 'Identifier' && valueNode.property.name === 'elapsed';
  }
  return false;
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow writing elapsed_secs from anything other than clampElapsed()',
    },
  },
  create(context) {
    return {
      Property(node) {
        const key = node.key;
        const name = key.type === 'Identifier' ? key.name : key.value;
        if (typeof name !== 'string' || !ELAPSED_NAME.test(name)) return;
        if (!isClampedValue(node.value)) {
          context.report({
            node,
            message: `elapsed_secs must come from clampElapsed() — it is the sole duration cap (handoff §5.2).`,
          });
        }
      },
      AssignmentExpression(node) {
        const target = node.left;
        const name =
          target.type === 'Identifier'
            ? target.name
            : target.type === 'MemberExpression' && target.property.type === 'Identifier'
              ? target.property.name
              : null;
        if (!name || !ELAPSED_NAME.test(name)) return;
        if (!isClampedValue(node.right)) {
          context.report({
            node,
            message: `elapsed_secs must come from clampElapsed() — it is the sole duration cap (handoff §5.2).`,
          });
        }
      },
    };
  },
};
