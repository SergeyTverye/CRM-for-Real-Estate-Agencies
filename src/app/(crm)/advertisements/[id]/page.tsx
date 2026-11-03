import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageActor } from "@/server/page-auth";
import { getAdvertisement } from "@/modules/advertisements/application/advertisement-service";
import { listTasksLinkedTo } from "@/modules/tasks/application/task-queries";
import { dictLabel } from "@/modules/dictionaries/application/dictionaries-service";
import { getConfig } from "@/shared/config/env";
import { NotFoundError } from "@/shared/errors";
import { labelOf } from "@/shared/codebook";
import { addDays, todayAsDateOnly } from "@/shared/time";
import { fmtDate, fmtDateOnly, fmtDateTime, tz } from "@/server/format";
import { loadDictionaries } from "@/server/options";
import { Badge, Card, Dl, PageHeader, StatusBadge } from "@/ui/components";
import { ActionButton } from "@/ui/client-kit";
import { TaskList } from "@/ui/domain/task-list";
import { DocumentsPanel } from "@/ui/domain/documents-panel";
import { AdQuickActions } from "@/ui/domain/ad-quick-actions";

export const metadata = { title: "Объявление" };

export default async function AdvertisementCardPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePageActor();
  const { id } = await params;
  let data;
  try {
    data = await getAdvertisement(actor, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const { advertisement: ad, canEdit } = data;
  const dicts = await loadDictionaries();
  const tasks = await listTasksLinkedTo(actor, { advertisementId: id }, { includeClosed: true, take: 50 });
  const cfg = getConfig();
  const nextCheckAt = ad.lastCheckedAt ? addDays(ad.lastCheckedAt, cfg.AD_CHECK_INTERVAL_DAYS) : null;
  const checkOverdue = ad.status === "active" && (!nextCheckAt || nextCheckAt < new Date());
  const isExpired = ad.expiresAt !== null && ad.expiresAt < todayAsDateOnly(new Date(), tz());
  const platform = dictLabel(dicts, "ad_platform", ad.platformCode);

  return (
    <div>
      <PageHeader
        back={{ href: "/advertisements", label: "Реклама" }}
        title={`${platform}: ${ad.property.addressText}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={ad.status} label={labelOf("advertisementStatus", ad.status)} />
            {checkOverdue ? <Badge tone="red">проверка просрочена</Badge> : null}
            {isExpired ? <Badge tone="red">срок размещения истёк</Badge> : null}
            <span>· ответственный: {ad.responsible?.displayName ?? "не назначен"}</span>
          </span>
        }
        actions={
          canEdit ? (
            <>
              {ad.status === "active" ? (
                <ActionButton method="PATCH" url={`/api/v1/advertisements/${id}`} body={{ expectedUpdatedAt: ad.updatedAt.toISOString(), markChecked: true }} label="Проверено, актуально" className="btn btn-primary" />
              ) : null}
              <Link className="btn" href={`/advertisements/${id}/edit`}>
                Редактировать
              </Link>
            </>
          ) : null
        }
      />
      {!canEdit ? <div className="alert alert-info mb-4">Объявление ведёт ответственный за объект риелтор или руководитель — доступен просмотр.</div> : null}

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card title="Объявление" actions={canEdit ? <AdQuickActions adId={id} updatedAt={ad.updatedAt.toISOString()} status={ad.status} canCheck={false} /> : undefined}>
          <Dl
            items={[
              ["Объект", <Link key="p" className="link" href={`/properties/${ad.property.id}`}>{ad.property.addressText}</Link>],
              ["Площадка", platform],
              [
                "Ссылка",
                ad.url ? (
                  <a className="link break-all" href={ad.url} target="_blank" rel="noopener noreferrer">
                    {ad.url}
                  </a>
                ) : null,
              ],
              ["Статус", labelOf("advertisementStatus", ad.status)],
              ["Опубликовано", ad.publishedAt ? fmtDateTime(ad.publishedAt) : null],
              ["Последняя проверка", ad.lastCheckedAt ? fmtDateTime(ad.lastCheckedAt) : "не проверялось"],
              ["Следующая проверка", ad.status === "active" ? <span key="n" className={checkOverdue ? "font-medium text-red-600" : ""}>{nextCheckAt ? fmtDate(nextCheckAt) : "сейчас"}</span> : null],
              ["Активно до", ad.expiresAt ? <span key="e" className={isExpired ? "font-medium text-red-600" : ""}>{fmtDateOnly(ad.expiresAt)}</span> : null],
              ["Ответственный", ad.responsible?.displayName],
              ["Комментарий", ad.comment],
              ["Создано / изменено", `${fmtDateTime(ad.createdAt)} / ${fmtDateTime(ad.updatedAt)}`],
            ]}
          />
        </Card>
        <Card title="Текст объявления" actions={canEdit ? <Link className="btn btn-sm" href={`/advertisements/${id}/edit`}>Изменить текст</Link> : undefined}>
          {ad.adText ? <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{ad.adText}</div> : <span className="text-sm text-slate-500">Текст не сохранён</span>}
        </Card>
      </div>

      <div className="space-y-4">
        <TaskList title="Задачи по объявлению" tasks={tasks} emptyHint="Задач нет" newHref={`/tasks/new?advertisementId=${id}&propertyId=${ad.property.id}`} />
        <DocumentsPanel actor={actor} link={{ kind: "advertisement", id }} canUpload={canEdit} />
      </div>
    </div>
  );
}
