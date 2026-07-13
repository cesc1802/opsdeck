import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { t } from "@/lib/i18n";

// Scoped element styles instead of the typography plugin: the app renders
// untrusted session markdown, so keep the surface minimal and predictable.
const MARKDOWN_CLASSES = [
  "text-sm leading-relaxed break-words",
  "[&_p]:my-1.5 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0",
  "[&_h1]:mt-3 [&_h1]:text-base [&_h1]:font-semibold",
  "[&_h2]:mt-3 [&_h2]:text-base [&_h2]:font-semibold",
  "[&_h3]:mt-2 [&_h3]:text-sm [&_h3]:font-semibold",
  "[&_h4]:mt-2 [&_h4]:text-sm [&_h4]:font-medium",
  "[&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5",
  "[&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5",
  "[&_li]:my-0.5",
  "[&_blockquote]:my-1.5 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
  "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs",
  "[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3",
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
  "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2",
  "[&_table]:my-2 [&_table]:block [&_table]:overflow-x-auto",
  "[&_th]:border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-medium",
  "[&_td]:border [&_td]:px-2 [&_td]:py-1",
  "[&_hr]:my-3 [&_hr]:border-border",
].join(" ");

export function MarkdownBlock({ text }: { text: string }) {
  return (
    <div className={MARKDOWN_CLASSES}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Session transcripts reference local paths; never open links.
          a: ({ children }) => (
            <span className="text-primary underline underline-offset-2">
              {children}
            </span>
          ),
          // Remote images would fire outbound requests from untrusted
          // transcript content; show a placeholder instead of fetching.
          img: ({ alt }) => (
            <span className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
              {alt || t("markdown.image")}
            </span>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
