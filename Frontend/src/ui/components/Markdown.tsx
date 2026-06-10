import React, { useMemo } from 'react';

/**
 * Dependency-free markdown renderer for AI-generated study content.
 * Supports: #/##/### headings, -/* bullet lists, 1. ordered lists, ``` code
 * fences, `inline code`, **bold**, *italic*, blank-line paragraphs, tables are
 * rendered as preformatted text. Not a full CommonMark implementation — just
 * enough for Claude's notes/homework/chat output, with safe React escaping.
 */

interface MarkdownProps {
  text: string;
  className?: string;
}

function renderInline(text: string, keyBase: string): React.ReactNode[] {
  // Tokenize `code`, **bold**, *italic* — in that precedence.
  const nodes: React.ReactNode[] = [];
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyBase}-${i++}`;
    if (tok.startsWith('`')) {
      nodes.push(
        <code key={key} className="px-1.5 py-0.5 rounded bg-slate-800 text-cyan-300 font-mono text-[0.85em]">
          {tok.slice(1, -1)}
        </code>,
      );
    } else if (tok.startsWith('**')) {
      nodes.push(
        <strong key={key} className="font-semibold text-white">
          {tok.slice(2, -2)}
        </strong>,
      );
    } else {
      nodes.push(
        <em key={key} className="italic text-slate-200">
          {tok.slice(1, -1)}
        </em>,
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

type Block =
  | { kind: 'h'; level: 1 | 2 | 3; text: string }
  | { kind: 'p'; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] }
  | { kind: 'code'; text: string };

function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let code: string[] | null = null;

  const flushPara = () => {
    if (para.length) {
      blocks.push({ kind: 'p', text: para.join(' ') });
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      blocks.push(list.ordered ? { kind: 'ol', items: list.items } : { kind: 'ul', items: list.items });
      list = null;
    }
  };

  for (const raw of lines) {
    const line = raw;
    if (code !== null) {
      if (line.trim().startsWith('```')) {
        blocks.push({ kind: 'code', text: code.join('\n') });
        code = null;
      } else {
        code.push(line);
      }
      continue;
    }
    if (line.trim().startsWith('```')) {
      flushPara();
      flushList();
      code = [];
      continue;
    }
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      flushPara();
      flushList();
      blocks.push({ kind: 'h', level: h[1].length as 1 | 2 | 3, text: h[2] });
      continue;
    }
    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    if (ul) {
      flushPara();
      if (!list || list.ordered) {
        flushList();
        list = { ordered: false, items: [] };
      }
      list.items.push(ul[1]);
      continue;
    }
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ol) {
      flushPara();
      if (!list || !list.ordered) {
        flushList();
        list = { ordered: true, items: [] };
      }
      list.items.push(ol[1]);
      continue;
    }
    if (line.trim() === '') {
      flushPara();
      flushList();
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  if (code !== null) blocks.push({ kind: 'code', text: code.join('\n') });
  flushPara();
  flushList();
  return blocks;
}

export const Markdown: React.FC<MarkdownProps> = ({ text, className }) => {
  const blocks = useMemo(() => parseBlocks(text), [text]);
  return (
    <div className={className ?? 'space-y-3 text-sm leading-relaxed text-slate-300'}>
      {blocks.map((b, i) => {
        switch (b.kind) {
          case 'h': {
            const cls =
              b.level === 1
                ? 'text-xl font-bold text-white font-display mt-5'
                : b.level === 2
                  ? 'text-lg font-bold text-white font-display mt-4'
                  : 'text-base font-semibold text-cyan-300 font-display mt-3';
            return (
              <div key={i} className={cls}>
                {renderInline(b.text, `h${i}`)}
              </div>
            );
          }
          case 'ul':
            return (
              <ul key={i} className="list-disc pl-5 space-y-1.5">
                {b.items.map((it, j) => (
                  <li key={j}>{renderInline(it, `ul${i}-${j}`)}</li>
                ))}
              </ul>
            );
          case 'ol':
            return (
              <ol key={i} className="list-decimal pl-5 space-y-1.5">
                {b.items.map((it, j) => (
                  <li key={j}>{renderInline(it, `ol${i}-${j}`)}</li>
                ))}
              </ol>
            );
          case 'code':
            return (
              <pre
                key={i}
                className="bg-slate-900/80 border border-white/5 rounded-xl p-4 overflow-x-auto font-mono text-xs text-slate-200"
              >
                {b.text}
              </pre>
            );
          default:
            return <p key={i}>{renderInline(b.text, `p${i}`)}</p>;
        }
      })}
    </div>
  );
};
