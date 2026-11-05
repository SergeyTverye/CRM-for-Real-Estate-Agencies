import { api } from "@/server/api-handler";
import { dictOptions, loadDictionaries, userOptions } from "@/server/options";
import { tz } from "@/server/format";
export const GET = api({}, async ({ actor }) => {
  const dicts = await loadDictionaries();
  return { actorId: actor.userId, isManager: actor.role === "manager", timeZone: tz(), callMode: true,
    channels: dictOptions(dicts, "lead_channel"), sources: dictOptions(dicts, "lead_source"), users: actor.role === "manager" ? await userOptions() : [],
    needOptions: { operationTypes: dictOptions(dicts, "need_operation_type"), propertyTypes: dictOptions(dicts, "property_type"), propertySubtypes: dictOptions(dicts, "property_subtype"), commercialPurposes: dictOptions(dicts, "commercial_purpose") },
    initialProperty: null, initialPreview: null, initialClient: null, initialClientNeeds: [],
  };
});
