export interface CodeMetrics {
  lines: number;
  nonBlankLines: number;
  blankLines: number;
  commentLines: number;
  commentRatio: number;
  avgLineLength: number;
  maxLineLength: number;
  branches: number;
  branchDensity: number;
  maxNesting: number;
  todoCount: number;
}

const BRANCH_KEYWORDS = new RegExp(
  '\\b(if|else\\s+if|elif|for|while|switch|case|catch|when|match|try)\\b',
  'g',
);
const TODO_PATTERN = /\b(TODO|FIXME|HACK|XXX|BUG)\b/i;

/**
 * Strip single-line (`//` or `#`) and block (`/* ... *\/`) comments, and
 * track how many source lines were comment-only. Block strings / regex
 * literals are not parsed — this is a heuristic, not a real tokenizer.
 */
function classifyLine(line: string, insideBlockComment: boolean): {
  kind: 'blank' | 'comment' | 'code';
  endsBlockComment: boolean;
  stripped: string;
} {
  let rest = line;
  let consumedBlockComment = false;

  if (insideBlockComment) {
    const end = rest.indexOf('*/');
    if (end === -1) return { kind: 'comment', endsBlockComment: true, stripped: '' };
    rest = rest.slice(end + 2);
    consumedBlockComment = true;
  }

  const trimmed = rest.trim();
  if (trimmed === '') {
    return {
      kind: consumedBlockComment ? 'comment' : 'blank',
      endsBlockComment: false,
      stripped: '',
    };
  }

  let codeChars = '';
  let i = 0;
  let isAllComment = true;
  let opensBlock = false;
  while (i < rest.length) {
    const two = rest.slice(i, i + 2);
    if (two === '//') {
      break;
    }
    if (two === '/*') {
      const end = rest.indexOf('*/', i + 2);
      if (end === -1) { opensBlock = true; break; }
      i = end + 2;
      continue;
    }
    const ch = rest[i]!;
    if (ch === '#' && !/["']/.test(codeChars)) {
      break;
    }
    if (ch.trim() !== '') isAllComment = false;
    codeChars += ch;
    i += 1;
  }

  if (codeChars.trim() === '' && isAllComment) {
    return { kind: 'comment', endsBlockComment: opensBlock, stripped: '' };
  }
  return { kind: 'code', endsBlockComment: opensBlock, stripped: codeChars };
}

function measureIndent(s: string): number {
  let n = 0;
  for (const ch of s) {
    if (ch === ' ') n += 1;
    else if (ch === '\t') n += 2;
    else break;
  }
  return n;
}

export function computeCodeMetrics(code: string): CodeMetrics {
  if (!code) {
    return {
      lines: 0, nonBlankLines: 0, blankLines: 0, commentLines: 0,
      commentRatio: 0, avgLineLength: 0, maxLineLength: 0,
      branches: 0, branchDensity: 0, maxNesting: 0, todoCount: 0,
    };
  }

  const rawLines = code.split('\n');
  let blank = 0;
  let comment = 0;
  let codeLines = 0;
  let todo = 0;
  let maxLen = 0;
  let totalLen = 0;
  let branches = 0;
  let maxNesting = 0;
  let insideBlock = false;

  const codeOnly: string[] = [];
  const indents: number[] = [];

  for (const line of rawLines) {
    totalLen += line.length;
    if (line.length > maxLen) maxLen = line.length;
    if (TODO_PATTERN.test(line)) todo += 1;

    const info = classifyLine(line, insideBlock);
    insideBlock = info.endsBlockComment;

    if (info.kind === 'blank') blank += 1;
    else if (info.kind === 'comment') comment += 1;
    else {
      codeLines += 1;
      codeOnly.push(info.stripped);
      indents.push(measureIndent(line));
    }
  }

  for (const c of codeOnly) {
    const m = c.match(BRANCH_KEYWORDS);
    if (m) branches += m.length;
  }

  if (indents.length > 0) {
    const base = Math.min(...indents);
    const nesting = indents.map((n) => n - base);
    maxNesting = Math.max(...nesting);
  }

  const nonBlank = rawLines.length - blank;
  const commentRatio = codeLines + comment === 0 ? 0 : comment / (codeLines + comment);
  const branchDensity = codeLines === 0 ? 0 : branches / codeLines;
  const avgLineLength = rawLines.length === 0 ? 0 : totalLen / rawLines.length;

  return {
    lines: rawLines.length,
    nonBlankLines: nonBlank,
    blankLines: blank,
    commentLines: comment,
    commentRatio: Math.round(commentRatio * 1000) / 1000,
    avgLineLength: Math.round(avgLineLength * 10) / 10,
    maxLineLength: maxLen,
    branches,
    branchDensity: Math.round(branchDensity * 1000) / 1000,
    maxNesting,
    todoCount: todo,
  };
}
