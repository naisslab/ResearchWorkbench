import {
  Decoration,
  ViewPlugin,
  type DecorationSet,
  type EditorView,
  type ViewUpdate,
} from "@codemirror/view";
import { StateEffect, type Extension } from "@codemirror/state";
import { StreamLanguage, type StreamParser } from "@codemirror/language";
import type { IGrammar, IToken, Registry, StateStack } from "vscode-textmate";

const grammarSources = import.meta.glob<string>(
  "./grammars/*.tmLanguage.json",
  {
    query: "?raw",
    import: "default",
  },
);
let initial: StateStack;
let registryPromise: Promise<Registry> | undefined;
async function createRegistry() {
  const [textmate, oniguruma, wasm, sources] = await Promise.all([
    import("vscode-textmate"),
    import("vscode-oniguruma"),
    // Vite embeds this trusted npm asset so packaged file:// windows need no fetch.
    import("vscode-oniguruma/release/onig.wasm?url&inline"),
    Promise.all(Object.values(grammarSources).map((load) => load())),
  ]);
  const binary = atob(wasm.default.split(",")[1]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  await oniguruma.loadWASM(bytes);
  initial = textmate.INITIAL;
  const grammars = sources.map((source) =>
    textmate.parseRawGrammar(source, "grammar.json"),
  );
  return new textmate.Registry({
    onigLib: Promise.resolve({
      createOnigScanner: (patterns) => new oniguruma.OnigScanner(patterns),
      createOnigString: (text) => new oniguruma.OnigString(text),
    }),
    loadGrammar: async (name) =>
      grammars.find((raw) => raw.scopeName === name) ?? null,
  });
}
function grammar(scope: string) {
  registryPromise ??= createRegistry();
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
const marks = new Map<string, Decoration | null>();
function spans(tokens: IToken[], length: number) {
  const result: [number, number, Decoration][] = [];
  for (const token of tokens) {
    const key = token.scopes.join(" ");
    if (!marks.has(key)) {
      const cls = tokenClass(token.scopes);
      marks.set(key, cls ? Decoration.mark({ class: cls }) : null);
    }
    const mark = marks.get(key);
    const end = Math.min(token.endIndex, length);
    if (mark && token.startIndex < end)
      result.push([token.startIndex, end, mark]);
  }
  return result;
}
const grammarReady = StateEffect.define<null>();
type CachedLine = {
  text: string;
  input: StateStack;
  output: StateStack;
  spans: [number, number, Decoration][];
};
/**
 * Tokenizes from the top of the document down to the end of the viewport and
 * decorates only the viewport. A cached line is reused while its text and its
 * incoming tokenizer state are unchanged, so an edit re-tokenizes from the
 * edited line until the states converge again.
 */
function textmate(scope: string): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet = Decoration.none;
      private tokenizer: IGrammar | null = null;
      private lines: (CachedLine | undefined)[] = [];
      /** How many leading cache entries are known to match the document. */
      private valid = 0;
      private destroyed = false;
      constructor(view: EditorView) {
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
        if (update.docChanged) {
          let from = update.startState.doc.length;
          update.changes.iterChangedRanges((fromA) => {
            from = Math.min(from, fromA);
          });
          const start = update.startState.doc.lineAt(from).number - 1;
          const added = update.state.doc.lines - update.startState.doc.lines;
          // Keep cached lines below the edit aligned with their new line numbers.
          if (added)
            this.lines = [
              ...this.lines.slice(0, start),
              ...Array<undefined>(Math.max(0, added)),
              ...this.lines.slice(start - Math.min(0, added)),
            ];
          this.valid = Math.min(this.valid, start);
        }
        if (
          this.tokenizer &&
          (update.docChanged ||
            update.viewportChanged ||
            update.transactions.some((t) =>
              t.effects.some((e) => e.is(grammarReady)),
            ))
        )
          this.decorations = this.highlight(update.view, this.tokenizer);
      }
      private highlight(view: EditorView, tokenizer: IGrammar) {
        const { doc } = view.state;
        const last = doc.lineAt(view.viewport.to).number;
        let stack = this.lines[this.valid - 1]?.output ?? initial;
        for (let n = this.valid + 1; n <= last; n++) {
          const { text } = doc.line(n);
          let cached = this.lines[n - 1];
          if (!cached || cached.text !== text || !cached.input.equals(stack)) {
            const result = tokenizer.tokenizeLine(text, stack);
            cached = this.lines[n - 1] = {
              text,
              input: stack,
              output: result.ruleStack,
              spans: spans(result.tokens, text.length),
            };
          }
          stack = cached.output;
        }
        this.valid = Math.max(this.valid, last);
        const ranges = [];
        for (let n = doc.lineAt(view.viewport.from).number; n <= last; n++) {
          const { from } = doc.line(n);
          for (const [start, end, mark] of this.lines[n - 1]!.spans)
            ranges.push(mark.range(from + start, from + end));
        }
        return Decoration.set(ranges);
      }
      destroy() {
        this.destroyed = true;
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}
type Load = () => Promise<Extension>;
function once(load: Load): Load {
  let loaded: Promise<Extension> | undefined;
  return () => (loaded ??= load());
}
const tm = (scope: string) => once(async () => textmate(scope));
const legacy = (mode: () => Promise<StreamParser<unknown>>) =>
  once(async () => StreamLanguage.define(await mode()));
const javascript = (config?: { jsx?: boolean; typescript?: boolean }) =>
  once(() =>
    import("@codemirror/lang-javascript").then((m) => m.javascript(config)),
  );
const languages: [extensions: string, name: string, load: Load][] = [
  ["tex ltx", "LaTeX", tm("text.tex.latex")],
  ["sty cls bbx cbx", "TeX", tm("text.tex")],
  ["dtx", "DocTeX", tm("text.tex.doctex")],
  ["bib", "BibTeX", tm("text.bibtex")],
  ["bst", "BibTeX style", tm("source.bst")],
  [
    "py",
    "Python",
    once(() => import("@codemirror/lang-python").then((m) => m.python())),
  ],
  ["js mjs cjs", "JavaScript", javascript()],
  ["jsx", "JSX", javascript({ jsx: true })],
  ["ts", "TypeScript", javascript({ typescript: true })],
  ["tsx", "TSX", javascript({ jsx: true, typescript: true })],
  [
    "json",
    "JSON",
    once(async () => {
      const [{ json, jsonParseLinter }, { linter, lintGutter }] =
        await Promise.all([
          import("@codemirror/lang-json"),
          import("@codemirror/lint"),
        ]);
      return [json(), linter(jsonParseLinter()), lintGutter()];
    }),
  ],
  [
    "c h cc cpp hpp",
    "C / C++",
    once(() => import("@codemirror/lang-cpp").then((m) => m.cpp())),
  ],
  [
    "css",
    "CSS",
    once(() => import("@codemirror/lang-css").then((m) => m.css())),
  ],
  [
    "html",
    "HTML",
    once(() => import("@codemirror/lang-html").then((m) => m.html())),
  ],
  [
    "md",
    "Markdown",
    once(() => import("@codemirror/lang-markdown").then((m) => m.markdown())),
  ],
  [
    "sh bash zsh",
    "Shell",
    legacy(() =>
      import("@codemirror/legacy-modes/mode/shell").then((m) => m.shell),
    ),
  ],
  [
    "yaml yml",
    "YAML",
    legacy(() =>
      import("@codemirror/legacy-modes/mode/yaml").then((m) => m.yaml),
    ),
  ],
  [
    "go",
    "Go",
    legacy(() => import("@codemirror/legacy-modes/mode/go").then((m) => m.go)),
  ],
  [
    "rs",
    "Rust",
    legacy(() =>
      import("@codemirror/legacy-modes/mode/rust").then((m) => m.rust),
    ),
  ],
  [
    "r",
    "R",
    legacy(() => import("@codemirror/legacy-modes/mode/r").then((m) => m.r)),
  ],
  [
    "sql",
    "SQL",
    legacy(() =>
      import("@codemirror/legacy-modes/mode/sql").then((m) => m.standardSQL),
    ),
  ],
  [
    "toml",
    "TOML",
    legacy(() =>
      import("@codemirror/legacy-modes/mode/toml").then((m) => m.toml),
    ),
  ],
];
const plainText = Promise.resolve<Extension>([]);
export function fileLanguage(file: string) {
  const extension = file.split(".").pop()?.toLowerCase() ?? "";
  const [, name, load] = languages.find(([extensions]) =>
    extensions.split(" ").includes(extension),
  ) ?? ["", "Text", () => plainText];
  return { name, load };
}
