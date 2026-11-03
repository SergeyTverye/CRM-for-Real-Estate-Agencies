import { beforeEach, describe, expect, it } from "vitest";
import { buildSampleWorkbook } from "../../scripts/dev/import-sample-builder";
import { db, resetDatabase, seedBase, type TestUsers } from "../helpers/fixtures";
import { cancelImport, commitImport, getImportJob, uploadImport } from "@/modules/import/application/import-service";
import { ForbiddenError } from "@/shared/errors";

let u: TestUsers;
let file: File;
beforeEach(async () => {
  await resetDatabase();
  u = await seedBase();
  file = new File([new Uint8Array(await buildSampleWorkbook())], "Синтетический образец.xlsx");
});

const operationalCounts = async () => ({
  clients: await db.client.count(),
  properties: await db.property.count(),
  needs: await db.clientNeed.count(),
  requests: await db.leadRequest.count(),
  archive: await db.historicalDealArchive.count(),
  agreements: await db.agreement.count(),
  ads: await db.advertisement.count(),
  tasks: await db.task.count(),
});

describe("T07 / UC-09: импорт dry-run и commit", () => {
  it("только руководитель", async () => {
    await expect(uploadImport(u.realtor1, file)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("dry-run не меняет рабочие данные и формирует validation_status по строкам", async () => {
    const before = await operationalCounts();
    const { id } = await uploadImport(u.manager, file);
    expect(await operationalCounts()).toEqual(before);
    const job = await db.importJob.findUniqueOrThrow({ where: { id } });
    expect(job.status).toBe("dry_run_ready");
    expect(job.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(job.probableDuplicates).toBeGreaterThan(0);
    const rows = await db.importRowResult.findMany({ where: { importJobId: id } });
    expect(rows.every((r) => r.commitResult === null)).toBe(true);
    const statuses = new Set(rows.map((r) => r.validationStatus));
    for (const s of ["ready", "warning", "invalid", "unrecognized"]) expect(statuses).toContain(s);
    expect(rows.some((r) => r.warningCodes.includes("probable_duplicate"))).toBe(true);
    // Паспорт/«выдан»/регистрация не попадают в import_row_results ни в каком виде.
    expect(JSON.stringify(rows)).not.toMatch(/0000 000000|УФМС|Регистрационная/);
    const report = await getImportJob(u.manager, id, { problemsOnly: "yes", pageSize: 200 });
    expect(JSON.stringify(report)).not.toMatch(/0000 000000|УФМС|Регистрационная|1980/);
    const hist = report.sections.find((s) => s.profileCode === "historical_deals_v1")!;
    expect(hist.excludedByPolicy).toEqual(["Дата рождения", "Паспорт", "Выдан", "Регистрация"]);
  });

  it("commit по секциям: контрольное равенство, идемпотентность, исключение ПДн", async () => {
    const { id } = await uploadImport(u.manager, file);
    const { sections } = await getImportJob(u.manager, id);
    const histKey = sections.find((s) => s.profileCode === "historical_deals_v1")!.sectionKey;
    const incKey = sections.find((s) => s.profileCode === "incoming_clients_v1")!.sectionKey;
    const unrec = sections.find((s) => s.status === "unrecognized")!.sectionKey;
    await expect(commitImport(u.manager, id, { sections: [unrec] })).rejects.toThrow();

    const r1 = await commitImport(u.manager, id, { sections: [histKey, incKey], options: { coordinatesAsPhone: true } });
    expect(r1.rowsRead).toBe(r1.rowsImported + r1.rowsSkipped + r1.rowsError);
    expect(r1.status).toBe("dry_run_ready"); // остальные секции ещё не загружены
    const archive = await db.historicalDealArchive.findMany();
    expect(archive.length).toBe(31); // 32 строки − 1 без адреса и ФИО
    expect(JSON.stringify(archive)).not.toMatch(/0000 000000|УФМС|Регистрационная|1980/);
    // обработанные строки получили commit_result, не обработанные секции — нет
    const processed = await db.importRowResult.findMany({ where: { importJobId: id, sourceSection: { in: ["historical_deals_v1", "incoming_clients_v1"] } } });
    expect(processed.every((r) => r.commitResult !== null)).toBe(true);
    const untouched = await db.importRowResult.findMany({ where: { importJobId: id, sourceSection: "commercial_rent_objects_v1" } });
    expect(untouched.every((r) => r.commitResult === null)).toBe(true);
    // Каждая импортированная активная потребность имеет следующее действие (инвариант)
    const activeNeeds = await db.clientNeed.findMany({ where: { status: "active" }, include: { taskLinks: { include: { task: true } } } });
    expect(activeNeeds.length).toBeGreaterThan(0);
    expect(activeNeeds.every((n) => n.taskLinks.some((l) => l.task.status === "planned"))).toBe(true);
    // Дубль телефона внутри файла не создал второго клиента
    const dupRows = processed.filter((r) => r.warningCodes.includes("probable_duplicate"));
    expect(dupRows.every((r) => r.commitResult === "skipped")).toBe(true);

    // Оставшиеся секции
    const rest = sections.filter((s) => s.status === "recognized" && ![histKey, incKey].includes(s.sectionKey)).map((s) => s.sectionKey);
    const r2 = await commitImport(u.manager, id, { sections: rest, options: { createTasksFromFixNotes: true } });
    expect(r2.status).toMatch(/^completed/);
    const job = await db.importJob.findUniqueOrThrow({ where: { id } });
    expect(job.rowsRead).toBe(job.rowsImported + job.rowsSkipped + job.rowsError);
    expect(await db.agreement.count({ where: { status: "no_agreement" } })).toBeGreaterThan(0);
    expect(await db.property.count({ where: { sourceType: "external_market" } })).toBeGreaterThan(0);

    // Повторная загрузка того же файла не удваивает архив и клиентов
    const counts = await operationalCounts();
    const { id: id2 } = await uploadImport(u.manager, new File([new Uint8Array(await buildSampleWorkbook())], "повтор.xlsx"));
    const s2 = (await getImportJob(u.manager, id2)).sections.filter((s) => s.status === "recognized").map((s) => s.sectionKey);
    await commitImport(u.manager, id2, { sections: s2 });
    const after = await operationalCounts();
    expect(after.archive).toBe(counts.archive);
  });

  it("отмена задания удаляет временный файл и не создаёт данных", async () => {
    const { id } = await uploadImport(u.manager, file);
    await cancelImport(u.manager, id);
    expect((await db.importJob.findUniqueOrThrow({ where: { id } })).status).toBe("cancelled");
    await expect(commitImport(u.manager, id, { sections: ["x"] })).rejects.toThrow();
  });
});
