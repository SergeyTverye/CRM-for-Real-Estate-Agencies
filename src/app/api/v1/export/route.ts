import { api } from "@/server/api-handler";
import { exportData } from "@/modules/export/application/export-service";


export const GET = api({ access: "manager" }, async ({ actor }) => {
  const { fileName, data } = await exportData(actor);
  return new Response(data as unknown as BodyInit, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${fileName}"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
});
