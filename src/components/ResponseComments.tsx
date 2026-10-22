import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { ImagePlus, MessageSquarePlus, Pencil, Trash2, X } from "lucide-react";

import { responseComments, selectedResponseQuote, type ResponseComment, type CommentImage } from "../lib/responseComments.ts";
import { assertAttachable } from "../lib/api.ts";
import { useT } from "../lib/i18n.ts";
import { useMachineApi } from "../lib/machineContext.tsx";
import { normalizeComposerImageFile } from "../lib/composerImageMime.ts";
import { userErrorMessage } from "../lib/userError.ts";
import "./ResponseComments.css";

export function ResponseComments({ owner, paneId, root, reading, onReview }: {
  owner: string;
  paneId: string;
  root: RefObject<HTMLDivElement | null>;
  reading: boolean;
  onReview?: () => void;
}) {
  const t = useT();
  const { uploadPaneImage } = useMachineApi();
  const [images, setImages] = useState<readonly CommentImage[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const running = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const upload = async (files: File[]) => {
    if (running.current) return;
    const incoming = files.map(normalizeComposerImageFile).filter((file) => file.type.startsWith("image/"));
    if (!incoming.length) return;
    running.current = true;
    setUploading(true);
    setError(null);
    try {
      for (const file of incoming) {
        if (!mounted.current) break;
        assertAttachable(file);
        // Data URLs stay with the page-lifetime comment draft, without object-URL ownership.
        const preview = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });
        const path = await uploadPaneImage(paneId, file);
        if (mounted.current) setImages((current) => [...current, { id: crypto.randomUUID(), name: file.name, preview, path }]);
      }
    } catch (cause) {
      if (mounted.current) setError(userErrorMessage(cause).message);
    } finally {
      running.current = false;
      if (mounted.current) setUploading(false);
    }
  };
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
    setImages(note.images ?? []);
    setError(null);
    dialog.current?.showModal();
    requestAnimationFrame(() => editor.current?.focus());
  };
  const close = () => {
    if (running.current) return;
    dialog.current?.close();
    setEditing(null);
    setImages([]);
    setComment("");
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
          {!!note.images?.length && <div className="response-comment-images">{note.images.map((image) => <img key={image.id} src={image.preview} alt={image.name} />)}</div>}
          <div className="response-comment-actions">
            <button type="button" className="btn" aria-label={t("Edit comment {n}", { n: index + 1 })} onClick={() => open(note)}><Pencil aria-hidden="true" />{t("Edit")}</button>
            <button type="button" className="btn" aria-label={t("Remove comment {n}", { n: index + 1 })} onClick={() => responseComments.remove(owner, note.id)}><Trash2 aria-hidden="true" />{t("Remove")}</button>
          </div>
        </article>)}
      </div>}
    </div>}
    <dialog ref={dialog} className="response-comment-dialog" aria-labelledby={`comment-title-${owner}`} onCancel={(event) => { event.preventDefault(); close(); }}>
      <div className="response-comment-heading"><h2 id={`comment-title-${owner}`}>{t("Add comment")}</h2>
        <button type="button" className="icon-button" aria-label={t("Close")} disabled={uploading} onClick={close}><X aria-hidden="true" /></button></div>
      <blockquote>{editing?.quote}</blockquote>
      <div className="response-comment-editor" onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
        event.preventDefault(); void upload(Array.from(event.dataTransfer.files));
      }}>
      <label className="visually-hidden" htmlFor={`comment-input-${owner}`}>{t("Your comment")}</label><textarea id={`comment-input-${owner}`} ref={editor} rows={3} placeholder={t("Your comment")} value={comment} onPaste={(event) => {
        const files = Array.from(event.clipboardData.files).filter((file) => normalizeComposerImageFile(file).type.startsWith("image/"));
        if (files.length) { event.preventDefault(); void upload(files); }
      }} onChange={(event) => setComment(event.currentTarget.value)} />
      <div className="response-comment-images" aria-label={t("Attached files")}>{images.map((image) => <div key={image.id}>
        <img src={image.preview} alt={image.name} />
        <button type="button" className="icon-button" disabled={uploading} aria-label={t("Remove {file}", { file: image.name })}
          onClick={() => setImages((current) => current.filter((item) => item.id !== image.id))}><X aria-hidden="true" /></button>
      </div>)}</div>
      <div className="response-comment-toolbar">
        <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ""; void upload(files);
        }} />
        <button type="button" className="btn icon-button" disabled={uploading} aria-label={t("Attach files")} onClick={() => fileInput.current?.click()}><ImagePlus aria-hidden="true" /></button>
        {uploading && <span role="status">{t("Uploading")}</span>}
      </div>
      </div>
      {error && <p className="response-comment-error" role="alert">{error}</p>}
      <div className="response-comment-actions"><button type="button" className="btn" disabled={uploading} onClick={close}>{t("Cancel")}</button>
        <button type="button" className="btn btn-primary" disabled={uploading || (!comment.trim() && !images.length)} onClick={() => {
          if (!editing || running.current || (!comment.trim() && !images.length)) return;
          responseComments.save(owner, { ...editing, comment: comment.trim(), images: [...images] });
          close();
          window.getSelection()?.removeAllRanges();
        }}>{t("Save comment")}</button></div>
    </dialog>
  </div>;
}
