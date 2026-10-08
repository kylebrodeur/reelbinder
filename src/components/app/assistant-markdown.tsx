import ReactMarkdown from "react-markdown";
import { isSafeSourceUrl } from "@/lib/production-assistant";
import { cn } from "@/lib/utils";

interface AssistantMarkdownProps {
  children: string;
  className?: string;
}

/**
 * Render assistant-authored Markdown as React nodes. Raw HTML is discarded;
 * links follow the same HTTP(S)-only policy as saved assistant sources.
 */
export function AssistantMarkdown({ children, className }: AssistantMarkdownProps) {
  return (
    <div className={cn("break-words leading-relaxed", className)}>
      <ReactMarkdown
        skipHtml
        components={{
          h1: ({ children }) => <h1 className="mb-2 text-base font-semibold">{children}</h1>,
          h2: ({ children }) => <h2 className="mb-2 text-sm font-semibold">{children}</h2>,
          h3: ({ children }) => <h3 className="mb-1 text-sm font-medium">{children}</h3>,
          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>,
          ol: ({ children }) => <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>,
          pre: ({ children }) => (
            <pre className="mb-2 overflow-x-auto rounded bg-muted p-2 font-mono text-xs last:mb-0">
              {children}
            </pre>
          ),
          code: ({ children }) => (
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">{children}</code>
          ),
          a: ({ href, children }) =>
            isSafeSourceUrl(href) ? (
              <a href={href} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
