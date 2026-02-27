export type NotificationListItem = {
  id: string
  title: string
  content: string
  type: string
  link?: string
  priority: number
  publishTime: number
}

export interface StoredNotification extends NotificationListItem {
  readAt?: number // timestamp when marked as read; undefined means unread
}
