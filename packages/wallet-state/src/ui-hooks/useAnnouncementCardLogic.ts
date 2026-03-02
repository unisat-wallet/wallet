import { Announcement, AnnouncementLinkType } from '@unisat/wallet-shared'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useStorage, useWallet } from 'src/context'

const AUTO_PLAY_INTERVAL = 5000

export function useAnnouncementCardLogic() {
  const wallet = useWallet()
  const storage = useStorage()

  const [activeIndex, setActiveIndex] = useState(0)
  const [dismissedIds, setDismissedIds] = useState<string[]>([])
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [loading, setLoading] = useState(false)
  const [dismissedLoaded, setDismissedLoaded] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    const init = async () => {
      try {
        await loadDismissedIds()
        await fetchAnnouncements()
      } finally {
        setDismissedLoaded(true)
      }
    }
    init()
  }, [])

  const fetchAnnouncements = async () => {
    try {
      const response = await wallet.getAnnouncements(0, 10)
      setAnnouncements(Array.isArray(response?.list) ? response.list : [])
    } catch {
      setAnnouncements([])
    }
  }

  const loadDismissedIds = async () => {
    const saved = await storage.getAnnouncementDismissedIds()
    setDismissedIds(saved)
  }

  const validAnnouncements = announcements.filter(a => {
    const now = Date.now()
    return now >= a.startTime && now <= a.endTime && !dismissedIds.includes(a.id)
  })

  // Auto-play carousel
  useEffect(() => {
    if (validAnnouncements.length <= 1) return undefined
    timerRef.current = setInterval(() => {
      setActiveIndex(prev => (prev + 1) % validAnnouncements.length)
    }, AUTO_PLAY_INTERVAL)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [validAnnouncements.length])

  const handleDotClick = useCallback((index: number) => {
    setActiveIndex(index)
  }, [])

  const handleDismissAll = useCallback(async () => {
    const ids = validAnnouncements.map(a => a.id)
    if (ids.length === 0) return
    const newIds = [...dismissedIds, ...ids]
    setDismissedIds(newIds)
    await storage.setAnnouncementDismissedIds(newIds)
  }, [validAnnouncements, dismissedIds, storage])

  const isLinkable = useCallback((announcement: Announcement) => {
    return announcement.linkType !== AnnouncementLinkType.NONE && !!announcement.link
  }, [])

  const current = validAnnouncements[activeIndex] ?? validAnnouncements[0]

  return {
    loading,
    validAnnouncements,
    current,
    activeIndex,
    handleDotClick,
    handleDismissAll,
    isLinkable,
  }
}
