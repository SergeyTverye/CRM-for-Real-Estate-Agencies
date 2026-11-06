import { api, json } from '@/server/api-handler';
import { uploadEnterprise } from '@/modules/import/application/enterprise-service';
import { ValidationError } from '@/shared/errors';
export const POST = api({ access: 'manager' }, async ({ req, actor }) => {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File))
        throw new ValidationError('Выберите .xlsx');
    const raw = form.get('profile');
    let profile: unknown;
    try {
        profile = typeof raw === 'string' && raw ? JSON.parse(raw) : undefined;
    }
    catch {
        throw new ValidationError('INVALID_PROFILE');
    }
    return json(await uploadEnterprise(actor, file, profile), 201);
});
