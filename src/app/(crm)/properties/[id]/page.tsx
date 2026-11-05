/* eslint-disable @next/next/no-img-element -- authenticated property media */
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageActor } from "@/server/page-auth";
import { getPropertyCard } from "@/modules/properties/application/property-queries";
import { listActiveUsersBrief } from "@/modules/users/application/users-service";
import { dictLabel } from "@/modules/dictionaries/application/dictionaries-service";
import { NotFoundError } from "@/shared/errors";
import { labelOf } from "@/shared/codebook";
import { fmtDate, fmtDateOnly, fmtDateTime, fmtMoney, fmtNum, tz } from "@/server/format";
import { loadDictionaries } from "@/server/options";
import { Badge, Card, Dl, EmptyState, PageHeader, StatusBadge, Tabs } from "@/ui/components";
import { ActionButton, QuickFormButton } from "@/ui/client-kit";
import { listPropertyMedia } from "@/modules/properties/application/property-media-service";
import { PropertyGallery } from "../property-gallery";
import { AddOwnerButton, ReassignPropertyButton, RequestAccessButton } from "@/ui/domain/property-actions";

export const metadata = { title: "Объект" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const yesNo = (v: boolean | null) => (v === null ? null : v ? "есть" : "нет");

export default async function PropertyCardPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const actor = await requirePageActor();
  const { id } = await params;
  const { tab = "specs" } = await searchParams;
  if (!UUID_RE.test(id)) notFound();
  const card = await getPropertyCard(actor, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const dicts = await loadDictionaries();
  const p = card.property;
  const media = await listPropertyMedia(actor, id, true);
  const cover = media.find((m) => m.isCover) ?? media.find((m) => m.kind === "photo" && !m.archived);
  const isManager = actor.role === "manager";
  const zone = tz();
  const base = `/properties/${id}`;
  const external = p.sourceType === "external_market";
  const archived = p.status === "archived";
  const perSqm = p.price && p.area && Number(p.area.toString()) > 0 ? Math.round(Number(p.price.toString()) / Number(p.area.toString())) : null;
  const users = isManager ? await listActiveUsersBrief() : [];
  const userOpts = users.map((u) => ({ value: u.id, label: `${u.displayName}${u.roleCode === "manager" ? " (руководитель)" : ""}` }));
  const grantedIds = new Set(p.contactGrants.map((g) => g.userId));
  const grantCandidates = users
    .filter((u) => u.roleCode === "realtor" && u.id !== p.responsibleUserId && !grantedIds.has(u.id))
    .map((u) => ({ value: u.id, label: u.displayName }));

  const key: [string, React.ReactNode][] = [
    ["Операция", dictLabel(dicts, "property_operation_type", p.operationType)],
    ["Тип", `${dictLabel(dicts, "property_type", p.propertyType)}${p.propertySubtype ? ` · ${dictLabel(dicts, "property_subtype", p.propertySubtype)}` : ""}`],
    ["Площадь", p.area ? fmtNum(p.area, "м²") : "—"],
    [p.operationType === "rent" ? "Цена, в месяц" : "Цена", fmtMoney(p.price)],
    ["Цена за м²", perSqm !== null ? `${fmtMoney(perSqm)}` : "—"],
  ];
  if (p.roomsCount !== null) key.push(["Комнат", String(p.roomsCount)]);
  if (p.floor !== null) key.push(["Этаж", `${p.floor}${p.floorsTotal ? ` из ${p.floorsTotal}` : ""}`]);
  if (p.landArea) key.push(["Участок", fmtNum(p.landArea, "сот.")]);

  const activeAds = p.advertisements.filter((a) => a.status === "active").length;

  return (
    <div>
      <PageHeader
        back={{ href: "/properties", label: "Объекты" }}
        title={p.addressText}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={p.status} label={labelOf("propertyStatus", p.status)} />
            {external ? <Badge tone="yellow">Внешний рынок</Badge> : <Badge tone="blue">Объект агентства</Badge>}
            {external && p.sourcePlatformCode ? <span>{dictLabel(dicts, "ad_platform", p.sourcePlatformCode)}</span> : null}
            {external && p.sourceUrl ? (
              <a href={p.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="link">
                исходное объявление ↗
              </a>
            ) : null}
            {p.district ? <span>· {p.district}</span> : null}
            <span>· ответственный: {p.responsible?.displayName ?? "не назначен"}</span>
          </span>
        }
        actions={
          <>
            {!archived ? (
              <Link className="btn btn-primary" href={`/requests/new?propertyId=${id}`}>
                Зарегистрировать обращение по объекту
              </Link>
            ) : null}
            <Link className="btn" href={`/tasks/new?propertyId=${id}`}>
              + Задача
            </Link>
            {card.canEdit ? (
              <Link className="btn" href={`${base}/edit`}>
                Редактировать
              </Link>
            ) : null}
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        {key.slice(0, 5).map(([k, v]) => (
          <div key={k} className="card px-4 py-2.5">
            <div className="text-xs text-slate-500">{k}</div>
            <div className="text-sm font-medium text-slate-900">{v}</div>
          </div>
        ))}
      </div>

      {isManager ? (
        <Card className="mb-4" title="Управление">
          <div className="flex flex-wrap items-center gap-2">
            <ReassignPropertyButton propertyId={id} users={userOpts} currentUserId={p.responsibleUserId} />
            {archived ? (
              <ActionButton
                method="PATCH"
                url={`/api/v1/properties/${id}`}
                body={{ status: "active", expectedUpdatedAt: p.updatedAt.toISOString() }}
                label="Вернуть из архива"
                confirm="Вернуть объект в рабочий каталог (статус «Активен»)?"
              />
            ) : (
              <ActionButton
                method="PATCH"
                url={`/api/v1/properties/${id}`}
                body={{ status: "archived", expectedUpdatedAt: p.updatedAt.toISOString() }}
                label="В архив"
                className="btn btn-sm btn-danger"
                confirm="Перевести объект в архив? Он исчезнет из рабочего каталога и подбора; история показов, рекламы и сделок сохранится."
              />
            )}
            <span className="text-xs text-slate-500">Смена ответственного и архивирование фиксируются в журнале аудита.</span>
          </div>
        </Card>
      ) : null}

      {cover ? <a href={`${base}?tab=photos`}><img src={cover.url} alt={cover.caption || p.addressText} className="mb-4 max-h-72 w-full rounded object-contain" /></a> : null}
      <Tabs
        basePath={base}
        current={tab}
        tabs={[
          { key: "specs", label: "Характеристики" },
          { key: "owners", label: "Собственники", count: card.ownersCount },
          { key: "ads", label: "Реклама", count: activeAds },
          { key: "agreements", label: "Договоры", count: p.agreements.length },
          { key: "matches", label: "Подборы и показы", count: card.matches.length + p.showings.length },
          { key: "photos", label: "Фотографии" },
          { key: "documents", label: "Документы" },
        ]}
      />

      {tab === "specs" ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card title="Характеристики">
            <Dl
              items={[
                ...key,
                ...(p.buildingArea ? ([["Площадь строения", fmtNum(p.buildingArea, "м²")]] as [string, string][]) : []),
                ...(p.commercialPurpose ? ([["Назначение", dictLabel(dicts, "commercial_purpose", p.commercialPurpose)]] as [string, string][]) : []),
                ...(p.powerKw ? ([["Электрическая мощность", fmtNum(p.powerKw, "кВт")]] as [string, string][]) : []),
                ...(p.parkingAvailable !== null ? ([["Парковка", yesNo(p.parkingAvailable)]] as [string, string | null][]) : []),
                ...(p.hasTenant !== null ? ([["Арендатор", yesNo(p.hasTenant)]] as [string, string | null][]) : []),
              ]}
            />
          </Card>
          <Card title="Описание и происхождение">
            <Dl
              items={[
                ["Происхождение", labelOf("propertySourceType", p.sourceType)],
                ...(external
                  ? ([
                      ["Площадка-источник", p.sourcePlatformCode ? dictLabel(dicts, "ad_platform", p.sourcePlatformCode) : null],
                      [
                        "Ссылка",
                        p.sourceUrl ? (
                          <a key="u" href={p.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="link break-all">
                            {p.sourceUrl}
                          </a>
                        ) : null,
                      ],
                    ] as [string, React.ReactNode][])
                  : []),
                ["Описание", p.description ? <span key="d" className="whitespace-pre-line">{p.description}</span> : null],
                ["Создан", `${fmtDate(p.createdAt)} · ${p.creator.displayName}`],
                ["Изменён", fmtDateTime(p.updatedAt)],
                ...(p.archivedAt ? ([["В архиве с", fmtDate(p.archivedAt)]] as [string, string][]) : []),
              ]}
            />
          </Card>
        </div>
      ) : null}

      {tab === "owners" ? (
        <div className="space-y-4">
          {card.canSeeOwners ? (
            <Card bodyClassName="" title="Собственники" actions={card.canEdit ? <AddOwnerButton propertyId={id} /> : undefined}>
              {card.owners.length === 0 ? (
                <EmptyState
                  title="Собственники не указаны"
                  hint={card.canEdit ? "Добавьте собственника: выберите существующего клиента или создайте нового с контактами." : "Собственника добавляет ответственный риелтор или руководитель."}
                />
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Собственник</th>
                      <th>Контакты</th>
                      <th>Роль</th>
                      <th>Доля</th>
                      {card.canEdit ? <th className="w-0" aria-label="Действия" /> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {card.owners.map((o) => (
                      <tr key={o.id}>
                        <td>
                          {o.client?.visible ? (
                            <Link href={`/clients/${o.client.id}`} className="link font-medium">
                              {o.client.displayName}
                            </Link>
                          ) : (
                            <span className="font-medium">{o.client?.displayName}</span>
                          )}
                        </td>
                        <td>
                          {o.client?.contacts.length ? (
                            <ul>
                              {o.client.contacts.map((c, i) => (
                                <li key={i}>
                                  <span className="text-xs text-slate-500">{labelOf("contactType", c.contactType)}:</span> {c.rawValue}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <span className="text-slate-400">нет контактов</span>
                          )}
                        </td>
                        <td>{o.ownerRole ?? "—"}</td>
                        <td>{o.ownershipShare ? `${fmtNum(Number(o.ownershipShare) * 100)} %` : "—"}</td>
                        {card.canEdit ? (
                          <td>
                            <ActionButton
                              method="DELETE"
                              url={`/api/v1/properties/${id}/owners/${o.id}`}
                              label="Убрать"
                              className="btn btn-sm btn-link"
                              confirm="Убрать клиента из собственников объекта? Карточка клиента сохранится."
                            />
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          ) : (
            <Card title="Собственники">
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Badge tone="gray">Контакты собственника скрыты</Badge>
                  <span className="text-sm text-slate-600">
                    {card.ownersCount ? `Указано собственников: ${card.ownersCount}.` : "Собственники пока не указаны."}
                  </span>
                </div>
                <p className="text-sm text-slate-500">
                  Контакты собственника видит ответственный риелтор объекта ({p.responsible?.displayName ?? "не назначен"}) и руководитель. Для работы с чужим объектом
                  запросите доступ — разрешение выдаёт руководитель.
                </p>
                {card.ownersCount ? <RequestAccessButton propertyId={id} /> : null}
              </div>
            </Card>
          )}
          {!isManager && card.hasGrant ? <div className="alert alert-info">Доступ к контактам собственника выдан вам руководителем и может быть отозван.</div> : null}

          {isManager ? (
            <Card
              bodyClassName=""
              title="Доступ риелторов к контактам собственника"
              actions={
                grantCandidates.length ? (
                  <QuickFormButton
                    label="Выдать доступ риелтору"
                    title="Доступ к контактам собственника"
                    url={`/api/v1/properties/${id}/grants`}
                    timeZone={zone}
                    submitLabel="Выдать доступ"
                    fields={[
                      { name: "userId", label: "Риелтор", type: "select", required: true, options: grantCandidates, initial: grantCandidates[0]?.value },
                      { name: "comment", label: "Основание / комментарий", type: "textarea", hint: "Выдача и отзыв доступа фиксируются в журнале аудита" },
                    ]}
                  />
                ) : undefined
              }
            >
              {p.contactGrants.length === 0 ? (
                <EmptyState
                  title="Отдельных разрешений нет"
                  hint={`Контакты видят руководитель и ответственный риелтор${p.responsible ? ` (${p.responsible.displayName})` : ""}. Выдайте доступ другому риелтору, если он работает с объектом.`}
                />
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Риелтор</th>
                      <th>Выдан</th>
                      <th>Комментарий</th>
                      <th className="w-0" aria-label="Действия" />
                    </tr>
                  </thead>
                  <tbody>
                    {p.contactGrants.map((g) => (
                      <tr key={g.id}>
                        <td>{g.user.displayName}</td>
                        <td>{fmtDateTime(g.grantedAt)}</td>
                        <td>{g.comment ?? "—"}</td>
                        <td>
                          <ActionButton
                            method="DELETE"
                            url={`/api/v1/properties/${id}/grants/${g.id}`}
                            label="Отозвать"
                            className="btn btn-sm btn-danger"
                            confirm={`Отозвать доступ к контактам собственника у ${g.user.displayName}? Доступ прекратится сразу.`}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          ) : null}
        </div>
      ) : null}

      {tab === "ads" ? (
        <Card
          bodyClassName=""
          title="Рекламные объявления"
          actions={
            !archived ? (
              <Link className="btn btn-sm btn-primary" href={`/advertisements/new?propertyId=${id}`}>
                + Объявление
              </Link>
            ) : undefined
          }
        >
          {p.advertisements.length === 0 ? (
            <EmptyState
              title="Объявлений нет"
              hint={external ? "Это объект внешнего рынка: исходное объявление указано в характеристиках. Собственная реклама агентства ведётся через «+ Объявление»." : "Добавьте объявление, чтобы контролировать публикацию, проверки и срок размещения."}
            />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Площадка</th>
                  <th>Ссылка</th>
                  <th>Статус</th>
                  <th>Опубликовано</th>
                  <th>Последняя проверка</th>
                  <th>Срок</th>
                  <th>Ответственный</th>
                </tr>
              </thead>
              <tbody>
                {p.advertisements.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <Link href={`/advertisements/${a.id}`} className="link">
                        {dictLabel(dicts, "ad_platform", a.platformCode)}
                      </Link>
                    </td>
                    <td className="max-w-64 truncate">
                      {a.url ? (
                        <a href={a.url} target="_blank" rel="noopener noreferrer nofollow" className="link">
                          {a.url}
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      <StatusBadge status={a.status} label={labelOf("advertisementStatus", a.status)} />
                    </td>
                    <td>{fmtDateTime(a.publishedAt)}</td>
                    <td>{a.lastCheckedAt ? fmtDateTime(a.lastCheckedAt) : <span className="text-amber-700">не проверялось</span>}</td>
                    <td>{fmtDateOnly(a.expiresAt)}</td>
                    <td>{a.responsible?.displayName ?? p.responsible?.displayName ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      ) : null}

      {tab === "agreements" ? (
        <Card
          bodyClassName=""
          title="Договоры по объекту"
          actions={
            <Link className="btn btn-sm btn-primary" href={`/agreements/new?propertyId=${id}`}>
              + Договор
            </Link>
          }
        >
          {p.agreements.length === 0 ? (
            <EmptyState title="Договоров нет" hint="Зафиксируйте договор с собственником или отметьте, что договора нет и почему." />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Договор</th>
                  <th>Статус</th>
                  <th>Эксклюзив</th>
                  <th>Юр. лицо</th>
                  <th>Подписан</th>
                  <th>Действует до</th>
                </tr>
              </thead>
              <tbody>
                {p.agreements.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <Link href={`/agreements/${a.id}`} className="link">
                        {labelOf("agreementType", a.agreementType)}
                        {a.agreementNumber ? ` № ${a.agreementNumber}` : ""}
                      </Link>
                      {a.actionRequired ? <div className="text-xs text-amber-700">Требуется: {a.actionRequired}</div> : null}
                    </td>
                    <td>
                      <StatusBadge status={a.status} label={labelOf("agreementStatus", a.status)} />
                    </td>
                    <td>{a.isExclusive === null ? "—" : a.isExclusive ? "да" : "нет"}</td>
                    <td>{a.legalEntity?.displayName ?? "—"}</td>
                    <td>{fmtDateOnly(a.signedAt)}</td>
                    <td>{fmtDateOnly(a.validUntil)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      ) : null}

      {tab === "matches" ? (
        <div className="space-y-4">
          <Card bodyClassName="" title="Предложения клиентам (подборы)">
            {card.matches.length === 0 ? (
              <EmptyState title="Объект ещё не предлагали" hint="Предложите объект из карточки потребности клиента — там же фиксируется реакция." />
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Дата</th>
                    <th>Клиент / потребность</th>
                    <th>Статус</th>
                    <th>Причина отказа</th>
                    <th>Комментарий</th>
                  </tr>
                </thead>
                <tbody>
                  {card.matches.map((m) => (
                    <tr key={m.id}>
                      <td>{fmtDate(m.offeredAt)}</td>
                      <td>
                        {m.clientVisible ? (
                          <Link href={`/needs/${m.need.id}`} className="link">
                            {m.need.client.displayName}
                          </Link>
                        ) : (
                          <span className="text-slate-500">Клиент другого риелтора</span>
                        )}
                      </td>
                      <td>
                        <StatusBadge status={m.status} label={labelOf("matchStatus", m.status)} />
                      </td>
                      <td>{m.rejectionReasonCode ? dictLabel(dicts, "match_rejection_reason", m.rejectionReasonCode) : "—"}</td>
                      <td>{m.clientVisible ? (m.comment ?? "—") : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          <Card bodyClassName="" title="Показы">
            {p.showings.length === 0 ? (
              <EmptyState title="Показов не было" hint="Показ назначается из потребности клиента после предложения объекта." />
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Плановая дата</th>
                    <th>Фактически</th>
                    <th>Статус</th>
                    <th>Результат</th>
                    <th>Комментарий</th>
                  </tr>
                </thead>
                <tbody>
                  {p.showings.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <Link href={`/showings/${s.id}`} className="link">
                          {fmtDateTime(s.scheduledAt)}
                        </Link>
                      </td>
                      <td>{fmtDateTime(s.occurredAt)}</td>
                      <td>
                        <StatusBadge status={s.status} label={labelOf("showingStatus", s.status)} />
                      </td>
                      <td>{labelOf("showingResult", s.resultCode)}</td>
                      <td>{s.comment ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>
      ) : null}

      {tab === "photos" || tab === "documents" ? <PropertyGallery propertyId={id} items={media} canEdit={card.canEdit} kind={tab === "photos" ? "photo" : "document"} /> : null}
    </div>
  );
}
