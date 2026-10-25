/**
 * The Markdown pipeline shared by every place that shows quiz text: GitHub
 * tables and lists, LaTeX formulas ($…$ inline, $$…$$ on their own line),
 * code highlighting. One list, so a formula the preview shows is the formula
 * the student sees.
 */
import type { Options } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypePrism from 'rehype-prism-plus';

import 'katex/dist/katex.min.css';

type PluggableList = NonNullable<Options['rehypePlugins']>;

// The default schema keeps only language-* classes on <code>, which would
// turn a $$ block into an inline formula. KaTeX runs after sanitizing: its own
// output is trusted markup, and it never renders \href or other links.
const schema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [
      ...(defaultSchema.attributes?.code ?? []),
      ['className', /^language-./, 'math-inline', 'math-display'],
    ],
  },
};

export const remarkPlugins: PluggableList = [remarkGfm, remarkMath];

// KaTeX before Prism: Prism would otherwise highlight formulas as code.
export const rehypePlugins: PluggableList = [
  [rehypeSanitize, schema],
  rehypeKatex,
  // Highlighting and line numbers are part of the rendered markup, so a
  // re-render keeps them; an unknown language stays plain code.
  [rehypePrism, { showLineNumbers: true, ignoreMissing: true }],
];
