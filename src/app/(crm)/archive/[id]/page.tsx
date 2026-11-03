import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageActor } from "@/server/page-auth";
import { getArchiveRecord } from "@/modules/archive/application/archive-service";
import { NotFoundError } from "@/shared/errors";
import { fmtDateOnly, fmtDateTime, fmtMoney, fmtNum } from "@/server/format";
import { Card, Dl, PageHeader } from "@/ui/components";

export const metadata = { title: "Запись архива" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ArchiveRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePageActor({ manager: true });
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  let r;
  try {
    r = await getArchiveRecord(actor, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const dealDate = r.dealDate ? fmtDateOnly(r.dealDate) : null;

  return (
    <div>
      <PageHeader
        back={{ href: "/archive", label: "Исторический архив" }}
        title={r.objectText ?? "Запись архива без адреса"}
        subtitle={`Историческая сделка${dealDate ? ` от ${dealDate}` : ""} · только чтение`}
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Сделка" className="lg:col-span-2">
          <Dl
            items={[
              ["Дата сделки", dealDate ?? "не распознана"],
              ["Дата в источнике", r.dealDateText],
              ["Тип объекта", r.propertyType],
              ["Объект / адрес", r.objectText],
              ["Площадь", r.area ? fmtNum(r.area, "м²") : null],
              ["Цена", r.price ? fmtMoney(r.price) : null],
              ["Условия продажи", r.conditions],
              ["Роль участника", r.partyRole],
              ["Участник (ФИО)", r.participantName],
              ["Телефон", r.contactPhone],
              ["E-mail", r.contactEmail],
              ["Риелтор", r.realtorText],
              ["Информационный договор", r.contractRef],
              ["Сумма комиссии", r.commissionAmount ? fmtMoney(r.commissionAmount) : null],
              ["Доп. информация", r.additionalInfo ? <span key="ai" className="whitespace-pre-wrap">{r.additionalInfo}</span> : null],
            ]}
          />
        </Card>
        <div className="space-y-4">
          <Card title="Клиент CRM">
            {r.client ? (
              <div>
                <Link href={`/clients/${r.client.id}`} className="link font-medium">
                  {r.client.displayName}
                </Link>
                <p className="mt-1 text-xs text-slate-500">Связь установлена по однозначному совпадению телефона.</p>
              </div>
            ) : (
              <p className="text-sm text-slate-500">Не связана. Связь создаётся только при однозначном совпадении телефона — совпадение ФИО для этого недостаточно.</p>
            )}
          </Card>
          <Card title="Источник">
            <Dl
              items={[
                ["Файл", r.sourceFile],
                ["№ записи в файле", r.sourceRowId],
                [
                  "Задание импорта",
                  r.importJob ? (
                    <Link key="ij" href={`/import/${r.importJob.id}`} className="link">
                      {r.importJob.sourceFilename}
                    </Link>
                  ) : null,
                ],
                ["Импортировано", fmtDateTime(r.importedAt)],
              ]}
            />
          </Card>
          <div className="alert alert-info text-xs">
            Паспортные данные, «Кем выдан», сведения о регистрации и даты рождения при переносе исключены политикой минимизации ПДн и в CRM не хранятся. Запись доступна только руководителю и не редактируется.
          </div>
        </div>
      </div>
    </div>
  );
}
