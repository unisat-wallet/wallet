import log from 'loglevel'
import React, { createContext, useContext, useEffect, useState } from 'react'

import { FALLBACK_LOCALE } from '@unisat/i18n'

export interface I18nContextType {
  t: (key: string, substitutions?: string | string[]) => string
  locale: string
  supportedLocales: string[]
  localeNames: Record<string, string>
  changeLocale: (locale: string) => Promise<void>
  addResourceBundle?: (locale: string) => Promise<void>
}

// Create context
export const I18nContext = createContext<I18nContextType>({
  t: key => key,
  locale: FALLBACK_LOCALE,
  supportedLocales: [],
  localeNames: {},
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  changeLocale: async () => {},
  addResourceBundle: async () => {},
})

export function useI18n() {
  const context = useContext(I18nContext)
  if (!context) {
    throw Error('Feature flag hooks can only be used by children of BridgeProvider.')
  } else {
    return context
  }
}
