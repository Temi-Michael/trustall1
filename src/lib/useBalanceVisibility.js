import { useEffect, useState } from 'react'

const STORAGE_KEY = 'trustall:hide-balances'
const CHANGE_EVENT = 'trustall:balance-visibility'

function readHidden() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

// Whether wallet balances are hidden on this device. The choice is remembered
// and kept in sync across every balance on the page and in other tabs.
export function useBalanceVisibility() {
  const [hidden, setHidden] = useState(readHidden)

  useEffect(() => {
    const sync = (event) => {
      if (event.type === 'storage' && event.key !== STORAGE_KEY) return
      setHidden(readHidden())
    }
    window.addEventListener('storage', sync)
    window.addEventListener(CHANGE_EVENT, sync)
    return () => {
      window.removeEventListener('storage', sync)
      window.removeEventListener(CHANGE_EVENT, sync)
    }
  }, [])

  function toggle() {
    const next = !hidden
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0')
    } catch {
      // Storage can be blocked (private mode); the toggle still works for this page.
    }
    setHidden(next)
    window.dispatchEvent(new Event(CHANGE_EVENT))
  }

  return { hidden, toggle }
}
