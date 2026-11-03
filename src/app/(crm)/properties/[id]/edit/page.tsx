import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageActor } from "@/server/page-auth";
import { getPropertyCard } from "@/modules/properties/application/property-queries";
import { NotFoundError } from "@/shared/errors";
import { Card, PageHeader } from "@/ui/components";
import { PropertyForm, type PropertyFormValue } from "../../property-form";
import { propertyFormOptions } from "../../form-options";

export const metadata = { title: "Редактирование объекта" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: { toString(): string } | number | null | undefined) => (v === null || v === undefined ? "" : v.toString());
const bool = (v: boolean | null) => (v === null ? "" : v ? "true" : "false");

export default async function EditPropertyPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePageActor();
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const card = await getPropertyCard(actor, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const p = card.property;
  const back = { href: `/properties/${id}`, label: p.addressText };
  if (!card.canEdit) {
    return (
      <div className="max-w-3xl">
        <PageHeader title="Редактирование объекта" back={back} />
        <div className="alert alert-warning">
          Изменять объект может ответственный риелтор или руководитель. Каталог доступен вам для просмотра и подбора.{" "}
          <Link className="link" href={back.href}>
            Вернуться к карточке
          </Link>
        </div>
      </div>
    );
  }
  const initial: PropertyFormValue = {
    operationType: p.operationType,
    propertyType: p.propertyType,
    propertySubtype: p.propertySubtype ?? "",
    sourceType: p.sourceType,
    sourcePlatformCode: p.sourcePlatformCode ?? "",
    sourceUrl: p.sourceUrl ?? "",
    addressText: p.addressText,
    district: p.district ?? "",
    area: str(p.area),
    price: str(p.price),
    floor: str(p.floor),
    floorsTotal: str(p.floorsTotal),
    roomsCount: str(p.roomsCount),
    landArea: str(p.landArea),
    buildingArea: str(p.buildingArea),
    commercialPurpose: p.commercialPurpose ?? "",
    powerKw: str(p.powerKw),
    parkingAvailable: bool(p.parkingAvailable),
    hasTenant: bool(p.hasTenant),
    status: p.status,
    description: p.description ?? "",
    responsibleUserId: p.responsibleUserId ?? "",
  };
  const options = await propertyFormOptions(actor, { create: false, current: initial });
  return (
    <div className="max-w-5xl">
      <PageHeader title="Редактирование объекта" back={back} subtitle="Ответственного меняет руководитель в карточке объекта." />
      <Card>
        <PropertyForm mode="edit" id={id} updatedAt={p.updatedAt.toISOString()} initial={initial} options={options} />
      </Card>
    </div>
  );
}
