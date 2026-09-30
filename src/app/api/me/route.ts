import { getViewer } from "@/lib/auth";

/** GET /api/me — who this browser is logged in as. */
export async function GET() {
  const v = await getViewer();
  return Response.json({
    team: v?.teamName ?? null,
    role: v?.role ?? null,
  });
}
