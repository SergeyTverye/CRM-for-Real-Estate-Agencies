"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiCall } from "../api-client";
import { useApiAction } from "../hooks";
import { Field, FormErrorBanner } from "../form";
import { Modal, SelectInput, type Option } from "../client-kit";

export function DocumentUploadButton({ linkKind, linkId, types, accept, maxMb }: { linkKind: string; linkId: string; types: Option[]; accept: string; maxMb: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("other");
  const fileRef = useRef<HTMLInputElement>(null);
  const { pending, error, run, fieldError, setError } = useApiAction();
  return (
    <>
      <button type="button" className="btn btn-sm" onClick={() => { setError(null); setOpen(true); }}>
        + Загрузить
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Загрузка документа">
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const file = fileRef.current?.files?.[0];
            if (!file) {
              setError({ code: "VALIDATION_ERROR", message: "Выберите файл", fieldErrors: { file: ["Файл не выбран"] } });
              return;
            }
            if (file.size > maxMb * 1024 * 1024) {
              setError({ code: "VALIDATION_ERROR", message: `Файл больше ${maxMb} МБ`, fieldErrors: { file: [`Не более ${maxMb} МБ`] } });
              return;
            }
            const fd = new FormData();
            fd.set("file", file);
            fd.set("documentTypeCode", type);
            fd.set("linkKind", linkKind);
            fd.set("linkId", linkId);
            const res = await run(() => apiCall("POST", "/api/v1/documents", fd));
            if (res) {
              setOpen(false);
              router.refresh();
            }
          }}
        >
          <FormErrorBanner error={error} />
          <Field label="Тип документа">
            <SelectInput value={type} onChange={setType} options={types} />
          </Field>
          <Field label="Файл" error={fieldError("file")} hint={`Не более ${maxMb} МБ`}>
            <input ref={fileRef} type="file" accept={accept} className="block w-full text-sm" />
          </Field>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn" onClick={() => setOpen(false)}>Отмена</button>
            <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? "Загрузка…" : "Загрузить"}</button>
          </div>
        </form>
      </Modal>
    </>
  );
}
