"use client";
import { useRouter } from "next/navigation";
import { ActionButton } from "@/ui/client-kit";
export function RevisionButton({ id, updatedAt }: { id: string; updatedAt: string }) {
 const router = useRouter();
 return <ActionButton url={`/api/v1/offers/${id}/revision`} body={{ expectedUpdatedAt: updatedAt }} label="Новая редакция" className="btn" onDone={data => router.push(`/offers/${(data as { id: string }).id}/edit`)} />;
}
