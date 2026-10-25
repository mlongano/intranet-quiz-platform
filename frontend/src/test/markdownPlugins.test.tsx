import { render } from '@testing-library/react';
import ReactMarkdown from 'react-markdown';
import { describe, expect, it } from 'vitest';

import { rehypePlugins, remarkPlugins } from '../lib/markdownPlugins';

const md = (text: string) => render(
  <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins}>{text}</ReactMarkdown>,
).container;

describe('quiz Markdown renders LaTeX', () => {
  it('inline $…$ becomes an inline KaTeX formula', () => {
    const c = md('Calcola $\\frac{1}{2}$ adesso');
    expect(c.querySelector('.katex')).not.toBeNull();
    expect(c.querySelector('.katex-display')).toBeNull();
    expect(c.textContent).not.toContain('$');
  });

  it('a $$…$$ block is a display formula', () => {
    const c = md('$$\n\\sum_{i=1}^{n} i\n$$');
    expect(c.querySelector('.katex-display')).not.toBeNull();
  });

  it('code keeps its dollars and is not a formula', () => {
    const c = md('Usa `echo $HOME` e\n\n```bash\necho $PATH $USER\n```');
    expect(c.querySelector('.katex')).toBeNull();
    expect(c.textContent).toContain('$HOME');
    expect(c.textContent).toContain('$PATH $USER');
  });

  it('a formula cannot smuggle in a link or raw HTML', () => {
    const c = md('$\\href{javascript:alert(1)}{x}$ <img src=x onerror=alert(1)>');
    expect(c.querySelector('a')).toBeNull();
    expect(c.querySelector('img')).toBeNull();
  });
});

describe('code blocks', () => {
  const code = '```python\nx = 1\ny = 2\nprint(x + y)\n```';

  it('number their lines as part of the render, so a re-render keeps them', () => {
    const { container, rerender } = render(
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins}>{code}</ReactMarkdown>,
    );
    const lines = () => [...container.querySelectorAll('.line-number')].map(l => l.getAttribute('line'));
    expect(lines()).toEqual(['1', '2', '3']);
    expect(container.querySelector('.token')).not.toBeNull();
    rerender(<ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins}>{code}</ReactMarkdown>);
    expect(lines()).toEqual(['1', '2', '3']);
  });

  it('an unknown language is shown as plain code, not an error', () => {
    const c = md('```pseudocodice\nSE x > 0 ALLORA\n```');
    expect(c.textContent).toContain('SE x > 0 ALLORA');
    expect(c.querySelectorAll('.line-number')).toHaveLength(1);
  });
});
