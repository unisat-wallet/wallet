import { afterEach, describe, expect, it } from 'vitest'

import { sessionService } from '../src/services/session'

describe('session service', () => {
  afterEach(async () => {
    await sessionService.cleanup()
  })

  it('does not let an old port delete the replacement session for a reused tab', () => {
    const oldSession = sessionService.createSession(7, {
      origin: 'https://old.example',
      name: 'Old',
      icon: '',
    })
    const newSession = sessionService.createSession(7, {
      origin: 'https://new.example',
      name: 'New',
      icon: '',
    })

    sessionService.deleteSession(7, oldSession)

    expect(sessionService.getSession(7)).toBe(newSession)
  })
})
