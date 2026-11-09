import { ApiCallError, apiCall } from "../api-client";

export interface PendingAgreementDocument {
  file: File;
  documentTypeCode: string;
  error?: string;
}

export async function uploadAgreementDocuments(agreementId: string, files: PendingAgreementDocument[]): Promise<PendingAgreementDocument[]> {
  const failed: PendingAgreementDocument[] = [];
  for (const item of files) {
    const body = new FormData();
    body.set("file", item.file);
    body.set("documentTypeCode", item.documentTypeCode);
    body.set("linkKind", "agreement");
    body.set("linkId", agreementId);
    try {
      await apiCall("POST", "/api/v1/documents", body);
    } catch (error) {
      failed.push({ ...item, error: error instanceof ApiCallError ? error.body.fieldErrors?.file?.join("; ") ?? error.body.message : "Не удалось загрузить файл. Повторите попытку." });
    }
  }
  return failed;
}
