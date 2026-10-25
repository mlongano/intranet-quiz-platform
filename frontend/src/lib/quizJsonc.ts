/**
 * Checking and editing quiz JSONC in the browser, exactly as strictly as the
 * server parses it — no more, no less.
 *
 * The server reads quizzes with Python's `commentjson`: `//` comments and
 * trailing commas are accepted, `/* *\/` block comments are rejected. A browser
 * check that disagreed would either refuse text the server takes, or let the
 * teacher save text the server then turns down.
 */
import {
  type Node,
  type ParseError,
  applyEdits,
  createScanner,
  findNodeAtLocation,
  modify,
  parse,
  parseTree,
  printParseErrorCode,
} from 'jsonc-parser';

// jsonc-parser declares SyntaxKind as a `const enum`, which isolatedModules
// cannot read. Values from its typings (lib/umd/main.d.ts, 3.3.1).
const BLOCK_COMMENT = 13;
const EOF = 17;

export interface QuizIssue {
  line: number;    // 1-based
  column: number;  // 1-based
  offset: number;  // 0-based, to place the cursor
  message: string;
}

export interface QuizCheck {
  /** Parsed questions when the text is valid, else null. */
  questions: Array<Record<string, any>> | null;
  errors: QuizIssue[];
}

const PARSE_OPTIONS = { allowTrailingComma: true, disallowComments: false };

// Keyed by printParseErrorCode(): a function, unlike the const enum itself.
const PARSE_MESSAGES: Record<string, string> = {
  InvalidSymbol: 'carattere non valido',
  InvalidNumberFormat: 'numero non valido',
  PropertyNameExpected: 'atteso il nome di un campo tra virgolette',
  ValueExpected: 'atteso un valore',
  ColonExpected: 'mancano i due punti dopo il nome del campo',
  CommaExpected: 'manca una virgola',
  CloseBraceExpected: 'manca una } di chiusura',
  CloseBracketExpected: 'manca una ] di chiusura',
  EndOfFileExpected: 'testo in più dopo la fine del quiz',
  InvalidCommentToken: 'commento non valido',
  UnexpectedEndOfComment: 'commento non chiuso',
  UnexpectedEndOfString: 'testo tra virgolette non chiuso',
  UnexpectedEndOfNumber: 'numero incompleto',
  InvalidUnicode: 'carattere Unicode non valido',
  InvalidEscapeCharacter: 'sequenza con \\ non valida (per una barra scrivi \\\\)',
  InvalidCharacter: 'carattere non ammesso nel testo: per andare a capo scrivi \\n',
};

export function offsetToLineCol(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset);
  const line = before.split('\n').length;
  return { line, column: offset - before.lastIndexOf('\n') };
}

export function lineColToOffset(text: string, line: number, column: number): number {
  let offset = 0;
  for (let i = 1; i < line; i++) {
    const next = text.indexOf('\n', offset);
    if (next < 0) return text.length;
    offset = next + 1;
  }
  return Math.min(offset + column - 1, text.length);
}

function issue(text: string, offset: number, message: string): QuizIssue {
  return { ...offsetToLineCol(text, offset), offset, message };
}

/** Block comments: valid JSONC, but rejected by the server's parser. */
function blockComments(text: string): QuizIssue[] {
  const scanner = createScanner(text, false);
  const found: QuizIssue[] = [];
  for (let kind = scanner.scan(); kind !== EOF; kind = scanner.scan()) {
    if (kind === BLOCK_COMMENT) {
      found.push(issue(text, scanner.getTokenOffset(),
        'i commenti /* */ non sono accettati dal server: usa // a inizio commento'));
    }
  }
  return found;
}

const TYPES = ['single', 'multiple', 'open'];

/** The same rules as the server's _validate_questions, positioned on the question. */
function schemaIssues(text: string, root: Node | undefined, value: any): QuizIssue[] {
  const questions = value?.questions;
  if (!Array.isArray(questions) || questions.length === 0) {
    return [issue(text, 0, 'il quiz deve avere "questions" con almeno una domanda')];
  }
  const found: QuizIssue[] = [];
  questions.forEach((q: any, i: number) => {
    const at = root ? findNodeAtLocation(root, ['questions', i])?.offset ?? 0 : 0;
    const n = i + 1;
    if (!q || typeof q !== 'object' || Array.isArray(q)) {
      found.push(issue(text, at, `domanda ${n}: deve essere un oggetto { ... }`));
      return;
    }
    if (!('id' in q)) found.push(issue(text, at, `domanda ${n}: manca il campo "id"`));
    if (!TYPES.includes(q.type)) {
      found.push(issue(text, at, `domanda ${n}: tipo "${q.type ?? ''}" non valido (single, multiple oppure open)`));
    } else if (q.type !== 'open' && !Array.isArray(q.options)) {
      found.push(issue(text, at, `domanda ${n}: manca l'elenco "options"`));
    }
  });
  return found;
}

export function checkQuizJsonc(text: string): QuizCheck {
  const parseErrors: ParseError[] = [];
  const value = parse(text, parseErrors, PARSE_OPTIONS);
  const errors = [
    ...blockComments(text),
    ...parseErrors.map(e => issue(text, e.offset, PARSE_MESSAGES[printParseErrorCode(e.error)] ?? 'errore di sintassi')),
  ];
  if (errors.length) return { questions: null, errors: errors.sort((a, b) => a.offset - b.offset) };

  const root = parseTree(text, [], PARSE_OPTIONS);
  const schema = schemaIssues(text, root, value);
  return { questions: schema.length ? null : value.questions, errors: schema };
}

/** Set every question's weight, editing the text in place so comments survive. */
export function setAllWeights(text: string, weight: number): string {
  const { questions } = checkQuizJsonc(text);
  if (!questions) return text;
  let out = text;
  questions.forEach((_, i) => {
    out = applyEdits(out, modify(out, ['questions', i, 'weight'], weight, {
      formattingOptions: { insertSpaces: true, tabSize: 2 },
    }));
  });
  return out;
}

/** Option indices to highlight as correct in the preview. */
export function correctIndices(q: Record<string, any>): number[] {
  const valid = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0;
  if (q.type === 'single') return valid(q.correct) ? [q.correct] : [];
  if (q.type === 'multiple') return Array.isArray(q.correct) ? q.correct.filter(valid) : [];
  return [];
}

export const NEW_QUIZ_TEMPLATE = `{
  // Nuovo quiz: modifica le domande e salva (Ctrl+S o Cmd+S).
  // I commenti che iniziano con // sono ammessi.
  "questions": [
    {
      // Markdown: **grassetto**, *corsivo*, \`codice\`,
      // elenchi con "- ", blocchi \`\`\`python ... \`\`\`.
      // Nel JSON si va a capo scrivendo \\n.
      // Più comodo: «Strumenti» → Markdown→JSON.
      "id": 1,
      "type": "single",          // una sola risposta giusta
      "text": "**Cosa stampa** questo programma *Python*?\\n\\n\`\`\`python\\nnumeri = [3, 1, 2]\\nfor n in sorted(numeri):\\n    print(n * 2)\\n\`\`\`\\n\\n- \`sorted()\` restituisce una **nuova** lista\\n- la lista \`numeri\` resta invariata",
      "options": [
        "\`2\`, \`4\`, \`6\`, uno per riga",
        "\`6\`, \`2\`, \`4\`, uno per riga",
        "\`3\`, \`1\`, \`2\`, uno per riga"
      ],
      "correct": 0,              // indice della giusta, da 0
      "weight": 1
    },
    {
      "id": 2,
      "type": "multiple",        // più risposte giuste
      // Formule LaTeX: $…$ nel testo, $$…$$ su una riga a sé.
      // Nel JSON ogni \\ va scritta doppia: \\\\frac.
      "text": "Quali valgono $\\\\frac{1}{2}$?",
      "options": ["$0{,}5$", "$\\\\dfrac{2}{3}$", "$\\\\dfrac{2}{4}$"],
      "correct": [0, 2],
      "weight": 1
    },
    {
      // Immagini: "question_image" nella domanda,
      // { "text", "image" } nelle opzioni.
      // Queste sono di esempio. Per le tue: salva,
      // caricale con «Gestisci immagini», poi
      // «Inserisci immagine» scrive il percorso.
      "id": 3,
      "type": "single",
      "text": "Quale di queste figure ha tre lati?",
      "question_image": "/esempi/figure.svg",
      "options": [
        { "text": "Il triangolo", "image": "/esempi/triangolo.svg" },
        { "text": "Il quadrato", "image": "/esempi/quadrato.svg" },
        { "text": "Il cerchio", "image": "/esempi/cerchio.svg" }
      ],
      "correct": 0,
      "weight": 1
    },
    {
      "id": 4,
      "type": "open",            // risposta libera, valutata dal modello
      "text": "Spiega con parole tue.",
      "options": [],
      "acceptable": "La risposta che consideri corretta, per la valutazione automatica.",
      "weight": 2
    }
  ]
}
`;
