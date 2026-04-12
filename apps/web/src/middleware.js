import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/constants";
const publicPaths = ["/login", "/signup", "/verify", "/invite"];
function isPublicPath(pathname) {
    return publicPaths.some((p) => pathname === p || pathname.startsWith(p + "/"));
}
export function middleware(request) {
    const { pathname } = request.nextUrl;
    const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    // Root path: redirect based on auth state
    if (pathname === "/") {
        if (sessionCookie) {
            return NextResponse.redirect(new URL("/dashboard", request.url));
        }
        return NextResponse.redirect(new URL("/login", request.url));
    }
    // Protected routes: redirect to login if no session
    if (pathname.startsWith("/dashboard")) {
        if (!sessionCookie) {
            const loginUrl = new URL("/login", request.url);
            loginUrl.searchParams.set("redirect", pathname);
            return NextResponse.redirect(loginUrl);
        }
        return NextResponse.next();
    }
    // Auth pages: redirect to dashboard if already logged in
    if (pathname === "/login" || pathname === "/signup") {
        if (sessionCookie) {
            return NextResponse.redirect(new URL("/dashboard", request.url));
        }
        return NextResponse.next();
    }
    return NextResponse.next();
}
export const config = {
    matcher: [
        /*
         * Match all request paths except:
         * - _next/static (static files)
         * - _next/image (image optimization)
         * - favicon.ico, sitemap.xml, robots.txt
         * - API routes
         */
        "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|api).*)",
    ],
};
//# sourceMappingURL=middleware.js.map