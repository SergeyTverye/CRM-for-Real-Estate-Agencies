import type { Actor } from "@/modules/auth/domain/actor";
import { listDocumentsFor, type LinkKind } from "@/modules/documents/application/document-service";
import { labelOf, optionsOf } from "@/shared/codebook";
import { getConfig } from "@/shared/config/env";
import { fmtDateTime } from "@/server/format";
import { Badge, Card, EmptyState } from "../components";
import { ActionButton } from "../client-kit";
import { DocumentUploadButton } from "./document-upload";

export type DocumentLinkKind = LinkKind;

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}


export async function DocumentsPanel({ actor, link, canUpload = true }: { actor: Actor; link: { kind: DocumentLinkKind; id: string }; canUpload?: boolean }) {
  const docs = await listDocumentsFor(actor, link);
  const cfg = getConfig();
  return (
    <Card
      title="Документы"
      bodyClassName=""
      actions={
        canUpload ? (
          <DocumentUploadButton
            linkKind={link.kind}
            linkId={link.id}
            types={optionsOf("documentType")}
            accept={cfg.uploadAllowedExtensions.map((e) => `.${e}`).join(",")}
            maxMb={cfg.MAX_UPLOAD_MB}
          />
        ) : undefined
      }
    >
      {docs.length === 0 ? (
        <EmptyState title="Документов нет" hint={`Допустимые форматы: ${cfg.uploadAllowedExtensions.join(", ")}; до ${cfg.MAX_UPLOAD_MB} МБ.`} />
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Файл</th>
              <th>Тип</th>
              <th>Юрлицо</th>
              <th>Размер</th>
              <th>Загружен</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.id}>
                <td>
                  <a className="link" href={`/api/v1/documents/${d.id}/download`}>
                    {d.originalName}
                  </a>
                </td>
                <td>
                  <Badge>{labelOf("documentType", d.documentTypeCode)}</Badge>
                </td>
                <td>{d.legalEntity?.displayName ?? "—"}</td>
                <td>{fmtSize(d.fileSize)}</td>
                <td>
                  {fmtDateTime(d.createdAt)}
                  <div className="text-xs text-slate-500">{d.uploader.displayName}</div>
                </td>
                <td className="text-right">
                  {d.canArchive ? <ActionButton url={`/api/v1/documents/${d.id}/archive`} label="В архив" className="btn btn-sm btn-link" confirm="Перенести документ в архив? Файл не удаляется." /> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
