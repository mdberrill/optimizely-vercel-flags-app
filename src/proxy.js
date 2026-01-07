import { NextResponse } from "next/server";

const COOKIE_NAME = "sessionToken";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export function proxy(request) {
  try {
    const existing = request.cookies.get(COOKIE_NAME);
    if (existing && existing.value) {
      // Session already exists; continue
      return NextResponse.next();
    }

    const id = crypto.randomUUID();
    const res = NextResponse.next();

    // Use secure cookies in production
    const secure = process.env.NODE_ENV === "production";

    res.cookies.set({
      name: COOKIE_NAME,
      value: id,
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure,
      maxAge: COOKIE_MAX_AGE,
    });

    return res;
  } catch (err) {
    // Fail open: if anything goes wrong, allow request to proceed
    return NextResponse.next();
  }
}

// Apply to all routes
export const config = { matcher: "/:path*" };
