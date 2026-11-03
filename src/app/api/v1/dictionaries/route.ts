import { api } from "@/server/api-handler";
import { loadDictionaries } from "@/modules/dictionaries/application/dictionaries-service";

export const GET = api({}, async () => loadDictionaries());
