import { NextRequest, NextResponse } from 'next/server'

/**
 * This tool isn't meant to be public — it's a single-user internal tool for
 * Brent Pleeter (Domain Realty). HTTP Basic Auth is the simplest thing that works for that: the
 * browser prompts once, remembers it, and there's no login page, session
 * table, or cookie logic to maintain. If this ever needs to be opened up
 * to visitors/leads, swap this out (Clerk, or the email-gate flow) rather
 * than trying to extend Basic Auth.
 */
export function middleware(request: NextRequest) {
  const authHeader = request.headers.get('authorization')

  const expectedUser = process.env.SITE_USERNAME
  const expectedPass = process.env.SITE_PASSWORD

  if (!expectedUser || !expectedPass) {
    // Fail closed — misconfiguration should never mean "wide open."
    return new NextResponse('Site auth is not configured.', { status: 500 })
  }

  if (authHeader?.startsWith('Basic ')) {
    const decoded = Buffer.from(authHeader.split(' ')[1], 'base64').toString()
    const [user, pass] = decoded.split(':')
    if (user === expectedUser && pass === expectedPass) {
      return NextResponse.next()
    }
  }

  return new NextResponse('Authentication required.', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Domain Realty Site Scorecard"' },
  })
}

export const config = {
  matcher: '/((?!_next/static|_next/image|favicon.ico).*)',
}
