// `correct` is a count, never a column (handoff §5.2): `resolveHeat()` is pure
// and the tally is exposed as a view, not persisted. The same discipline
// covers standings positions. Flags a computed count/position being written
// into an object literal property or an assignment target named for one of
// these derived values — the value must come from a view or a pure function
// call, never be reconstructed inline and stored.
const DERIVED_NAME = /^(correct_?count|total_?correct|standings?_?position|rank)$/i;

function isComputed(valueNode) {
  if (!valueNode) return false;
  switch (valueNode.type) {
    case 'Identifier':
    case 'Literal':
      return false;
    default:
      return true;
  }
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow storing a computed correct-count or standings position — derivation stays pure',
    },
  },
  create(context) {
    return {
      Property(node) {
        const key = node.key;
        const name = key.type === 'Identifier' ? key.name : key.value;
        if (typeof name !== 'string' || !DERIVED_NAME.test(name)) return;
        if (isComputed(node.value)) {
          context.report({
            node,
            message: `'${name}' looks derived — persist the raw facts and expose this via a view or pure function, not a stored field.`,
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
        if (!name || !DERIVED_NAME.test(name)) return;
        if (isComputed(node.right)) {
          context.report({
            node,
            message: `'${name}' looks derived — persist the raw facts and expose this via a view or pure function, not a stored field.`,
          });
        }
      },
    };
  },
};
