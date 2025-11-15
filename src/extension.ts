// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

import {
  MDX_IMPORT_RE,
  TRIPLE_COLON_RE,
  XML_TAG_ONLY_RE,
  HTML_COMMENT_ONLY_RE,
  FOOTNOTE_DEF_RE,
  LIST_LINK_ONLY_RE,
  MD_TABLE_SEPARATOR_RE,
  MD_TABLE_ROW_RE,
  ATX_HEADING_RE,
} from "./reConsts";

import {
  StartEndInfo,
  getFrontMatterRange,
  getLineIndent,
  getReflowedText,
  getStartLine,
  getEndLine,
  getSettings,
  OtherInfo
} from "./testable";

// Helper functions

function paragraphHasMdxImport(document: vscode.TextDocument, startLine: number, endLine: number): boolean {
  for (let i = startLine; i <= endLine; i++) {
    if (MDX_IMPORT_RE.test(document.lineAt(i).text)) {
      return true;
    }
  }
  return false;
}

// Compute the first content paragraph range (after front matter, blank lines, and MDX imports)
function getFirstContentParagraphRange(document: vscode.TextDocument): vscode.Range | undefined {
  const fm = getFrontMatterRange(document);
  const lineCount = document.lineCount;
  let i = fm ? fm.end.line + 1 : 0;

  // skip blank lines and MDX import lines
  while (i < lineCount) {
    const t = document.lineAt(i).text;
    if (t.trim() === "" || MDX_IMPORT_RE.test(t)) {
      i++;
      continue;
    }
    break;
  }
  if (i >= lineCount) {
    return undefined;
  }

  const lineAtFunc = (line: number) => document.lineAt(line);
  const midLine = document.lineAt(i);
  const o = new OtherInfo();
  const s = getStartLine(lineAtFunc, midLine);
  const e = getEndLine(lineAtFunc, midLine, lineCount - 1, o);
  return new vscode.Range(s.lineNumber, 0, e.lineNumber, document.lineAt(e.lineNumber).text.length);
}

function lineStartsWithTripleColon(text: string): boolean {
  return TRIPLE_COLON_RE.test(text);
}

function lineIsXmlTagOnly(text: string): boolean {
  return XML_TAG_ONLY_RE.test(text) || HTML_COMMENT_ONLY_RE.test(text);
}

function paragraphHasFootnoteDef(document: vscode.TextDocument, startLine: number, endLine: number): boolean {
  for (let i = startLine; i <= endLine; i++) {
    if (FOOTNOTE_DEF_RE.test(document.lineAt(i).text)) {
      return true;
    }
  }
  return false;
}

function paragraphHasListLinkOnly(document: vscode.TextDocument, startLine: number, endLine: number): boolean {
  for (let i = startLine; i <= endLine; i++) {
    if (LIST_LINK_ONLY_RE.test(document.lineAt(i).text)) {
      return true;
    }
  }
  return false;
}

function paragraphHasMarkdownTable(document: vscode.TextDocument, startLine: number, endLine: number): boolean {
  for (let i = startLine; i <= endLine; i++) {
    const t = document.lineAt(i).text;
    if (MD_TABLE_SEPARATOR_RE.test(t) || MD_TABLE_ROW_RE.test(t)) {
      return true;
    }
  }
  return false;
}

function paragraphHasAtxHeading(document: vscode.TextDocument, startLine: number, endLine: number): boolean {
  for (let i = startLine; i <= endLine; i++) {
    if (ATX_HEADING_RE.test(document.lineAt(i).text)) {
      return true;
    }
  }
  return false;
}

// Detect fenced code block ranges (``` or ~~~), allowing up to 3 leading spaces
function getFencedCodeBlockRanges(document: vscode.TextDocument): vscode.Range[] {
  const ranges: vscode.Range[] = [];
  const openRe = /^\s{0,3}(`{3,}|~{3,})/;
  let inBlock = false;
  let blockStart = 0;
  let fenceChar = "";
  let fenceLen = 0;

  for (let i = 0; i < document.lineCount; i++) {
    const text = document.lineAt(i).text;

    if (!inBlock) {
      const m = text.match(openRe);
      if (m) {
        const seq = m[1];
        fenceChar = seq[0]; // ` or ~
        fenceLen = seq.length;
        inBlock = true;
        blockStart = i;
      }
      continue;
    }

    // in block -> look for matching closing fence (same char, at least same length)
    const closeRe = new RegExp(`^\\s{0,3}${fenceChar}{${fenceLen},}\\s*$`);
    if (closeRe.test(text)) {
      const endLen = document.lineAt(i).text.length;
      ranges.push(new vscode.Range(blockStart, 0, i, endLen));
      inBlock = false;
      fenceChar = "";
      fenceLen = 0;
    }
  }

  if (inBlock) {
    // Unterminated fence until EOF
    const last = document.lineCount - 1;
    ranges.push(new vscode.Range(blockStart, 0, last, document.lineAt(last).text.length));
  }

  return ranges;
}

// Given a set of ranges, find one that contains a line
function findRangeContainingLine(ranges: vscode.Range[], line: number): vscode.Range | undefined {
  return ranges.find(r => line >= r.start.line && line <= r.end.line);
}

function rangeOverlapsAny(startLine: number, endLine: number, ranges: vscode.Range[]): boolean {
  return ranges.some(r => !(endLine < r.start.line || startLine > r.end.line));
}

// Detect MDX/JSX expression ranges delimited by balanced { ... } across lines (outside fenced code)
function getJsxExpressionRanges(document: vscode.TextDocument, fencedRanges: vscode.Range[]): vscode.Range[] {
  const ranges: vscode.Range[] = [];
  let depth = 0;
  let currentStart: number | undefined = undefined;

  const isInFence = (line: number) => !!findRangeContainingLine(fencedRanges, line);

  for (let i = 0; i < document.lineCount; i++) {
    const text = document.lineAt(i).text;

    if (isInFence(i)) {
      // If we were inside an expression range, close it before skipping fenced content
      if (currentStart !== undefined) {
        ranges.push(new vscode.Range(currentStart, 0, i - 1, document.lineAt(i - 1).text.length));
        currentStart = undefined;
      }
      continue;
    }

    // Scan the line while ignoring inline code spans delimited by backticks
    let inInline = false;
    let inlineTickRun = 0; // number of backticks that opened the inline span
    let lineInside = depth > 0;

    for (let idx = 0; idx < text.length; idx++) {
      const ch = text[idx];

      if (ch === '`') {
        // Count run length
        let run = 1;
        while (idx + run < text.length && text[idx + run] === '`') {
          run++;
        }
        if (!inInline) {
          inInline = true;
          inlineTickRun = run;
        } else if (run >= inlineTickRun) {
          inInline = false;
          inlineTickRun = 0;
        }
        idx += run - 1; // advance
        continue;
      }

      if (inInline) {
        continue;
      }

      if (ch === '{') {
        depth++;
        lineInside = true; // entering expression on this line
      } else if (ch === '}') {
        depth = Math.max(0, depth - 1);
      }
    }

    if (lineInside) {
      if (currentStart === undefined) {
        currentStart = i;
      }
    } else if (currentStart !== undefined) {
      // Previous range ended on the previous line
      const prev = i - 1;
      ranges.push(new vscode.Range(currentStart, 0, prev, document.lineAt(prev).text.length));
      currentStart = undefined;
    }
  }

  if (currentStart !== undefined) {
    const last = document.lineCount - 1;
    ranges.push(new vscode.Range(currentStart, 0, last, document.lineAt(last).text.length));
  }

  return ranges;
}

interface LineContext {
    type: 'list' | 'blockquote' | 'paragraph';
    indent: string;
    prefix: string;
    content: string;
}

interface ParagraphSkipContext {
  document: vscode.TextDocument;
  lineStart: number;
  lineEnd: number;
  fencedRanges: vscode.Range[];
  jsxExprRanges: vscode.Range[];
  frontMatterRange: vscode.Range | undefined;
  settings: ReturnType<typeof getSettings>;
}

function shouldSkipParagraph(ctx: ParagraphSkipContext): boolean {
  const { document, lineStart, lineEnd, fencedRanges, jsxExprRanges, frontMatterRange, settings } = ctx;

  // Skip if paragraph overlaps front matter
  if (frontMatterRange && !(lineEnd < frontMatterRange.start.line || lineStart > frontMatterRange.end.line)) {
    return true;
  }

  // Skip if paragraph overlaps fenced code or JSX expressions
  if (rangeOverlapsAny(lineStart, lineEnd, fencedRanges) || rangeOverlapsAny(lineStart, lineEnd, jsxExprRanges)) {
    return true;
  }

  // Skip paragraphs that include ATX headings
  if (paragraphHasAtxHeading(document, lineStart, lineEnd)) {
    return true;
  }

  // Skip paragraphs that contain MDX import statements
  if (paragraphHasMdxImport(document, lineStart, lineEnd)) {
    return true;
  }

  // Skip paragraphs that contain Markdown footnote/reference definitions
  if (paragraphHasFootnoteDef(document, lineStart, lineEnd)) {
    return true;
  }

  // Skip paragraphs that contain Markdown tables
  if (paragraphHasMarkdownTable(document, lineStart, lineEnd)) {
    return true;
  }

  // Skip paragraphs that contain only list symbols and Markdown links
  if (paragraphHasListLinkOnly(document, lineStart, lineEnd)) {
    return true;
  }

  // Skip first paragraph if configured
  if (settings.neverReflowFirstParagraph) {
    const firstPara = getFirstContentParagraphRange(document);
    if (firstPara) {
      const firstStart = firstPara.start.line;
      const firstEnd = firstPara.end.line;
      if (!(lineEnd < firstStart || lineStart > firstEnd)) {
        return true;
      }
    }
  }

  // Do not touch standalone ':::' lines
  if (lineStart === lineEnd && lineStartsWithTripleColon(document.lineAt(lineStart).text)) {
    return true;
  }

  // Do not touch lines that only contain XML tags
  if (lineStart === lineEnd && lineIsXmlTagOnly(document.lineAt(lineStart).text)) {
    return true;
  }

  return false;
}

function getLineContext(line: vscode.TextLine): LineContext {
    const text = line.text;
    const listMatch = text.match(/^(\s*)([*\-+]|\d+\.)\s+(.*)$/);
    
    if (listMatch) {
        return {
            type: 'list',
            indent: listMatch[1],
            prefix: listMatch[2],
            content: listMatch[3]
        };
    }
    
    const blockquoteMatch = text.match(/^(\s*)(>+)\s*(.*)$/);
    if (blockquoteMatch) {
        return {
            type: 'blockquote',
            indent: blockquoteMatch[1],
            prefix: blockquoteMatch[2],
            content: blockquoteMatch[3]
        };
    }
    
    return {
        type: 'paragraph',
        indent: text.match(/^(\s*)/)?.[1] || '',
        prefix: '',
        content: text.trim()
    };
}

function reflowLines(
    document: vscode.TextDocument,
    startLine: number,
    endLine: number,
    preferredLineLength: number
): string[] {
    const lines: string[] = [];
    const context = getLineContext(document.lineAt(startLine));
    
    // Collect all text
    for (let i = startLine; i <= endLine; i++) {
        const line = document.lineAt(i);
        const lineContext = getLineContext(line);
        lines.push(lineContext.content);
    }
    
    // Join and split words
    const allText = lines.join(' ').trim();
    const words = allText.split(/\s+/);
    
    // Reflow into new lines
    const reflowedLines: string[] = [];
    let currentLine = '';
    const prefixLength = context.indent.length + (context.prefix ? context.prefix.length + 1 : 0);
    const effectiveLength = preferredLineLength - prefixLength;
    
    for (const word of words) {
        if (currentLine === '') {
            currentLine = word;
        } else if ((currentLine + ' ' + word).length <= effectiveLength) {
            currentLine += ' ' + word;
        } else {
            reflowedLines.push(currentLine);
            currentLine = word;
        }
    }
    
    if (currentLine !== '') {
        reflowedLines.push(currentLine);
    }
    
    // Add prefix back
    return reflowedLines.map((line, index) => {
        if (context.type === 'list') {
            return index === 0
                ? `${context.indent}${context.prefix} ${line}`
                : `${context.indent}${' '.repeat(context.prefix.length + 1)}${line}`;
        } else if (context.type === 'blockquote') {
            return `${context.indent}${context.prefix} ${line}`;
        } else {
            return `${context.indent}${line}`;
        }
    });
}

export function reflow() {
  let editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('Open a file first to use Reflow Markdown.');
    return;
  }

  // Skip when inside front matter
  const fm = getFrontMatterRange(editor.document);
  const position = editor.selection.active;
  if (fm && fm.contains(position)) {
    return; // do nothing in front matter
  }

  // Skip when inside fenced code block or JSX expression
  const fenced = getFencedCodeBlockRanges(editor.document);
  const jsxExpr = getJsxExpressionRanges(editor.document, fenced);
  if (findRangeContainingLine(fenced, position.line) || findRangeContainingLine(jsxExpr, position.line)) {
    return;
  }

  // Skip when on a heading line
  if (ATX_HEADING_RE.test(editor.document.lineAt(position.line).text)) {
    return;
  }

  let settings = getSettings(vscode.workspace.getConfiguration("reflowMarkdown"));
  const selection = editor.selection;
  let sei = GetStartEndInfo(editor);

  const skipContext: ParagraphSkipContext = {
    document: editor.document,
    lineStart: sei.lineStart,
    lineEnd: sei.lineEnd,
    fencedRanges: fenced,
    jsxExprRanges: jsxExpr,
    frontMatterRange: fm,
    settings
  };

  if (shouldSkipParagraph(skipContext)) {
    return;
  }

  const reflowedLines = reflowLines(editor.document, sei.lineStart, sei.lineEnd, settings.preferredLineLength);
  let applied = editor.edit(function (textEditorEdit) {
    textEditorEdit.replace(new vscode.Range(sei.lineStart, 0, sei.lineEnd, editor.document.lineAt(sei.lineEnd).text.length), reflowedLines.join('\n'));
  });

  // reset selection (TODO may be contra-intuitive... maybe rather reset to single position, always?)
  editor.selection = selection;
  return applied;
}

export function activate(context: vscode.ExtensionContext) {
  let disposable = vscode.commands.registerCommand("reflow-markdown.reflowMarkdown", reflow);
  context.subscriptions.push(disposable);

  // If you registered formatting providers previously, ensure they skip front matter:
  const selector: vscode.DocumentSelector = [
    { language: "markdown", scheme: "file" },
    { language: "markdown", scheme: "untitled" }
  ];

  class MarkdownReflowFormatter implements vscode.DocumentFormattingEditProvider, vscode.DocumentRangeFormattingEditProvider {
    provideDocumentFormattingEdits(document: vscode.TextDocument): vscode.TextEdit[] {
      const settings = getSettings(vscode.workspace.getConfiguration("reflowMarkdown", document.uri));
      return computeReflowEdits(document, undefined, settings);
    }
    provideDocumentRangeFormattingEdits(document: vscode.TextDocument, range: vscode.Range): vscode.TextEdit[] {
      const settings = getSettings(vscode.workspace.getConfiguration("reflowMarkdown", document.uri));
      return computeReflowEdits(document, range, settings);
    }
  }

  context.subscriptions.push(
    vscode.languages.registerDocumentFormattingEditProvider(selector, new MarkdownReflowFormatter())
  );
  context.subscriptions.push(
    vscode.languages.registerDocumentRangeFormattingEditProvider(selector, new MarkdownReflowFormatter())
  );
}

// Ensure formatting never edits front matter
function computeReflowEdits(
  document: vscode.TextDocument,
  targetRange: vscode.Range | undefined,
  settings: ReturnType<typeof getSettings>
): vscode.TextEdit[] {
  const edits: vscode.TextEdit[] = [];
  const fm = getFrontMatterRange(document);
  const fenced = getFencedCodeBlockRanges(document);
  const jsxExpr = getJsxExpressionRanges(document, fenced);

  const hasRange = !!targetRange;
  const startLine = hasRange ? targetRange!.start.line : 0;
  const endLine = hasRange ? targetRange!.end.line : document.lineCount - 1;

  // If whole document: start after front matter
  let i = (!hasRange && fm) ? Math.max(startLine, fm.end.line + 1) : startLine;

  // If selection entirely inside front matter: nothing to do
  if (hasRange && fm && fm.contains(targetRange!)) {
    return edits;
  }

  const lineAtFunc = (line: number) => document.lineAt(line);

  while (i <= endLine) {
    // Skip lines inside front matter
    if (fm && i >= fm.start.line && i <= fm.end.line) {
      i = fm.end.line + 1;
      continue;
    }

    // Skip lines inside fenced code blocks
    const fencedRange = findRangeContainingLine(fenced, i);
    if (fencedRange) {
      i = fencedRange.end.line + 1;
      continue;
    }

    // Skip lines inside JSX expression ranges
    const jsxRange = findRangeContainingLine(jsxExpr, i);
    if (jsxRange) {
      i = jsxRange.end.line + 1;
      continue;
    }

    const midLine = document.lineAt(i);
    const o = new OtherInfo();
    const s = getStartLine(lineAtFunc, midLine);
    const e = getEndLine(lineAtFunc, midLine, document.lineCount - 1, o);
    o.indents = getLineIndent(s.firstNonWhitespaceCharacterIndex, s.text);

    const sei: StartEndInfo = {
      lineStart: s.lineNumber,
      lineEnd: e.lineNumber,
      otherInfo: o
    };

    // For range formatting: skip paragraphs outside or crossing the selection
    if (hasRange) {
      if (sei.lineEnd < startLine) { i = sei.lineEnd + 1; continue; }
      if (sei.lineStart > endLine) { break; }
      if (sei.lineStart < startLine || sei.lineEnd > endLine) { i = sei.lineEnd + 1; continue; }
    }

    const skipContext: ParagraphSkipContext = {
      document,
      lineStart: sei.lineStart,
      lineEnd: sei.lineEnd,
      fencedRanges: fenced,
      jsxExprRanges: jsxExpr,
      frontMatterRange: fm,
      settings
    };

    if (shouldSkipParagraph(skipContext)) {
      i = sei.lineEnd + 1;
      continue;
    }

    const rng = new vscode.Range(
      sei.lineStart, 0,
      sei.lineEnd, document.lineAt(sei.lineEnd).text.length
    );
    const original = document.getText(rng);
    const reflowed = getReflowedText(sei, original, settings);
    if (original !== reflowed) {
      edits.push(vscode.TextEdit.replace(rng, reflowed));
    }

    i = sei.lineEnd + 1;
  }

  return edits;
}

export function deactivate() {
}

export function GetStartEndInfo(editor: vscode.TextEditor): StartEndInfo {

    const midLineNum = editor.selection.active.line;
    let midLine = editor.document.lineAt(midLineNum);
    let maxLineNum = editor.document.lineCount - 1; //max line NUMBER is line COUNT minus 1
    let lineAtFunc = (line: number) => { return editor.document.lineAt(line); };

    let o = new OtherInfo();
    let s = getStartLine(lineAtFunc, midLine);
    let e = getEndLine(lineAtFunc, midLine, maxLineNum, o);
    o.indents = getLineIndent(s.firstNonWhitespaceCharacterIndex, s.text);

    return  {
        lineStart: s.lineNumber,
        lineEnd: e.lineNumber,
        otherInfo: o
    };

}