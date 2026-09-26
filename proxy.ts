import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/session";

/** Next.js 16 renamed the `middleware` convention to `proxy`; the export name
 *  moved with it. Runtime is nodejs and is not configurable here. */
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Every path except static assets and image files. Auth cookies rotate
     * on the request that needs them, so the matcher stays broad.
     *
     * robots.txt is excluded like favicon.ico (issue #60): a crawler has no
     * session, and without this it was sent to /login for the file.
     */
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico)$).*)",
  ],
};
