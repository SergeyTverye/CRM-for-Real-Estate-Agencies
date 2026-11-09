import "server-only";
import { loadDictionaries, type Dictionaries } from "@/modules/dictionaries/application/dictionaries-service";
import type { DictionaryCategory } from "@/modules/dictionaries/domain/dictionary-data";
import { listActiveUsersBrief } from "@/modules/users/application/users-service";
import { optionsOf, type CodebookName } from "@/shared/codebook";

export interface Option {
  value: string;
  label: string;
}


export function dictOptions(dicts: Dictionaries, category: DictionaryCategory, keep?: string | null): Option[] {
  return dicts[category].filter((o) => o.isActive || o.value === keep).map(({ value, label }) => ({ value, label }));
}

export const codeOptions = (name: CodebookName): Option[] => optionsOf(name);

export async function userOptions(): Promise<Option[]> {
  const users = await listActiveUsersBrief();
  return users.map((u) => ({ value: u.id, label: `${u.displayName}${u.roleCode === "manager" ? " (руководитель)" : ""}` }));
}

export { loadDictionaries };
export type { Dictionaries };
