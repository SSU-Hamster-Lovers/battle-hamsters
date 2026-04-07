import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Battle Hamsters',
  description: '귀여운 햄스터들의 2D 아레나 PvP 게임',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  )
}
