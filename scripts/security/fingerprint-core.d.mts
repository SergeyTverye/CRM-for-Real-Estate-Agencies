export function normalize(value: unknown): string;
export function sha256(value: string): string;
export function cellForms(value: unknown): Set<string>;
export function textForms(value: unknown): Generator<string>;
export function matchesText(value: unknown, hashes: ReadonlySet<string>): boolean;
