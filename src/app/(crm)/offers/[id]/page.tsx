import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageActor } from "@/server/page-auth";
import { getOffer } from "@/modules/commercial-offers/application/offer-service";
import { listTasksLinkedTo } from "@/modules/tasks/application/task-queries";
import { dictLabel } from "@/modules/dictionaries/application/dictionaries-service";
import { NotFoundError } from "@/shared/errors";
import { labelOf } from "@/shared/codebook";
import { dateOnlyString } from "@/shared/time";
import { fmtDateOnly, fmtDateTime, fmtMoney, fmtNum, tz } from "@/server/format";
import { loadDictionaries } from "@/server/options";
import { Badge, Card, Dl, EmptyState, PageHeader, StatusBadge } from "@/ui/components";
import { ActionButton, QuickFormButton } from "@/ui/client-kit";
import { TaskList } from "@/ui/domain/task-list";
import { DocumentsPanel } from "@/ui/domain/documents-panel";
import { OfferStatusActions } from "@/ui/domain/offer-status-actions";

export const metadata = { title: "Коммерческое предложение" };

export default async function OfferCardPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePageActor();
  const { id } = await params;
  let data;
  try {
    data = await getOffer(actor, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const { offer: o, clientVisible, priceChanged } = data;
  const dicts = await loadDictionaries();
  const tasks = await listTasksLinkedTo(actor, { offerId: id }, { includeClosed: true, take: 50 });
  const zone = tz();
  const canChange = actor.role === "manager" || o.responsibleUserId === actor.userId || o.createdBy === actor.userId;
  const draft = o.status === "draft";
  const archived = o.status === "archived";
  const clientName = clientVisible ? o.need.client.displayName : "Клиент (нет доступа)";
  const changed = new Set(priceChanged);
  const updatedAt = o.updatedAt.toISOString();

  return (
    <div>
      <PageHeader
        back={{ href: "/offers", label: "Предложения" }}
        title={o.title ?? "Коммерческое предложение"}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={o.status} label={labelOf("offerStatus", o.status)} />
            <Link className="link" href={`/needs/${o.need.id}`}>
              {clientName} · {dictLabel(dicts, "need_operation_type", o.need.operationType)} · {dictLabel(dicts, "property_type", o.need.propertyType)}
            </Link>
            <span>· {o.legalEntity?.displayName ?? "ИП/ООО не выбрано"}</span>
          </span>
        }
        actions={
          <>
            {!archived ? (
              <ActionButton url={`/api/v1/offers/${id}/document`} label="Сформировать документ (DOCX)" pendingLabel="Формирование…" className="btn btn-primary" />
            ) : null}
            {draft ? (
              <Link className="btn" href={`/offers/${id}/edit`}>
                Редактировать
              </Link>
            ) : !archived ? (
              <QuickFormButton
                label="Срок и заметки"
                title="Изменение предложения"
                method="PATCH"
                url={`/api/v1/offers/${id}`}
                timeZone={zone}
                buttonClassName="btn"
                extraBody={{ expectedUpdatedAt: updatedAt }}
                fields={[
                  { name: "title", label: "Заголовок", initial: o.title ?? "" },
                  { name: "expiresAt", label: "Действует до", type: "date", initial: dateOnlyString(o.expiresAt) ?? "" },
                  { name: "notes", label: "Внутренние заметки", type: "textarea", initial: o.notes ?? "" },
                ]}
              />
            ) : null}
            <Link className="btn" href={`/tasks/new?offerId=${id}&needId=${o.need.id}`}>
              + Задача
            </Link>
          </>
        }
      />

      {priceChanged.length ? (
        <div className="alert alert-info mb-4">
          Текущая цена {priceChanged.length === 1 ? "объекта" : "части объектов"} изменилась или отличается от цены в КП — в предложении сохранена цена на момент подготовки.
        </div>
      ) : null}

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Предложение" className="lg:col-span-2">
          <Dl
            items={[
              ["Клиент / потребность", <Link key="n" className="link" href={`/needs/${o.need.id}`}>{clientName}</Link>],
              ["ИП/ООО", o.legalEntity?.displayName ?? <span key="l" className="text-amber-700">не выбрано — нужно для «Подготовлено»/«Отправлено»</span>],
              ["Статус", labelOf("offerStatus", o.status)],
              ["Отправлено", o.sentAt ? fmtDateTime(o.sentAt) : null],
              ["Действует до", o.expiresAt ? fmtDateOnly(o.expiresAt) : null],
              ["Ответственный", o.responsible.displayName],
              ["Создано", `${fmtDateTime(o.createdAt)} · ${o.creator.displayName}`],
              ["Источник", labelOf("offerGenerationSource", o.generationSource)],
              ["Заметки", o.notes],
            ]}
          />
        </Card>
        <Card title="Статус">
          {canChange ? (
            <OfferStatusActions offerId={id} updatedAt={updatedAt} status={o.status} hasLegalEntity={Boolean(o.legalEntityId)} timeZone={zone} />
          ) : (
            <span className="text-sm text-slate-500">Статус меняет ответственный, автор или руководитель.</span>
          )}
          {archived ? <p className="text-sm text-slate-500">Предложение в архиве.</p> : null}
          {!draft && !archived ? <p className="mt-3 text-xs text-slate-500">Состав и юрлицо подготовленного КП не меняются. Для правок верните КП в черновик (из «Подготовлено») или создайте новое.</p> : null}
        </Card>
      </div>

      <Card title={`Объекты (${o.items.length})`} bodyClassName="" className="mb-4">
        {o.items.length === 0 ? (
          <EmptyState title="Объекты не выбраны" />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th className="w-0">№</th>
                <th>Объект</th>
                <th>Площадь</th>
                <th>Цена в КП</th>
                <th>Условия</th>
                <th>Комментарий</th>
              </tr>
            </thead>
            <tbody>
              {o.items.map((i) => (
                <tr key={i.id}>
                  <td>{i.position}</td>
                  <td>
                    <Link className="link" href={`/properties/${i.property.id}`}>
                      {i.addressSnapshot ?? i.property.addressText}
                    </Link>
                    {i.property.status !== "active" ? <div className="text-xs text-slate-500">объект: {labelOf("propertyStatus", i.property.status)}</div> : null}
                  </td>
                  <td className="whitespace-nowrap">{fmtNum(i.areaSnapshot, "м²")}</td>
                  <td className="whitespace-nowrap">
                    {i.priceSnapshot ? fmtMoney(i.priceSnapshot) : "по запросу"}
                    {changed.has(i.id) ? (
                      <div className="mt-0.5 max-w-56 whitespace-normal text-xs text-amber-800">
                        <Badge tone="yellow">сейчас {fmtMoney(i.property.price)}</Badge>
                        <div>текущая цена объекта изменилась; в предложении сохранена цена на момент подготовки</div>
                      </div>
                    ) : null}
                  </td>
                  <td>{i.termsSnapshot ?? "—"}</td>
                  <td>{i.comment ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {o.introText ? (
        <Card title="Вводный текст" className="mb-4">
          <div className="whitespace-pre-wrap text-sm text-slate-800">{o.introText}</div>
        </Card>
      ) : null}

      <div className="space-y-4">
        <DocumentsPanel actor={actor} link={{ kind: "offer", id }} />
        <TaskList title="Задачи по предложению" tasks={tasks} emptyHint="Задач нет" newHref={`/tasks/new?offerId=${id}&needId=${o.need.id}`} />
      </div>
    </div>
  );
}
