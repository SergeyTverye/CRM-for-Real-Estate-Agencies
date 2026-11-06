export const runtimeEntries: Readonly<Record<string, string>>;
export const runtimeBuildOptions: import("esbuild").BuildOptions;
export function assertRuntimeEntries(options?: { tracked?: boolean }): void;
