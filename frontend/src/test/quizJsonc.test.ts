import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  NEW_QUIZ_TEMPLATE,
  checkQuizJsonc,
  correctIndices,
  lineColToOffset,
  setAllWeights,
} from '../lib/quizJsonc';

const valid = `{
  // commento ammesso dal server
  "questions": [
    { "id": 1, "type": "single", "text": "Uno", "options": ["a", "b"], "correct": 1, "weight": 2, },
    { "id": 2, "type": "open", "text": "Due", "options": [], "acceptable": "x" },
  ],
}`;

describe('checkQuizJsonc mirrors what the server accepts', () => {
  it('accepts // comments and trailing commas, like commentjson', () => {
    const r = checkQuizJsonc(valid);
    expect(r.errors).toEqual([]);
    expect(r.questions?.map(q => q.id)).toEqual([1, 2]);
  });

  it('rejects /* */ comments, which the server refuses', () => {
    const r = checkQuizJsonc('{\n  /* no */ "questions": [ {"id": 1, "type": "open"} ]\n}');
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].message).toMatch(/\/\* \*\//);
    expect(r.errors[0]).toMatchObject({ line: 2, column: 3 });
  });

  it('reports syntax errors with line and column', () => {
    const r = checkQuizJsonc('{\n  "questions": [\n    {"id": 1 "type": "open"}\n  ]\n}');
    expect(r.questions).toBeNull();
    expect(r.errors[0]).toMatchObject({ line: 3, column: 14 });
    expect(r.errors[0].message).toMatch(/virgola/);
  });

  it('applies the server schema: non-empty questions, id, type, options', () => {
    expect(checkQuizJsonc('{"questions": []}').errors[0].message).toMatch(/almeno una domanda/);
    const r = checkQuizJsonc(`{"questions": [
      {"type": "single", "options": []},
      {"id": 2, "type": "vero-falso", "options": []},
      {"id": 3, "type": "multiple"}
    ]}`);
    expect(r.errors.map(e => e.message)).toEqual([
      expect.stringMatching(/domanda 1.*"id"/),
      expect.stringMatching(/domanda 2.*tipo/),
      expect.stringMatching(/domanda 3.*"options"/),
    ]);
    expect(r.errors.map(e => e.line)).toEqual([2, 3, 4]);
  });
});

describe('setAllWeights', () => {
  it('changes every weight and keeps comments', () => {
    const out = setAllWeights(valid, 3);
    expect(checkQuizJsonc(out).questions?.map(q => q.weight)).toEqual([3, 3]);
    expect(out).toContain('// commento ammesso dal server');
  });

  it('only rewrites the values when every question already has a weight', () => {
    const allWeighted = setAllWeights(valid, 3);   // now both questions have one
    const again = setAllWeights(allWeighted, 5);
    const before = allWeighted.split('\n');
    const after = again.split('\n');
    expect(after).toHaveLength(before.length);
    expect(after.filter((line, i) => line !== before[i]).every(line => line.includes('"weight": 5'))).toBe(true);
  });

  it('adds the weight where a question has none', () => {
    const out = setAllWeights(valid, 4);
    expect(checkQuizJsonc(out).questions?.[1].weight).toBe(4);
  });

  it('leaves text with errors untouched', () => {
    expect(setAllWeights('{ broken', 2)).toBe('{ broken');
  });
});

describe('correctIndices for the preview', () => {
  it('single, multiple, open', () => {
    expect(correctIndices({ type: 'single', correct: 1 })).toEqual([1]);
    expect(correctIndices({ type: 'multiple', correct: [0, 2, -1, 'x'] })).toEqual([0, 2]);
    expect(correctIndices({ type: 'open', correct: 0 })).toEqual([]);
    expect(correctIndices({ type: 'single' })).toEqual([]);
  });
});

describe('NEW_QUIZ_TEMPLATE', () => {
  it('passes the same checks as the server, comments included', () => {
    const r = checkQuizJsonc(NEW_QUIZ_TEMPLATE);
    expect(r.errors).toEqual([]);
    expect(new Set(r.questions?.map(q => q.type))).toEqual(new Set(['single', 'multiple', 'open']));
    expect(NEW_QUIZ_TEMPLATE).toMatch(/\/\/ /);
  });

  it('shows richer Markdown with a code block', () => {
    const q = checkQuizJsonc(NEW_QUIZ_TEMPLATE).questions?.[0];
    expect(q?.text).toMatch(/^\*\*.+\*\*/);
    expect(q?.text).toContain('\n```python\n');
    expect(q?.text).toContain('\n    print(n * 2)\n```');
    expect(q?.options[0]).toContain('`2`');
  });

  it('shows a LaTeX formula, with the backslash surviving JSON', () => {
    const q = checkQuizJsonc(NEW_QUIZ_TEMPLATE).questions?.find(x => x.text.includes('$'));
    expect(q?.text).toContain('$\\frac{1}{2}$');
  });

  it('shows images in a question and in its options, with files that exist', () => {
    const q = checkQuizJsonc(NEW_QUIZ_TEMPLATE).questions?.find(x => x.question_image);
    expect(q?.question_image).toMatch(/^\/esempi\//);
    const images = q?.options.map((o: { image?: string }) => o.image) ?? [];
    expect(images.length).toBeGreaterThan(1);
    for (const src of [q?.question_image, ...images]) {
      expect(existsSync(resolve(__dirname, '../../public', src.slice(1)))).toBe(true);
    }
  });
});

describe('lineColToOffset', () => {
  it('is the inverse used to place the cursor on an error', () => {
    const text = 'ab\ncd\nef';
    expect(lineColToOffset(text, 2, 2)).toBe(4);
    expect(text[lineColToOffset(text, 3, 1)]).toBe('e');
  });
});
