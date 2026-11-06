import { api, readJson } from '@/server/api-handler';
import { commitEnterprise, inspectEnterprise, remapEnterprise } from '@/modules/import/application/enterprise-service';
export const GET = api<{ id: string }>({ access: 'manager' }, async ({ actor, params }) => inspectEnterprise(actor, params.id!));
export const PATCH = api<{ id: string }>({ access: 'manager' }, async ({ actor, params, req }) => remapEnterprise(actor, params.id!, await readJson(req)));
export const POST = api<{ id: string }>({ access: 'manager' }, async ({ actor, params, req }) => commitEnterprise(actor, params.id!, await readJson(req)));
