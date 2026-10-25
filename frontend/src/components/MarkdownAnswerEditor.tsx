/**
 * Where a student writes an open answer: Markdown (code included) with a
 * toolbar, a live preview beside the text, and Tab that indents code instead
 * of leaving the field.
 */
import { useDeferredValue, useRef, useState } from 'react';
import {
  Bold, Code, Heading, Italic, List, ListOrdered, Quote, Sigma, SquareCode,
} from 'lucide-react';

import MarkdownContent from './MarkdownContent';

const INDENT = '    ';
const LANGUAGES = ['python', 'java', 'javascript', 'c', 'cpp', 'csharp', 'php', 'sql', 'html', 'css', 'bash'];

interface Props {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  maxLength?: number;
}

/**
 * Replace the selection the way typing would, so the browser's undo still
 * works; fall back to setRangeText where execCommand is unavailable.
 */
function insert(ta: HTMLTextAreaElement, text: string, selectFrom?: number, selectTo?: number) {
  const start = ta.selectionStart;
  ta.focus();
  const ok = document.execCommand?.('insertText', false, text);
  if (!ok) {
    ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
  if (selectFrom !== undefined) {
    ta.setSelectionRange(start + selectFrom, start + (selectTo ?? selectFrom));
  }
}

/** Expand the selection to whole lines and return them. */
function selectLines(ta: HTMLTextAreaElement) {
  const v = ta.value;
  const from = v.lastIndexOf('\n', ta.selectionStart - 1) + 1;
  let to = v.indexOf('\n', ta.selectionEnd === ta.selectionStart ? ta.selectionEnd : ta.selectionEnd - 1);
  if (to < 0) to = v.length;
  ta.setSelectionRange(from, to);
  return v.slice(from, to).split('\n');
}

function MarkdownAnswerEditor({ value, onChange, disabled = false, maxLength = 20000 }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  // After Esc, Tab leaves the field again (keyboard users must not be trapped).
  const tabLeaves = useRef(false);
  const preview = useDeferredValue(value);

  const wrap = (before: string, after: string, placeholder: string) => {
    const ta = ref.current;
    if (!ta || disabled) return;
    const selected = ta.value.slice(ta.selectionStart, ta.selectionEnd) || placeholder;
    insert(ta, before + selected + after, before.length, before.length + selected.length);
  };

  const prefixLines = (prefix: (i: number) => string) => {
    const ta = ref.current;
    if (!ta || disabled) return;
    const lines = selectLines(ta);
    insert(ta, lines.map((l, i) => prefix(i) + l).join('\n'));
  };

  const codeBlock = (language: string) => {
    const ta = ref.current;
    if (!ta || disabled) return;
    const selected = ta.value.slice(ta.selectionStart, ta.selectionEnd) || 'codice';
    const atLineStart = ta.selectionStart === 0 || ta.value[ta.selectionStart - 1] === '\n';
    const before = `${atLineStart ? '' : '\n'}\`\`\`${language}\n`;
    insert(ta, `${before}${selected}\n\`\`\`\n`, before.length, before.length + selected.length);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget;
    if (e.key === 'Escape') { tabLeaves.current = true; return; }
    if (e.key === 'Tab' && !tabLeaves.current) {
      e.preventDefault();
      if (e.shiftKey) {
        const lines = selectLines(ta);
        insert(ta, lines.map(l => l.replace(/^( {1,4}|\t)/, '')).join('\n'));
      } else if (ta.selectionStart !== ta.selectionEnd && ta.value.slice(ta.selectionStart, ta.selectionEnd).includes('\n')) {
        prefixLines(() => INDENT);
      } else {
        insert(ta, INDENT);
      }
      return;
    }
    tabLeaves.current = false;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); wrap('**', '**', 'testo'); }
    else if (mod && e.key.toLowerCase() === 'i') { e.preventDefault(); wrap('*', '*', 'testo'); }
    else if (mod && e.key.toLowerCase() === 'e') { e.preventDefault(); wrap('`', '`', 'codice'); }
  };

  const button = 'p-1.5 rounded text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high disabled:opacity-40 transition-colors';
  const near = value.length > maxLength * 0.8;

  return (
    <div className="rounded-lg border border-outline-variant/40 bg-surface-container-low">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-outline-variant/30 px-2 py-1" role="toolbar" aria-label="Formattazione">
        <button type="button" className={button} disabled={disabled} onClick={() => wrap('**', '**', 'testo')} title="Grassetto (Ctrl+B)" aria-label="Grassetto"><Bold size={16} /></button>
        <button type="button" className={button} disabled={disabled} onClick={() => wrap('*', '*', 'testo')} title="Corsivo (Ctrl+I)" aria-label="Corsivo"><Italic size={16} /></button>
        <button type="button" className={button} disabled={disabled} onClick={() => prefixLines(() => '## ')} title="Titolo" aria-label="Titolo"><Heading size={16} /></button>
        <button type="button" className={button} disabled={disabled} onClick={() => prefixLines(() => '- ')} title="Elenco puntato" aria-label="Elenco puntato"><List size={16} /></button>
        <button type="button" className={button} disabled={disabled} onClick={() => prefixLines(i => `${i + 1}. `)} title="Elenco numerato" aria-label="Elenco numerato"><ListOrdered size={16} /></button>
        <button type="button" className={button} disabled={disabled} onClick={() => prefixLines(() => '> ')} title="Citazione" aria-label="Citazione"><Quote size={16} /></button>
        <span className="mx-1 h-5 w-px bg-outline-variant/40" aria-hidden />
        <button type="button" className={button} disabled={disabled} onClick={() => wrap('`', '`', 'codice')} title="Codice nel testo (Ctrl+E)" aria-label="Codice nel testo"><Code size={16} /></button>
        <button type="button" className={button} disabled={disabled} onClick={() => codeBlock('')} title="Blocco di codice" aria-label="Blocco di codice"><SquareCode size={16} /></button>
        <select
          className="ml-0.5 rounded bg-transparent px-1 py-1 text-xs text-on-surface-variant hover:text-on-surface focus:outline-none"
          value=""
          disabled={disabled}
          onChange={(e) => { if (e.target.value) codeBlock(e.target.value); }}
          aria-label="Blocco di codice in un linguaggio"
          title="Blocco di codice in un linguaggio"
        >
          <option value="">Linguaggio…</option>
          {LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
        <button type="button" className={button} disabled={disabled} onClick={() => wrap('$', '$', 'x^2')} title="Formula (LaTeX)" aria-label="Formula"><Sigma size={16} /></button>
        <div className="ml-auto flex rounded-md border border-outline-variant/40 text-xs lg:hidden">
          {(['write', 'preview'] as const).map(t => (
            <button key={t} type="button" onClick={() => setTab(t)}
              className={`px-2 py-1 ${tab === t ? 'bg-primary/15 text-primary' : 'text-on-surface-variant'}`}>
              {t === 'write' ? 'Scrivi' : 'Anteprima'}
            </button>
          ))}
        </div>
      </div>

      <div className="grid lg:grid-cols-2">
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={disabled}
          maxLength={maxLength}
          spellCheck
          aria-label="La tua risposta (Markdown)"
          placeholder={'Scrivi qui la risposta. Puoi usare il Markdown: **grassetto**, *corsivo*, `codice`, elenchi con "- " e blocchi di codice con ``` (pulsanti qui sopra). Tab indenta il codice.'}
          className={`${tab === 'preview' ? 'hidden lg:block' : ''} min-h-72 w-full resize-y bg-transparent p-3 font-mono text-sm text-on-surface placeholder-on-surface-variant/70 focus:outline-none lg:border-r lg:border-outline-variant/30`}
        />
        <div
          className={`${tab === 'write' ? 'hidden lg:block' : ''} min-h-72 max-h-[32rem] overflow-auto p-3`}
          aria-label="Anteprima della risposta"
          aria-live="off"
        >
          {preview.trim()
            ? <MarkdownContent>{preview}</MarkdownContent>
            : <p className="text-sm text-on-surface-variant/70">L'anteprima della risposta apparirà qui.</p>}
        </div>
      </div>

      <div className="flex justify-between gap-2 border-t border-outline-variant/30 px-3 py-1 text-xs text-on-surface-variant">
        <span>Tab indenta il codice · Esc e poi Tab per uscire dal campo</span>
        <span className={near ? 'text-secondary' : ''}>{near ? `${value.length} / ${maxLength} caratteri` : `${value.length} caratteri`}</span>
      </div>
    </div>
  );
}

export default MarkdownAnswerEditor;
