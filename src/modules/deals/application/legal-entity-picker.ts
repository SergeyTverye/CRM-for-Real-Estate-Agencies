import { db } from "@/shared/db/client";


export interface LegalEntityPickerItem {
  id: string;
  entityType: string;
  displayName: string;
}

export async function listActiveLegalEntitiesForPicker(): Promise<LegalEntityPickerItem[]> {
  return db.legalEntity.findMany({
    where: { isActive: true },
    select: { id: true, entityType: true, displayName: true },
    orderBy: { displayName: "asc" },
  });
}
