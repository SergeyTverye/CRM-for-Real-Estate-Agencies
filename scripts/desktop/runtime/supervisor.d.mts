export function configureActiveGeneration(dataRoot?: string): Promise<void>;
export function configureHandoff(dataRoot?: string): Promise<void>;
export function configureSearchRuntime(env?: Record<string, string | undefined>): void;
export const NATIVE_IMPORT_MAX_BYTES: number;
export const NATIVE_IMPORT_TTL: number;
export function stageNativeImport(selectedPath: string, incomingRoot: string, id: string, actorUserId: string, maxBytes?: number): Promise<{ status: "selected"; kind: "import"; actorUserId: string; expiresAt: number }>;
export function cleanupNativeIncoming(incomingRoot: string, now?: number): Promise<void>;
