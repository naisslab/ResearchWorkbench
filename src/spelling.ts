import {
  Decoration,
  EditorView,
  MatchDecorator,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";

// Commands with their key-like arguments, math, and comments are skipped so
// only prose is checked.
const latexCode = new MatchDecorator({
  regexp:
    /\\(?:[a-zA-Z]*(?:cite|ref)[a-zA-Z]*|label|input|include|subfile|import|subimport|usepackage|documentclass|begin|end|bibliography(?:style)?|addbibresource|includegraphics|url|href|newcommand|renewcommand|definecolor)\*?(?:\s*\[[^\]]*\])*\s*\{[^}]*\}|\\\(.*?\\\)|\\\[.*?\\\]|\\[a-zA-Z@]+\*?|\\.|\$\$[^$]*\$\$|\$(?:\\.|[^$\\])+\$|(?<!\\)%.*/g,
  decoration: Decoration.mark({ attributes: { spellcheck: "false" } }),
});
const skipLatexCode = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = latexCode.createDeco(view);
    }
    update(update: ViewUpdate) {
      this.decorations = latexCode.updateDeco(update, this.decorations);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

export const spellChecked = (file: string) => /\.(tex|ltx|md|txt)$/i.test(file);

/** Chromium's spell checker on prose; the context menu offers suggestions. */
export const spelling = (file: string) => [
  EditorView.contentAttributes.of({
    spellcheck: "true",
    autocorrect: "off",
    autocapitalize: "off",
  }),
  /\.(tex|ltx)$/i.test(file) ? skipLatexCode : [],
];
