"use client";
import { useState } from "react";
import { Modal } from "@/ui/client-kit";
import { FormErrorBanner } from "@/ui/form";
import { apiCall } from "@/ui/api-client";
import { useApiAction } from "@/ui/hooks";
import { requestConfirmation } from "@/ui/confirm-dialog";
import { RequestForm, type RequestFormProps } from "./new/request-form";
export function RecordCallButton() {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<RequestFormProps | null>(null);
  const { pending, error, run } = useApiAction();
  async function load() { const data = await run(() => apiCall<RequestFormProps>("GET", "/api/v1/requests/form-options")); if (data) setOptions(data); }
  return <><button type="button" className="btn" onClick={() => { setOpen(true); void load(); }}>Записать звонок</button>
    <Modal open={open} title="Записать звонок" wide onClose={() => { if (!open) return; void requestConfirmation("Закрыть форму звонка? Несохранённые данные будут потеряны.").then(ok => { if (ok) { setOpen(false); setOptions(null); } }); }}>
      {pending ? <p role="status">Загрузка формы…</p> : null}<FormErrorBanner error={error} />
      {error ? <button className="btn" onClick={() => void load()}>Повторить</button> : null}
      {options ? <RequestForm {...options} /> : null}
    </Modal></>;
}
