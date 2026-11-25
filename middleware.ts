// Route protection. OWNER: Jaanhavi
// Runs on the Edge runtime, so it only uses lib/session.ts (jose), never bcrypt or pg.
import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

const PUBLIC_PREFIXES = ["/login", "/signup", "/demo", "/api/auth/login", "/api/auth/logout", "/api/auth/signup", "/api/health", "/api/webhooks/alerts"];
const CUSTOMER_PREFIXES = ["/ops", "/workspace", "/api/ops", "/api/workspace", "/api/auth/me"];
const ADMIN_ONLY_PAGES = ["/admin", "/dashboard"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isApi = pathname.startsWith("/api/");
  const isPublic = pathname === "/" || PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const user = token ? await verifySession(token) : null;

  if (pathname === "/login" && user) {
    const invite = req.nextUrl.searchParams.get("invite");
    if (user.role === "CUSTOMER" && invite && /^[a-f0-9]{64}$/.test(invite)) {
      return NextResponse.redirect(new URL(`/signup?invite=${invite}`, req.url));
    }
    return NextResponse.redirect(new URL(user.role === "CUSTOMER" ? "/ops" : "/incidents", req.url));
  }
  if (isPublic) return NextResponse.next();

  if (!user) {
    if (isApi) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    return NextResponse.redirect(new URL("/login", req.url));
  }
  if (user.role === "CUSTOMER" && !CUSTOMER_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    if (isApi) return NextResponse.json({ error: "Forbidden for your role" }, { status: 403 });
    return NextResponse.redirect(new URL("/ops", req.url));
  }

  if (ADMIN_ONLY_PAGES.some((p) => pathname === p || pathname.startsWith(p + "/")) && user.role !== "ADMIN") {
    return NextResponse.redirect(new URL("/incidents", req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
