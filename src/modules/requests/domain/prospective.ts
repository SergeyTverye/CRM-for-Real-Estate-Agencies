export const PROSPECTIVE_RESULTS = ["new_need", "linked_existing_need"];
export function isProspectiveResult(code: string): boolean { return PROSPECTIVE_RESULTS.includes(code); }
