import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Site Scorecard — Domain Realty',
  description: 'Brent Pleeter — internal commercial property analysis tool',
  robots: { index: false, follow: false }, // not meant to be discoverable
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
