import { db } from "@/shared/db/client";

/**
 * Активные ИП/ООО для выпадающих списков форм сделок, договоров и КП (ТЗ 37.10–37.11, 37.20).
 * Только чтение справочных полей. права на выбор не нужны — запись всё равно проверяется командой.
 */
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
