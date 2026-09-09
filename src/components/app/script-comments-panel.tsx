import { Check, ExternalLink, MessageSquare, Pencil, Reply, Undo2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  prepareAssistantComment,
  PRODUCTION_ASSISTANT_OPEN_EVENT,
} from "@/lib/production-assistant-store";
import {
  MAX_SCRIPT_COMMENT_TEXT,
  newScriptCommentThread,
  resolveScriptCommentAnchor,
  type ScriptCommentAnchor,
  type ScriptCommentChange,
  type ScriptCommentThread,
} from "@/lib/script-comments";
import { useSlate } from "@/lib/store";

export const SCRIPT_COMMENT_REANCHOR_EVENT = "slate:reattach-script-comment";

function useCommentDraft(projectId: string, key: string, initial = "") {
  const storageKey = `slate:comment-draft:${projectId}:${key}`;
  const read = () => {
    try {
      return (sessionStorage.getItem(storageKey) ?? initial).slice(0, MAX_SCRIPT_COMMENT_TEXT);
    } catch {
      return initial;
    }
  };
  const [text, setText] = useState(read);
  useEffect(() => {
    setText(read());
  }, [storageKey, initial]);
  const write = (value: string) => {
    setText(value);
    try {
      if (value) sessionStorage.setItem(storageKey, value);
      else sessionStorage.removeItem(storageKey);
    } catch {
      /* The authored comment is saved in Project on submit. */
    }
  };
  return [text, write] as const;
}

function changeComment(projectId: string, change: ScriptCommentChange) {
  const result = useSlate.getState().applyScriptCommentChange(projectId, change);
  if (!result.ok) toast.error(result.error);
  return result.ok;
}

export function ScriptCommentComposer({
  anchor,
  reanchorThreadId,
  onClose,
}: {
  anchor: ScriptCommentAnchor;
  reanchorThreadId?: string;
  onClose: () => void;
}) {
  const project = useSlate((state) => state.project);
  const [text, setText] = useCommentDraft(project.id, `new:${JSON.stringify(anchor)}`);
  const save = () => {
    try {
      const change: ScriptCommentChange = reanchorThreadId
        ? { kind: "reanchor", threadId: reanchorThreadId, anchor, updatedAt: Date.now() }
        : { kind: "add-thread", thread: newScriptCommentThread(anchor, text) };
      if (changeComment(project.id, change)) {
        setText("");
        onClose();
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save this comment.");
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {reanchorThreadId ? "Reattach comment thread" : "Comment on this passage"}
          </DialogTitle>
          <DialogDescription>
            Comments stay with the project and contribute to the Production Assistant’s context.
          </DialogDescription>
        </DialogHeader>
        <blockquote className="max-h-36 overflow-auto border-l-2 border-primary pl-3 text-sm whitespace-pre-wrap">
          {anchor.quote}
        </blockquote>
        {!reanchorThreadId && (
          <Textarea
            aria-label="New script comment"
            rows={4}
            maxLength={MAX_SCRIPT_COMMENT_TEXT}
            value={text}
            onChange={(event) => setText(event.target.value)}
            autoFocus
          />
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!reanchorThreadId && !text.trim()} onClick={save}>
            {reanchorThreadId ? "Use this exact passage" : "Save comment"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ScriptCommentThreadCard({ thread }: { thread: ScriptCommentThread }) {
  const project = useSlate((state) => state.project);
  const [reply, setReply] = useCommentDraft(project.id, `reply:${thread.id}`);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [editText, setEditText] = useCommentDraft(
    project.id,
    `edit:${editing?.id ?? "none"}`,
    editing?.text ?? "",
  );
  const placement = resolveScriptCommentAnchor(project.script, thread.anchor);
  const unresolved = !["exact", "moved"].includes(placement.status);
  const update = (change: ScriptCommentChange) => changeComment(project.id, change);
  const reattach = () => {
    useSlate.getState().setView("script");
    window.dispatchEvent(
      new CustomEvent(SCRIPT_COMMENT_REANCHOR_EVENT, {
        detail: { projectId: project.id, threadId: thread.id },
      }),
    );
  };
  return (
    <article
      data-comment-thread-id={thread.id}
      className="space-y-3 rounded-md border border-border bg-card p-3 text-foreground font-sans text-sm"
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold">
          {thread.status === "resolved" ? "Resolved comment" : "Script comment"}
        </span>
        {unresolved && (
          <span className="text-warn">
            Anchor needs review ·{" "}
            {placement.status === "missing-element"
              ? "passage removed"
              : placement.status === "ambiguous"
                ? "quote repeats"
                : "quote changed"}
          </span>
        )}
        {placement.status === "moved" && (
          <span className="text-muted-foreground">Exact quote moved within its passage</span>
        )}
      </div>
      <blockquote className="max-h-24 overflow-auto border-l-2 border-primary/50 pl-2 text-xs whitespace-pre-wrap">
        {thread.anchor.quote}
      </blockquote>
      <div className="space-y-3">
        {thread.messages.map((message) => (
          <div key={message.id} className="space-y-1 border-t border-border pt-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>
                {message.role === "assistant" ? "Production Assistant" : "You"}
                {message.updatedAt ? " · edited" : ""}
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto h-6 px-2"
                aria-label="Edit comment message"
                onClick={() => setEditing({ id: message.id, text: message.text })}
              >
                <Pencil className="size-3" />
                Edit
              </Button>
            </div>
            {editing?.id === message.id ? (
              <div className="space-y-2">
                <Textarea
                  aria-label="Edit script comment"
                  value={editText}
                  maxLength={MAX_SCRIPT_COMMENT_TEXT}
                  rows={3}
                  onChange={(event) => setEditText(event.target.value)}
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={!editText.trim()}
                    onClick={() => {
                      if (
                        update({
                          kind: "edit-message",
                          threadId: thread.id,
                          messageId: message.id,
                          expectedText: editing.text,
                          text: editText,
                          updatedAt: Date.now(),
                        })
                      ) {
                        setEditText("");
                        setEditing(null);
                      }
                    }}
                  >
                    Save edit
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <p className="whitespace-pre-wrap break-words">{message.text}</p>
            )}
            {message.sources?.map((source) => (
              <a
                key={source.url}
                href={source.url}
                target="_blank"
                rel="noreferrer"
                className="mr-3 inline-block text-xs text-primary underline"
              >
                {source.title}
              </a>
            ))}
            {message.source && (
              <p className="break-all text-[10px] text-muted-foreground">
                Saved review {message.source.jobId}
                {message.source.findingId ? ` · finding ${message.source.findingId}` : ""}
              </p>
            )}
          </div>
        ))}
      </div>
      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (
            update({
              kind: "reply",
              threadId: thread.id,
              message: {
                id: crypto.randomUUID(),
                role: "user",
                text: reply.trim(),
                createdAt: Date.now(),
              },
            })
          )
            setReply("");
        }}
      >
        <Textarea
          aria-label="Reply to script comment"
          rows={2}
          maxLength={MAX_SCRIPT_COMMENT_TEXT}
          placeholder="Add a reply or production decision…"
          value={reply}
          onChange={(event) => setReply(event.target.value)}
        />
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" type="submit" disabled={!reply.trim()}>
            <Reply />
            Save reply
          </Button>
          <Button
            size="sm"
            type="button"
            variant="outline"
            onClick={() => prepareAssistantComment(project.id, thread.id)}
          >
            <MessageSquare />
            Ask assistant
          </Button>
          <Button
            size="sm"
            type="button"
            variant="ghost"
            onClick={() =>
              update({
                kind: "status",
                threadId: thread.id,
                status: thread.status === "resolved" ? "open" : "resolved",
                updatedAt: Date.now(),
              })
            }
          >
            {thread.status === "resolved" ? <Undo2 /> : <Check />}
            {thread.status === "resolved" ? "Reopen" : "Resolve"}
          </Button>
          {unresolved && (
            <Button size="sm" type="button" variant="ghost" onClick={reattach}>
              Reattach to passage
            </Button>
          )}
          {placement.status === "moved" && (
            <Button
              size="sm"
              type="button"
              variant="ghost"
              onClick={() =>
                update({
                  kind: "reanchor",
                  threadId: thread.id,
                  anchor: { ...thread.anchor, start: placement.start, end: placement.end },
                  updatedAt: Date.now(),
                })
              }
            >
              Update anchor
            </Button>
          )}
        </div>
      </form>
    </article>
  );
}

export function InlineScriptComments({ elementId }: { elementId: string }) {
  const threads = useSlate((state) => state.project.scriptCommentThreads);
  const [open, setOpen] = useState(false);
  const attached = (threads ?? []).filter((thread) => thread.anchor.elementId === elementId);
  if (!attached.length) return null;
  return (
    <div className="my-2 font-sans" onClick={(event) => event.stopPropagation()}>
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-xs bg-card text-foreground border-border hover:bg-secondary hover:text-foreground shadow-2xs"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <MessageSquare className="size-3 text-amber-500" />
        <span>
          {attached.length} {attached.length === 1 ? "comment" : "comments"}
          {attached.some((thread) => thread.status === "open") ? " · open" : " · resolved"}
        </span>
      </Button>
      {open && (
        <div className="mt-2 space-y-2">
          {attached.map((thread) => (
            <ScriptCommentThreadCard key={thread.id} thread={thread} />
          ))}
        </div>
      )}
    </div>
  );
}

export function ScriptCommentFloatingPopover({
  thread,
  x,
  y,
  onClose,
  onOpenInNotes,
}: {
  thread: ScriptCommentThread;
  x: number;
  y: number;
  onClose: () => void;
  onOpenInNotes?: () => void;
}) {
  return (
    <div
      className="absolute z-40 w-80 sm:w-96 rounded-lg border border-border bg-card p-3 shadow-2xl text-foreground font-sans text-sm animate-in fade-in zoom-in-95 duration-150"
      style={{ left: Math.max(8, x), top: Math.max(8, y) }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between border-b border-border/80 pb-2 mb-2.5">
        <div className="flex items-center gap-1.5">
          <MessageSquare className="size-3.5 text-amber-500" />
          <span className="font-semibold text-xs text-foreground">Script Note</span>
          <span
            className={cn(
              "rounded-full px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase",
              thread.status === "resolved"
                ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                : "bg-amber-500/15 text-amber-700 dark:text-amber-400",
            )}
          >
            {thread.status}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {onOpenInNotes && (
            <button
              type="button"
              onClick={onOpenInNotes}
              title="Open note in Notes sidebar dock"
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors cursor-pointer"
            >
              <span>Dock</span>
              <ExternalLink className="size-3" />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors cursor-pointer"
            aria-label="Close note"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>
      <ScriptCommentThreadCard thread={thread} />
    </div>
  );
}

export function ScriptCommentsIndex() {
  const project = useSlate((state) => state.project);
  const [open, setOpen] = useState(false);
  const threads = project.scriptCommentThreads ?? [];
  useEffect(() => {
    const close = () => setOpen(false);
    window.addEventListener(SCRIPT_COMMENT_REANCHOR_EVENT, close);
    window.addEventListener(PRODUCTION_ASSISTANT_OPEN_EVENT, close);
    return () => {
      window.removeEventListener(SCRIPT_COMMENT_REANCHOR_EVENT, close);
      window.removeEventListener(PRODUCTION_ASSISTANT_OPEN_EVENT, close);
    };
  }, []);
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <MessageSquare />
        Threads{threads.length ? ` · ${threads.length}` : ""}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[90vh] max-w-2xl flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>Script comment threads</DialogTitle>
            <DialogDescription>
              Open, resolved and unanchored notes stay in your project archive.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 overflow-auto">
            {!threads.length && (
              <p className="text-sm text-muted-foreground">
                Choose Comment on the script toolbar, then select an exact passage.
              </p>
            )}
            {[...threads]
              .sort((a, b) => b.updatedAt - a.updatedAt)
              .map((thread) => (
                <div key={thread.id} className="space-y-1">
                  {project.script.some((element) => element.id === thread.anchor.elementId) && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        useSlate.getState().selectElement(thread.anchor.elementId);
                        setOpen(false);
                        requestAnimationFrame(() =>
                          document
                            .querySelector(`[data-el-id="${CSS.escape(thread.anchor.elementId)}"]`)
                            ?.scrollIntoView({ block: "center", behavior: "smooth" }),
                        );
                      }}
                    >
                      Show passage
                    </Button>
                  )}
                  <ScriptCommentThreadCard thread={thread} />
                </div>
              ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ScriptCommentsList() {
  const project = useSlate((state) => state.project);
  const threads = project.scriptCommentThreads ?? [];
  const selectElement = useSlate((state) => state.selectElement);

  if (!threads.length) {
    return (
      <div className="space-y-2 py-8 text-center px-4">
        <MessageSquare className="size-6 text-muted-foreground/60 mx-auto" />
        <p className="font-script text-xs uppercase tracking-wide text-muted-foreground">No notes yet</p>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Switch to Comment mode above, then highlight any text passage to anchor a note, revision idea, or question.
        </p>
      </div>
    );
  }

  const sorted = [...threads].sort((a, b) => b.updatedAt - a.updatedAt);
  const openCount = sorted.filter((t) => t.status === "open").length;

  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center justify-between border-b border-border pb-2">
        <span className="text-xs font-semibold">
          {threads.length} {threads.length === 1 ? "thread" : "threads"} · {openCount} open
        </span>
      </div>
      <div className="space-y-3">
        {sorted.map((thread) => (
          <div key={thread.id} className="space-y-1.5">
            {project.script.some((element) => element.id === thread.anchor.elementId) && (
              <button
                type="button"
                className="text-xs text-steel hover:underline flex items-center gap-1 font-medium"
                onClick={() => {
                  selectElement(thread.anchor.elementId);
                  requestAnimationFrame(() =>
                    document
                      .querySelector(`[data-el-id="${CSS.escape(thread.anchor.elementId)}"]`)
                      ?.scrollIntoView({ block: "center", behavior: "smooth" }),
                  );
                }}
              >
                <span>Jump to passage in script →</span>
              </button>
            )}
            <ScriptCommentThreadCard thread={thread} />
          </div>
        ))}
      </div>
    </div>
  );
}

