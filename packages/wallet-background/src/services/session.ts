import permissionService from './permission'

export interface SessionData {
  origin: string;
  icon: string;
  name: string;
}

export class Session {
  origin = ''
  icon = ''
  name = ''

  constructor(data?: SessionData) {
    if (data) {
      this.setProp(data)
    }
  }

  setProp({ origin, icon, name }: SessionData) {
    this.origin = origin
    this.icon = icon
    this.name = name
  }
}

// for each tab
const sessionMap = new Map<string | number, Session>()

const getSession = (id: string | number): Session | undefined => {
  return sessionMap.get(id)
}

const getOrCreateSession = (id: string | number): Session => {
  if (sessionMap.has(id)) {
    return getSession(id)!
  }

  return createSession(id, undefined)
}

const createSession = (id: string | number, data?: SessionData): Session => {
  const session = new Session(data)
  sessionMap.set(id, session)

  return session
}

const deleteSession = (id: string | number): void => {
  sessionMap.delete(id)
}

const broadcastEvent = (ev: string, data?: any, origin?: string): void => {
  let sessions: any[] = []
  sessionMap.forEach((session, key) => {
    if (permissionService.hasPermission(session.origin)) {
      sessions.push({
        key,
        ...session,
      })
    }
  })

  // same origin
  if (origin) {
    sessions = sessions.filter(session => session.origin === origin)
  }

  sessions.forEach(session => {
    try {
      session.pushMessage?.(ev, data)
    } catch (e) {
      if (sessionMap.has(session.key)) {
        deleteSession(session.key)
      }
    }
  })
}

class SessionService {
  getSession = getSession;
  getOrCreateSession = getOrCreateSession;
  deleteSession = deleteSession;
  broadcastEvent = broadcastEvent;

  async init(): Promise<void> {
    console.log('[SessionService] Initialized');
  }

  async cleanup(): Promise<void> {
    sessionMap.clear();
  }
}

export const sessionService = new SessionService();

export default {
  getSession,
  getOrCreateSession,
  deleteSession,
  broadcastEvent,
}
