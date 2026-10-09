import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { StateEffect, type Extension } from "@codemirror/state";
import {
  Registry,
  parseRawGrammar,
  INITIAL,
  type IGrammar,
  type StateStack,
  type IToken,
} from "vscode-textmate";
import { loadWASM, OnigScanner, OnigString } from "vscode-oniguruma";
import onigWasm from "vscode-oniguruma/release/onig.wasm?url&inline";
import { python } from "@codemirror/lang-python";
import { javascript } from "@codemirror/lang-javascript";
import { json, jsonParseLinter } from "@codemirror/lang-json";
import { cpp } from "@codemirror/lang-cpp";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { markdown } from "@codemirror/lang-markdown";
import { StreamLanguage } from "@codemirror/language";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { yaml } from "@codemirror/legacy-modes/mode/yaml";
import { go } from "@codemirror/legacy-modes/mode/go";
import { rust } from "@codemirror/legacy-modes/mode/rust";
import { r } from "@codemirror/legacy-modes/mode/r";
import { standardSQL } from "@codemirror/legacy-modes/mode/sql";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { linter, lintGutter } from "@codemirror/lint";

const grammarSources = import.meta.glob("./grammars/*.tmLanguage.json", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;
const rawGrammars = Object.values(grammarSources).map((source) =>
  parseRawGrammar(source, "grammar.json"),
);
let registryPromise: Promise<Registry> | undefined;
function grammar(scope: string): Promise<IGrammar | null> {
  registryPromise ??= Promise.resolve()
    .then(() => {
      // Vite embeds this trusted npm asset so packaged file:// windows need no fetch.
      const bytes = Uint8Array.from(atob(onigWasm.split(",")[1]), (character) =>
        character.charCodeAt(0),
      );
      return loadWASM(bytes);
    })
    .then(
      () =>
        new Registry({
          onigLib: Promise.resolve({
            createOnigScanner: (patterns) => new OnigScanner(patterns),
            createOnigString: (text) => new OnigString(text),
          }),
          loadGrammar: async (name) =>
            rawGrammars.find((raw) => raw.scopeName === name) ?? null,
        }),
    );
  return registryPromise.then((registry) => registry.loadGrammar(scope));
}
// Resolve the most specific scope first, preserving the upstream grammar's semantics.
function tokenClass(scopes: string[]): string {
  for (const scope of [...scopes].reverse()) {
    if (scope.startsWith("comment")) return "syn-comment";
    if (scope.startsWith("invalid")) return "syn-invalid";
    if (/punctuation.*(math|begin|end|brace|bracket)/.test(scope))
      return "syn-delimiter";
    if (
      /entity.name.*(label|reference|citation)|constant.other.reference/.test(
        scope,
      )
    )
      return "syn-reference";
    if (/entity.name.*(section|part|chapter)|markup.heading/.test(scope))
      return "syn-heading";
    if (/entity.name.(function|environment)|support.function/.test(scope))
      return "syn-function";
    if (scope.startsWith("keyword"))
      return /operator/.test(scope) ? "syn-operator" : "syn-keyword";
    if (scope.startsWith("storage")) return "syn-keyword";
    if (scope.startsWith("constant.numeric")) return "syn-number";
    if (scope.startsWith("constant")) return "syn-constant";
    if (
      scope.startsWith("variable") ||
      scope.startsWith("entity.other.attribute")
    )
      return "syn-variable";
    if (scope.startsWith("string")) return "syn-string";
    if (scope.startsWith("support")) return "syn-type";
    if (scope.startsWith("punctuation")) return "syn-punctuation";
    if (/meta.math|markup.math/.test(scope)) return "syn-math";
  }
  return "";
}
const grammarReady = StateEffect.define<null>();
type CachedLine = {
  text: string;
  input: StateStack;
  output: StateStack;
  tokens: IToken[];
};
function textmate(scope: string): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet = Decoration.none;
      private tokenizer: IGrammar | null = null;
      private lines: CachedLine[] = [];
      private destroyed = false;
      constructor(private view: EditorView) {
        void grammar(scope)
          .then((tokenizer) => {
            if (this.destroyed) return;
            this.tokenizer = tokenizer;
            view.dispatch({ effects: grammarReady.of(null) });
          })
          .catch((error) =>
            console.error("Manuscript syntax highlighting:", error),
          );
      }
      update(update: ViewUpdate) {
        if (
          this.tokenizer &&
          (update.docChanged ||
            update.transactions.some((t) =>
              t.effects.some((e) => e.is(grammarReady)),
            ))
        )
          this.highlight();
      }
      private highlight() {
        if (!this.tokenizer) return;
        const marks = [];
        const lines: CachedLine[] = [];
        let stack = INITIAL;
        for (let n = 1; n <= this.view.state.doc.lines; n++) {
          const line = this.view.state.doc.line(n);
          const cached = this.lines[n - 1];
          let entry: CachedLine;
          if (cached && cached.text === line.text && cached.input.equals(stack))
            entry = cached;
          else {
            const result = this.tokenizer.tokenizeLine(line.text, stack);
            entry = {
              text: line.text,
              input: stack,
              output: result.ruleStack,
              tokens: result.tokens,
            };
          }
          lines.push(entry);
          stack = entry.output;
          for (const token of entry.tokens) {
            const cls = tokenClass(token.scopes);
            const to = Math.min(token.endIndex, line.length);
            if (cls && token.startIndex < to)
              marks.push(
                Decoration.mark({ class: cls }).range(
                  line.from + token.startIndex,
                  line.from + to,
                ),
              );
          }
        }
        this.lines = lines;
        this.decorations = Decoration.set(marks, true);
      }
      destroy() {
        this.destroyed = true;
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}
const latexSyntax = textmate("text.tex.latex");
const texSyntax = textmate("text.tex");
const bibtexSyntax = textmate("text.bibtex");
const bstSyntax = textmate("source.bst");
const doctexSyntax = textmate("text.tex.doctex");
const languages: Record<string, { name: string; extensions: Extension[] }> = {
  tex: { name: "LaTeX", extensions: [latexSyntax] },
  ltx: { name: "LaTeX", extensions: [latexSyntax] },
  sty: { name: "TeX", extensions: [texSyntax] },
  cls: { name: "TeX", extensions: [texSyntax] },
  bbx: { name: "TeX", extensions: [texSyntax] },
  cbx: { name: "TeX", extensions: [texSyntax] },
  hpp: { name: "C++", extensions: [cpp()] },
  dtx: { name: "DocTeX", extensions: [doctexSyntax] },
  bib: { name: "BibTeX", extensions: [bibtexSyntax] },
  bst: { name: "BibTeX style", extensions: [bstSyntax] },
  py: { name: "Python", extensions: [python()] },
  js: { name: "JavaScript", extensions: [javascript()] },
  mjs: { name: "JavaScript", extensions: [javascript()] },
  cjs: { name: "JavaScript", extensions: [javascript()] },
  jsx: { name: "JSX", extensions: [javascript({ jsx: true })] },
  ts: { name: "TypeScript", extensions: [javascript({ typescript: true })] },
  tsx: {
    name: "TSX",
    extensions: [javascript({ jsx: true, typescript: true })],
  },
  json: {
    name: "JSON",
    extensions: [json(), linter(jsonParseLinter()), lintGutter()],
  },
  c: { name: "C", extensions: [cpp()] },
  h: { name: "C / C++", extensions: [cpp()] },
  cpp: { name: "C++", extensions: [cpp()] },
  cc: { name: "C++", extensions: [cpp()] },
  css: { name: "CSS", extensions: [css()] },
  html: { name: "HTML", extensions: [html()] },
  md: { name: "Markdown", extensions: [markdown()] },
  sh: { name: "Shell", extensions: [StreamLanguage.define(shell)] },
  bash: { name: "Bash", extensions: [StreamLanguage.define(shell)] },
  zsh: { name: "Zsh", extensions: [StreamLanguage.define(shell)] },
  yaml: { name: "YAML", extensions: [StreamLanguage.define(yaml)] },
  yml: { name: "YAML", extensions: [StreamLanguage.define(yaml)] },
  go: { name: "Go", extensions: [StreamLanguage.define(go)] },
  rs: { name: "Rust", extensions: [StreamLanguage.define(rust)] },
  r: { name: "R", extensions: [StreamLanguage.define(r)] },
  sql: { name: "SQL", extensions: [StreamLanguage.define(standardSQL)] },
  toml: { name: "TOML", extensions: [StreamLanguage.define(toml)] },
};
export function fileLanguage(file: string) {
  return (
    languages[file.split(".").pop()?.toLowerCase() ?? ""] ?? {
      name: "Text",
      extensions: [],
    }
  );
}
