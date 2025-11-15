// MDX import detection (matches `import X from "..."` and `import "..."`)
export const MDX_IMPORT_RE = /^\s*import\s+(?:[^'";]+?\s+from\s+)?['"][^'"]+['"]\s*;?\s*$/;

// Lines starting with ':::'
export const TRIPLE_COLON_RE = /^\s*:::/;

// Lines that only contain an opening or closing XML tag or HTML comment
export const XML_TAG_ONLY_RE = /^\s*<\/?[a-zA-Z][a-zA-Z0-9\-]*(?:\s[^>]*)?\/?>\s*$/;
export const HTML_COMMENT_ONLY_RE = /^\s*<!--.*?-->\s*$/;

// Markdown footnote or reference definition lines, e.g. `[tags]: /path` or `[^1]: text`
export const FOOTNOTE_DEF_RE = /^\s*\[\^?[^\]]+\]:[ \t]+/;

// Lines that only contain a list symbol (- or *) and a Markdown link
export const LIST_LINK_ONLY_RE = /^\s*[-*]\s+\[[^\]]*\]\([^)]*\)\.?\s*$/;

// Markdown table detection (pipe rows and header separator lines)
export const MD_TABLE_SEPARATOR_RE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/;
export const MD_TABLE_ROW_RE = /^\s*\|.*\|.*$/;

// ATX heading lines starting with up to 3 spaces and 1-6 '#'
export const ATX_HEADING_RE = /^\s{0,3}#{1,6}(?:\s|$)/;

// Hyperlink detection within a line
export const HYPERLINK_RE = /\[.*?\]/g;
