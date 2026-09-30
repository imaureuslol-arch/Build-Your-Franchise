import { NextRequest } from "next/server";
import { audit, createDeviceLink, getViewer, notLoggedIn } from "@/lib/auth";

/** POST /api/me/device-link — one-time 10-minute link to log in another device. */
export async function POST(request: NextRequest) {
  const viewer = await getViewer();
  if (!viewer) return notLoggedIn();
  const token = await createDeviceLink(viewer);
  await audit(viewer, "device_link_created", {});
  return Response.json({ url: `${request.nextUrl.origin}/join/${token}` });
}
