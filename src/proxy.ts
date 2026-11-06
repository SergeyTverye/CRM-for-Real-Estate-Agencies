import { NextResponse, type NextRequest } from "next/server";
import { desktopLoopbackAllowed } from "@/shared/auth/desktop-loopback";
export function proxy(req: NextRequest) {
  if (!desktopLoopbackAllowed(req.headers, req.method)) return new NextResponse("Источник запроса не разрешён", { status: 403, headers: { "cache-control": "no-store" } });
  return NextResponse.next();
}
