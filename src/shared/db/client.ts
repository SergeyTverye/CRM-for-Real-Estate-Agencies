import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Prisma } from "@/generated/prisma/client";
import { getConfig } from "../config/env";


function createClient(): PrismaClient {
  if (getConfig().CRM_DEPLOYMENT_MODE === "desktop") {
    return lazyDesktopClient(getConfig().DATABASE_URL);
  }
  const adapter = new PrismaPg({ connectionString: getConfig().DATABASE_URL, max: 10 });
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as { __crmPrisma?: PrismaClient };

export function getDb(): PrismaClient {
  if (!globalForPrisma.__crmPrisma) globalForPrisma.__crmPrisma = createClient();
  return globalForPrisma.__crmPrisma;
}


export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getDb() as unknown as Record<string | symbol, unknown>;
    const value = Reflect.get(client, prop);
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(client) : value;
  },
});

export type Tx = Prisma.TransactionClient;
export type DbOrTx = PrismaClient | Tx;


export function transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return getDb().$transaction(fn, { timeout: 30_000, maxWait: 10_000 });
}

export async function disconnectDb(): Promise<void> {
  if (globalForPrisma.__crmPrisma) {
    await globalForPrisma.__crmPrisma.$disconnect();
    globalForPrisma.__crmPrisma = undefined;
  }
}

export { Prisma };

function lazyDesktopClient(url: string): PrismaClient {
  let pending: Promise<PrismaClient> | undefined;
  const load = () => pending ??= import("./sqlite-client").then(m => m.createSqliteClient(url));
  const cache: Record<string, unknown> = {};
  return new Proxy(cache, {
    get(target, prop) {
      if (typeof prop !== "string") return undefined;
      if (Object.hasOwn(target, prop)) return target[prop];
      if (prop.startsWith("$")) return target[prop] = async (...args: unknown[]) => {
        if (prop === "$transaction" && Array.isArray(args[0])) {
          const work = args[0] as {__sqliteDeferred?: () => Promise<unknown>}[];
          if (work.some(item => typeof item?.__sqliteDeferred !== "function")) throw new Error("SQLITE_BATCH_REQUIRES_DEFERRED_QUERIES");
          return (await load()).$transaction(async () => {
            const results: unknown[]=[];
            for (const item of work) results.push(await item.__sqliteDeferred!());
            return results;
          }, args[1] as object);
        }
        const client = await load();
        const fn = Reflect.get(client, prop) as (...values: unknown[]) => unknown;
        return fn.apply(client, args);
      };
      const methods: Record<string, unknown> = {};
      return target[prop] = new Proxy(methods, { get(model, operation) {
        if (typeof operation !== "string") return undefined;
        if (Object.hasOwn(model, operation)) return model[operation];
        return model[operation] = (...args: unknown[]) => {
          const run = async () => { const delegate = Reflect.get(await load(), prop); return Reflect.get(delegate, operation).apply(delegate, args); };
          let pending:Promise<unknown>|undefined;
          const promise=()=>pending??=run();
          return {__sqliteDeferred:run,then:(...handlers: Parameters<Promise<unknown>["then"]>)=>promise().then(...handlers),catch:(...handlers:Parameters<Promise<unknown>["catch"]>)=>promise().catch(...handlers),finally:(...handlers:Parameters<Promise<unknown>["finally"]>)=>promise().finally(...handlers),[Symbol.toStringTag]:"PrismaPromise"};
        };
      }, getOwnPropertyDescriptor(model, operation) {
        return Reflect.getOwnPropertyDescriptor(model, operation) ?? {configurable:true, enumerable:true, writable:true, value:undefined};
      } });
    }, getOwnPropertyDescriptor(target, prop) {
      return Reflect.getOwnPropertyDescriptor(target, prop) ?? {configurable:true, enumerable:true, writable:true, value:undefined};
    },
  }) as unknown as PrismaClient;
}

export async function independentCommitScope<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (getConfig().CRM_DEPLOYMENT_MODE === "desktop") {
    const { serializeSqliteWork } = await import("./sqlite-client");
    return serializeSqliteWork(getConfig().DATABASE_URL, () => fn(getDb()));
  }
  return getDb().$transaction(fn, {timeout:180000,maxWait:10000});
}
