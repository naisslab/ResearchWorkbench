import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy, ExternalLink, FileText } from "lucide-react";

export function CopyAction({
  text,
  label = "Copy message",
}: {
  text: string;
  label?: string;
}) {
  const [status, setStatus] = useState("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button
      className="ai-copy-action"
      type="button"
      aria-label={status === "copied" ? "Copied" : label}
      title={
        status === "failed"
          ? "Could not copy. Select the text to copy it."
          : status === "copied"
            ? "Copied"
            : label
      }
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setStatus("copied");
        } catch {
          setStatus("failed");
        }
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setStatus("idle"), 1800);
      }}
    >
      {status === "copied" ? <Check size={13} /> : <Copy size={13} />}
      {label === "Copy code" && (
        <span>{status === "copied" ? "Copied" : "Copy"}</span>
      )}
    </button>
  );
}

function CodeBlock({
  children,
  text,
  language,
}: {
  children: ReactNode;
  text: string;
  language: string;
}) {
  return (
    <div className="ai-code-block">
      <div className="ai-code-heading">
        <span>{language || "Code"}</span>
        <CopyAction text={text} label="Copy code" />
      </div>
      <pre>{children}</pre>
    </div>
  );
}

function linkUrl(url: string) {
  if (!url || url.startsWith("#")) return "";
  if (/^(?:https?:|file:)/i.test(url)) return url;
  // Allow line references such as paper.tex:42 while rejecting executable URLs.
  if (/^[a-z][a-z\d+.-]*:/i.test(url) && !/\.[a-z\d]+:\d+(?::\d+)?$/i.test(url))
    return "";
  return url;
}

const AIMarkdown = memo(function AIMarkdown({
  text,
  openReference,
}: {
  text: string;
  openReference(reference: string): void;
}) {
  return (
    <div className="ai-markdown">
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        urlTransform={linkUrl}
        components={{
          a: ({ href, children }) =>
            !href ? (
              <span>{children}</span>
            ) : (
              <a
                href={href}
                title={/^https?:/i.test(href) ? href : `Open ${href}`}
                className={
                  /^https?:/i.test(href) ? "ai-web-link" : "ai-file-link"
                }
                onClick={(event) => {
                  event.preventDefault();
                  openReference(href);
                }}
              >
                {!/^https?:/i.test(href) && (
                  <FileText size={12} aria-hidden="true" />
                )}
                {children}
                {/^https?:/i.test(href) && (
                  <ExternalLink size={10} aria-hidden="true" />
                )}
              </a>
            ),
          pre: ({ node, children }) => {
            const code = node?.children.find(
              (child) => child.type === "element" && child.tagName === "code",
            );
            const text =
              code?.type === "element"
                ? code.children
                    .map((child) => (child.type === "text" ? child.value : ""))
                    .join("")
                : "";
            const classes =
              code?.type === "element"
                ? String(code.properties.className || "")
                : "";
            return (
              <CodeBlock
                text={text}
                language={classes.match(/language-([^\s,]+)/)?.[1] || ""}
              >
                {children}
              </CodeBlock>
            );
          },
          table: ({ children }) => (
            <div className="ai-table-scroll">
              <table>{children}</table>
            </div>
          ),
          // Do not fetch remote images while rendering model output.
          img: ({ alt }) => (
            <span className="ai-image-label">{alt || "Image"}</span>
          ),
        }}
      >
        {text}
      </Markdown>
    </div>
  );
});
export default AIMarkdown;
