import { useCallback, useEffect, useRef, useState } from 'react'

import { BUS_METHODS } from '@unisat/wallet-shared'

import { uiEventBus } from '../utils/eventBus'

export type RgbAcceptProgressPhase =
  | 'preparing'
  | 'checking'
  | 'validating'
  | 'persisting'
  | 'acknowledging'
  | 'broadcasting'
  | 'finalizing'
  | 'complete'

export interface RgbAcceptUiProgress {
  progressId: string
  phase: RgbAcceptProgressPhase
  recipientId?: string
  completed: number
  total: number
  elapsedSeconds: number
}

interface RgbAcceptProgressEvent {
  progressId?: string
  phase?: RgbAcceptProgressPhase
  recipientId?: string
  completed?: number
  total?: number
}

function createProgressId() {
  return `rgb-accept-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function useRgbAcceptProgress() {
  const activeIdRef = useRef<string>()
  const startedAtRef = useRef(0)
  const [progress, setProgress] = useState<RgbAcceptUiProgress>()

  useEffect(() => {
    const handleProgress = (event?: RgbAcceptProgressEvent) => {
      if (!event?.progressId || event.progressId !== activeIdRef.current || !event.phase) return
      setProgress(current => ({
        progressId: event.progressId!,
        phase: event.phase!,
        ...(event.recipientId ? { recipientId: event.recipientId } : {}),
        completed: event.completed ?? current?.completed ?? 0,
        total: Math.max(1, event.total ?? current?.total ?? 1),
        elapsedSeconds: Math.max(0, Math.floor((Date.now() - startedAtRef.current) / 1000)),
      }))
    }
    uiEventBus.addEventListener(BUS_METHODS.RGB_ACCEPT_PROGRESS, handleProgress)
    return () => uiEventBus.removeEventListener(BUS_METHODS.RGB_ACCEPT_PROGRESS, handleProgress)
  }, [])

  useEffect(() => {
    if (!progress || progress.phase === 'complete') return undefined
    const intervalId = setInterval(() => {
      setProgress(current =>
        current
          ? {
              ...current,
              elapsedSeconds: Math.max(
                0,
                Math.floor((Date.now() - startedAtRef.current) / 1000)
              ),
            }
          : current
      )
    }, 1000)
    return () => clearInterval(intervalId)
  }, [progress?.progressId, progress?.phase])

  const start = useCallback((total = 1) => {
    const progressId = createProgressId()
    activeIdRef.current = progressId
    startedAtRef.current = Date.now()
    setProgress({
      progressId,
      phase: 'preparing',
      completed: 0,
      total: Math.max(1, total),
      elapsedSeconds: 0,
    })
    return progressId
  }, [])

  const stop = useCallback(() => {
    activeIdRef.current = undefined
    setProgress(undefined)
  }, [])

  return { progress, start, stop }
}
