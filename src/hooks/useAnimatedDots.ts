import { useEffect, useState } from 'react'

/**
 * Cycles a "." suffix (1 to 3 dots, then repeats) every 400ms while `active`
 * is true — a lightweight "still working" indicator for a button whose
 * label would otherwise sit static during a multi-second operation (e.g.
 * saving an item that also pushes to Shopify).
 */
export function useAnimatedDots(active: boolean): string {
  const [count, setCount] = useState(1)

  useEffect(() => {
    if (!active) { setCount(1); return }
    const interval = setInterval(() => setCount(c => (c % 3) + 1), 400)
    return () => clearInterval(interval)
  }, [active])

  return '.'.repeat(active ? count : 0)
}
