// The module boundary test (handoff §6): can a future format reuse a core/
// module without editing it? An import running the other direction — core/
// reaching into formats/ — breaks that immediately. Flags any import from
// src/formats/ inside a file under src/core/.
const CORE_DIR = /[\\/]src[\\/]core[\\/]/;
const FORMATS_IMPORT = /(^|[\\/])formats([\\/]|$)/;

export default {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow imports from src/formats/ inside src/core/ (handoff §6)' },
  },
  create(context) {
    const filename = context.filename ?? context.getFilename();
    if (!CORE_DIR.test(filename)) return {};

    function check(node, source) {
      if (typeof source === 'string' && FORMATS_IMPORT.test(source)) {
        context.report({
          node,
          message: `core/ must not import from formats/ ('${source}') — format-specific logic belongs in src/formats/, not src/core/.`,
        });
      }
    }

    return {
      ImportDeclaration(node) {
        check(node, node.source.value);
      },
      ImportExpression(node) {
        if (node.source.type === 'Literal') check(node, node.source.value);
      },
      CallExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'require') {
          const arg = node.arguments[0];
          if (arg && arg.type === 'Literal') check(node, arg.value);
        }
      },
    };
  },
};
