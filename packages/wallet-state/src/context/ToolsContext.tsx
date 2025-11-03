/* eslint-disable indent */
import React, { useCallback, useContext, useRef, useState } from 'react'

type ToastFunction = (content: string) => void
type LoadingFunction = (visible: boolean, content?: string) => void

export interface ToolsContextType {
  toast: ToastFunction
  toastSuccess: ToastFunction
  toastError: ToastFunction
  toastWarning: ToastFunction
  showLoading: LoadingFunction
  showTip: ToastFunction
  copyToClipboard: (text: string) => void
  openUrl: (url: string) => void
}

const initContext = {
  toast: (content: string) => {
    // todo
  },
  toastSuccess: (content: string) => {
    // todo
  },
  toastError: (content: string) => {
    // todo
  },
  toastWarning: (content: string) => {
    // todo
  },
  showLoading: () => {
    // todo
  },
  showTip: (content: string) => {
    // todo
  },
  copyToClipboard: (text: string) => {
    // todo
  },
  openUrl(url: string) {
    // todo
  },
}

export const ToolsContext = React.createContext<ToolsContextType>(initContext)

export function useTools() {
  const ctx = useContext(ToolsContext)
  return ctx
}
