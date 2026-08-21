// `CUP-TASTER-SPEC.md` v4.0 used "trio" to mean *set*, and "set" to mean the
// stage's whole collection of sets — an inversion that is not carried forward
// (handoff §2). Flags "trio" in any identifier, string literal, or comment
// under src/, case-insensitively, as a whole word.
const TRIO_TEXT = /\btrio\b/i;
const TRIO_WORD = /^trio$/i;

// Identifiers carry no natural word boundaries a plain \b can see —
// "trioCount" is one continuous run of word characters — so split camelCase,
// PascalCase, snake_case, and kebab-case into words before comparing.
function splitIdentifierWords(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .split(/[_-]+/)
    .filter(Boolean);
}

export default {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow "trio" vocabulary — the term is "set" (handoff §2)' },
  },
  create(context) {
    return {
      Identifier(node) {
        if (splitIdentifierWords(node.name).some((word) => TRIO_WORD.test(word))) {
          context.report({
            node,
            message: `"trio" is banned vocabulary — use "set" instead (found in an identifier).`,
          });
        }
      },
      Literal(node) {
        if (typeof node.value === 'string' && TRIO_TEXT.test(node.value)) {
          context.report({
            node,
            message: `"trio" is banned vocabulary — use "set" instead (found in a string literal).`,
          });
        }
      },
      'Program:exit'(node) {
        for (const comment of context.sourceCode.getAllComments()) {
          if (TRIO_TEXT.test(comment.value)) {
            context.report({
              node,
              message: `"trio" is banned vocabulary — use "set" instead (found in a comment).`,
            });
          }
        }
      },
    };
  },
};
