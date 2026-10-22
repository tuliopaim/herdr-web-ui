import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { MessageSquarePlus, Pencil, Trash2, X } from "lucide-react";

import { responseComments, selectedResponseQuote, type ResponseComment } from "../lib/responseComments.ts";
import { useT } from "../lib/i18n.ts";
import "./ResponseComments.css";

export function ResponseComments({ owner, root, reading, onReview }: {
  owner: string;
  root: RefObject<HTMLDivElement | null>;
  reading: boolean;
  onReview?: () => void;
}) {
  const t = useT();
  const notes = useSyncExternalStore(responseComments.subscribe, () => responseComments.read(owner));
  const [quote, setQuote] = useState<string | null>(null);
  const [editing, setEditing] = useState<ResponseComment | null>(null);
  const [comment, setComment] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const changed = () => {
      if (dialog.current?.open) return;
      setQuote(root.current ? selectedResponseQuote(window.getSelection(), root.current) : null);
    };
    document.addEventListener("selectionchange", changed);
    return () => document.removeEventListener("selectionchange", changed);
  }, [root]);
  const open = (note: ResponseComment) => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setEditing(note);
    setComment(note.comment);
    dialog.current?.showModal();
    requestAnimationFrame(() => editor.current?.focus());
  };
  const close = () => {
    dialog.current?.close();
    setEditing(null);
    returnFocus.current?.focus({ preventScroll: true });
  };
  return <div className={`response-comments${reading ? " is-reading" : ""}`}>
    {quote !== null && <button type="button" className="btn response-comment-add"
      onPointerDown={(event) => event.preventDefault()}
      onClick={() => { open({ id: crypto.randomUUID(), quote, comment: "" }); setQuote(null); }}>
      <MessageSquarePlus aria-hidden="true" />{t("Add comment")}
    </button>}
    {notes.length > 0 && <div className="response-comments-queue">
      <button type="button" className="btn" aria-expanded={reviewing && !reading} onClick={() => {
        setReviewing((value) => reading || !value);
        if (reading) onReview?.();
      }}><MessageSquarePlus aria-hidden="true" />{t("Comments · {n}", { n: notes.length })}{reading && <span>{t("Review and send")}</span>}</button>
      {reviewing && !reading && <div className="response-comments-list" aria-label={t("Saved comments")}>
        <p>{t("Comments will be included with your next message. You can also send them without a message.")}</p>
        {notes.map((note, index) => <article key={note.id}>
          <blockquote>{note.quote}</blockquote><p>{note.comment}</p>
          <div className="response-comment-actions">
            <button type="button" className="btn" aria-label={t("Edit comment {n}", { n: index + 1 })} onClick={() => open(note)}><Pencil aria-hidden="true" />{t("Edit")}</button>
            <button type="button" className="btn" aria-label={t("Remove comment {n}", { n: index + 1 })} onClick={() => responseComments.remove(owner, note.id)}><Trash2 aria-hidden="true" />{t("Remove")}</button>
          </div>
        </article>)}
      </div>}
    </div>}
    <dialog ref={dialog} className="response-comment-dialog" aria-labelledby={`comment-title-${owner}`} onCancel={(event) => { event.preventDefault(); close(); }}>
      <div className="response-comment-heading"><h2 id={`comment-title-${owner}`}>{t("Add comment")}</h2>
        <button type="button" className="icon-button" aria-label={t("Close")} onClick={close}><X aria-hidden="true" /></button></div>
      <blockquote>{editing?.quote}</blockquote>
      <label htmlFor={`comment-input-${owner}`}>{t("Your comment")}</label><textarea id={`comment-input-${owner}`} ref={editor} value={comment} onChange={(event) => setComment(event.currentTarget.value)} />
      <div className="response-comment-actions"><button type="button" className="btn" onClick={close}>{t("Cancel")}</button>
        <button type="button" className="btn" disabled={!comment.trim()} onClick={() => {
          if (!editing || !comment.trim()) return;
          responseComments.save(owner, { ...editing, comment: comment.trim() });
          close();
          window.getSelection()?.removeAllRanges();
        }}>{t("Save comment")}</button></div>
    </dialog>
  </div>;
}
