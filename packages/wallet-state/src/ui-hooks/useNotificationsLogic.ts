import { StoredNotification } from '@unisat/wallet-shared'
import { useCallback, useEffect, useState } from 'react'
import { useI18n, useTools, useWallet } from 'src/context'

export function useUnreadNotificationsCount() {
  const wallet = useWallet()
  const [unreadCount, setUnreadCount] = useState(0)

  useEffect(() => {
    const updateUnreadCount = async () => {
      const count = await wallet.getNotificationUnreadCount()
      setUnreadCount(count)
    }

    updateUnreadCount()

    // Poll every 30 seconds for new notifications
    const interval = setInterval(updateUnreadCount, 30000)
    return () => clearInterval(interval)
  }, [wallet])

  return unreadCount
}

export function useNotificationsLogic() {
  const wallet = useWallet()
  const [notifications, setNotifications] = useState<StoredNotification[]>([])
  const [loading, setLoading] = useState(true)

  const fetchNotifications = useCallback(async () => {
    try {
      setLoading(true)
      const data = await wallet.getNotifications()
      setNotifications(data)
    } catch (error) {
      console.error('Failed to fetch notifications:', error)
      setNotifications([])
    } finally {
      setLoading(false)
    }
  }, [wallet])

  useEffect(() => {
    fetchNotifications()
  }, [fetchNotifications])

  const handleReadNotification = useCallback(
    async (id: string) => {
      await wallet.readNotification(id)
      // Update local state
      setNotifications(prev => prev.map(n => (n.id === id ? { ...n, readAt: Date.now() } : n)))
    },
    [wallet]
  )

  const tools = useTools()
  const { t } = useI18n()
  const handleReadAll = useCallback(async () => {
    await wallet.readAllNotifications()
    // Update local state
    const now = Date.now()
    setNotifications(prev => prev.map(n => ({ ...n, readAt: now })))
    tools.toastSuccess(t('all_marked_as_read'))
  }, [wallet])

  const handleDeleteNotification = useCallback(
    async (id: string) => {
      await wallet.deleteNotification(id)
      // Update local state
      setNotifications(prev => prev.filter(n => n.id !== id))
    },
    [wallet]
  )

  const unreadCount = notifications.filter(n => n.readAt === undefined).length

  return {
    notifications,
    loading,
    unreadCount,
    handleReadNotification,
    handleReadAll,
    handleDeleteNotification,
    fetchNotifications,
  }
}
