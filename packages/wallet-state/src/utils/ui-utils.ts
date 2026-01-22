import { useEffect } from 'react'

export function shortAddress(address?: string, len = 8) {
  if (!address) return ''
  if (address.length <= len * 2) return address
  return address.slice(0, len) + '...' + address.slice(address.length - len)
}

export function useAsyncEffect(
  effect: () => Promise<void | (() => void)>,
  deps: React.DependencyList = []
) {
  useEffect(() => {
    let isMounted = true
    let cleanup: void | (() => void)
    ;(async () => {
      cleanup = await effect()
    })()

    return () => {
      isMounted = false
      if (cleanup) {
        cleanup()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
