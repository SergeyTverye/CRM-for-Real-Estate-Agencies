/** Existing result codes explicitly mark a continuing selection request. */
export const PROSPECTIVE_RESULTS = ["new_need", "linked_existing_need"];
export function isProspectiveResult(code: string): boolean { return PROSPECTIVE_RESULTS.includes(code); }
