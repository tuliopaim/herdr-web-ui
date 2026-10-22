import { useEffect, useRef, useState } from "react";
import { ImagePlus, Send, X } from "lucide-react";
import { useMachineApi } from "../lib/machineContext.tsx";
import { useT } from "../lib/i18n.ts";
import { imageMention } from "../lib/compose.ts";
import { normalizeComposerImageFile } from "../lib/composerImageMime.ts";
import { userErrorMessage } from "../lib/userError.ts";

interface Attachment { id: number; name: string; preview: string; path: string | null }

/** Pi's custom editor accepts pasted text, including uploaded image paths. No answer is sent
 * until Send is pressed. Closing the question keeps these edits; replacing it discards them. */
export function PiPromptAnswer({ paneId, defaultText, label, labelledBy, placeholder, disabled, onSend, onUploading }: {
  paneId: string;
  defaultText: string;
  label?: string;
  labelledBy?: string;
  placeholder: string;
  disabled: boolean;
  onSend(text: string, press?: { nativeEvent: Event; currentTarget: EventTarget }): void;
  onUploading(value: boolean): void;
}) {
  const t = useT();
  const { uploadPaneImage } = useMachineApi();
  const [text, setText] = useState(defaultText);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const sequence = useRef(0);
  const previews = useRef(new Set<string>());
  const mounted = useRef(false);
  const running = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const urls = previews.current;
    return () => { mounted.current = false; for (const url of urls) URL.revokeObjectURL(url); urls.clear(); };
  }, []);

  const upload = async (files: File[]): Promise<void> => {
    if (disabled || running.current) return;
    const images = files.map(normalizeComposerImageFile).filter((file) => file.type.startsWith("image/"));
    if (!images.length) return;
    running.current = true;
    setUploading(true);
    onUploading(true);
    setError(null);
    try {
      for (const file of images) {
        if (!mounted.current) break;
        const id = sequence.current++;
        const preview = URL.createObjectURL(file);
        previews.current.add(preview);
        setAttachments((current) => [...current, { id, preview, name: file.name, path: null }]);
        try {
          const path = await uploadPaneImage(paneId, file);
          if (mounted.current) setAttachments((current) => current.map((item) => item.id === id ? { ...item, path } : item));
        } catch (cause) {
          if (mounted.current) {
            setAttachments((current) => current.filter((item) => item.id !== id));
            setError(userErrorMessage(cause).message);
          }
          URL.revokeObjectURL(preview);
          previews.current.delete(preview);
          break;
        }
      }
    } finally {
      running.current = false;
      if (mounted.current) { setUploading(false); onUploading(false); }
    }
  };
  const value = `${attachments.flatMap((item) => item.path === null ? [] : [imageMention(item.path)]).join("")}${text}`.trim();
  const send = (press?: { nativeEvent: Event; currentTarget: EventTarget }): void => { if (!disabled && !running.current && value && value.length <= 12_000) onSend(value, press); };

  return <div className="prompt-card-image-answer" onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
    event.preventDefault();
    void upload(Array.from(event.dataTransfer.files));
  }}>
    {attachments.length > 0 && <div className="prompt-card-attachments" aria-label={t("Attached files")}>
      {attachments.map((item) => <div className="prompt-card-attachment" key={item.id}>
        <img src={item.preview} alt={item.name} />
        <span>{t(item.path === null ? "Uploading" : "Attached")}</span>
        <button type="button" className="btn btn-ghost" disabled={disabled || uploading} aria-label={t("Remove {file}", { file: item.name })} onClick={() => {
          setAttachments((current) => current.filter((entry) => entry.id !== item.id));
          URL.revokeObjectURL(item.preview);
          previews.current.delete(item.preview);
        }}><X aria-hidden="true" /></button>
      </div>)}
    </div>}
    <textarea className="input" rows={3} value={text} maxLength={12_000} disabled={disabled || uploading} placeholder={placeholder} aria-label={label} aria-labelledby={labelledBy}
      onChange={(event) => setText(event.currentTarget.value)} onPaste={(event) => {
        const images = Array.from(event.clipboardData.files).filter((file) => normalizeComposerImageFile(file).type.startsWith("image/"));
        if (images.length) { event.preventDefault(); void upload(images); }
      }} onKeyDown={(event) => {
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { event.preventDefault(); send(); }
      }} />
    <div className="prompt-card-custom-row">
      <input ref={input} type="file" accept="image/*" multiple hidden onChange={(event) => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ""; void upload(files); }} />
      <button type="button" className="btn" disabled={disabled || uploading} aria-label={t("Attach files")} title={t("Attach files")} onClick={() => input.current?.click()}><ImagePlus aria-hidden="true" /></button>
      <button type="button" className="btn btn-primary" disabled={disabled || uploading || !value || value.length > 12_000} onClick={send}><Send aria-hidden="true" />{t("Send")}</button>
    </div>
    {value.length > 12_000 && <p className="prompt-card-error" role="status">{t("{max}-character limit · {count} over", { max: 12_000, count: value.length - 12_000 })}</p>}
    {error && <p className="prompt-card-error" role="alert">{error}</p>}
  </div>;
}
