export function isRuntimeResource(relative: string, directory?: boolean, dist?: string): boolean;
export function safeCopyTrace(from: string, to: string, options?: { prefix?: string; dist?: string }): Promise<void>;
export function assertRuntimeResources(root: string, dist?: string): Promise<void>;
