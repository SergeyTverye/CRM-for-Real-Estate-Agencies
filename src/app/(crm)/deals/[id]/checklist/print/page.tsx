import { requirePageActor } from "@/server/page-auth";
import { ChecklistPanel } from "../../checklist-panel";
import { PrintStyle } from "@/modules/export/presentation/print-style";
export default async function ChecklistPrint({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePageActor(); const { id } = await params;
  return <article className="crm-print"><PrintStyle/><ChecklistPanel actor={actor} dealId={id} canEdit={false} print /></article>;
}
