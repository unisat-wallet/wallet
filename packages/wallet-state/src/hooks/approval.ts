import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { useWallet } from '../context/WalletContext'

const UI_TYPE = {
  Tab: 'index',
  Pop: 'popup',
  Notification: 'notification',
  SidePanel: 'sidepanel',
}

type UiTypeCheck = {
  isTab: boolean
  isNotification: boolean
  isPop: boolean
  isSidePanel: boolean
}

export const getUiType = (): UiTypeCheck => {
  // @ts-ignore
  const { pathname } = window.location
  return Object.entries(UI_TYPE).reduce((m, [key, value]) => {
    // @ts-ignore
    m[`is${key}`] = pathname === `/${value}.html`

    return m
  }, {} as UiTypeCheck)
}

export const useApproval = () => {
  const wallet = useWallet()
  const navigate = useNavigate()
  const getApproval = wallet.getApproval

  const resolveApproval = async (data?: any, stay = false, forceReject = false) => {
    const approval = await getApproval()

    if (approval) {
      wallet.resolveApproval(data, forceReject)
    }
    if (stay) {
      return
    }
    setTimeout(() => {
      navigate('/')
    })
  }

  const rejectApproval = async (err?: any, stay = false, isInternal = false) => {
    const approval = await getApproval()
    if (approval) {
      await wallet.rejectApproval(err, stay, isInternal)
    }
    if (!stay) {
      navigate('/')
    }
  }

  useEffect(() => {
    if (!getUiType().isNotification) {
      return () => {}
    }
    // @ts-ignore
    window.addEventListener('beforeunload', rejectApproval)

    // @ts-ignore
    return () => window.removeEventListener('beforeunload', rejectApproval)
  }, [])

  return [getApproval, resolveApproval, rejectApproval] as const
}
