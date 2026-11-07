export function isRuntimeResource(relative: string, directory?: boolean, dist?: string): boolean;
export function safeCopyTrace(from: string, to: string, options?: { prefix?: string; dist?: string }): Promise<void>;
export function assertRuntimeResources(root: string, dist?: string): Promise<void>;
export function refreshRuntimeAliases(root: string, dist?: string): Promise<number>;
export function assertCompiledServerComplete(compiledDir: string, resourcesDir: string, options?: { dist?: string }): Promise<void>;
export function supplementCompiledServer(compiledDir: string, resourcesDir: string, options?: { dist?: string }): Promise<void>;
