import { notFound } from "next/navigation";
import { requirePageActor } from "@/server/page-auth";
import { getNeedCard } from "@/modules/needs/application/need-queries";
import { NotFoundError } from "@/shared/errors";
import { dictOptions, loadDictionaries } from "@/server/options";
import { Card, PageHeader } from "@/ui/components";
import { needTitle } from "@/ui/domain/need-params-summary";
import type { NeedParamsValue } from "@/ui/domain/need-params-fields";
import { NeedEditForm } from "./edit-form";

export const metadata = { title: "Параметры потребности" };

const str = (v: { toString(): string } | number | null | undefined) => (v === null || v === undefined ? "" : v.toString());
const bool = (v: boolean | null) => (v === null ? "" : v ? "true" : "false");

export default async function EditNeedPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePageActor();
  const { id } = await params;
  const card = await getNeedCard(actor, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const n = card.need;
  const dicts = await loadDictionaries();
  const initial: NeedParamsValue = {
    operationType: n.operationType,
    propertyType: n.propertyType,
    propertySubtype: n.propertySubtype ?? "",
    financingType: n.financingType ?? "",
    mortgageStatus: n.mortgageStatus ?? "",
    budgetMin: str(n.budgetMin),
    budgetMax: str(n.budgetMax),
    district: n.district ?? "",
    locationText: n.locationText ?? "",
    areaMin: str(n.areaMin),
    areaMax: str(n.areaMax),
    commercialPurpose: n.commercialPurpose ?? "",
    floorMin: str(n.floorMin),
    floorMax: str(n.floorMax),
    roomsMin: str(n.roomsMin),
    roomsMax: str(n.roomsMax),
    landAreaMin: str(n.landAreaMin),
    landAreaMax: str(n.landAreaMax),
    buildingAreaMin: str(n.buildingAreaMin),
    buildingAreaMax: str(n.buildingAreaMax),
    powerRequirement: str(n.powerRequirement),
    parkingRequirement: bool(n.parkingRequirement),
    tenantRequirement: bool(n.tenantRequirement),
    notes: n.notes ?? "",
  };
  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Параметры потребности"
        back={{ href: `/needs/${id}`, label: needTitle(dicts, n) }}
        subtitle={card.clientVisible ? `Клиент: ${n.client.displayName}` : undefined}
      />
      <Card>
        <NeedEditForm
          id={id}
          updatedAt={n.updatedAt.toISOString()}
          initial={initial}
          options={{
            operationTypes: dictOptions(dicts, "need_operation_type", n.operationType),
            propertyTypes: dictOptions(dicts, "property_type", n.propertyType),
            propertySubtypes: dictOptions(dicts, "property_subtype", n.propertySubtype),
            commercialPurposes: dictOptions(dicts, "commercial_purpose", n.commercialPurpose),
          }}
        />
      </Card>
    </div>
  );
}
