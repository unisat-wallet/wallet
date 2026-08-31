import { useCallback, useEffect, useRef, useState } from 'react'

interface UseInfiniteListOptions<T> {
  fetcher: (page: number, pageSize: number) => Promise<{ list: T[]; total: number }>
  pageSize?: number
  dependencies?: any[]
}

export function useInfiniteList<T>({
  fetcher,
  pageSize = 20,
  dependencies = [],
}: UseInfiniteListOptions<T>) {
  const [data, setData] = useState<T[]>([])
  const [total, setTotal] = useState(0)
  const [loading, _setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [page, _setPage] = useState(1)

  const pageRef = useRef(1)
  const loadingRef = useRef(false)
  const dataRef = useRef<T[]>([])
  const refreshQueuedRef = useRef(false)
  const fetcherRef = useRef(fetcher)
  const pageSizeRef = useRef(pageSize)
  const requestVersionRef = useRef(0)

  fetcherRef.current = fetcher
  pageSizeRef.current = pageSize

  const setLoading = (v: boolean) => {
    loadingRef.current = v
    _setLoading(v)
  }

  const setPage = (v: number) => {
    pageRef.current = v
    _setPage(v)
  }

  const loadData = useCallback(
    async (isRefresh = false) => {
      if (loadingRef.current) return

      loadingRef.current = true
      setLoading(true)
      try {
        const requestVersion = requestVersionRef.current
        const pageToLoad = isRefresh ? 1 : pageRef.current
        const { list, total } = await fetcherRef.current(pageToLoad, pageSizeRef.current)

        // Dependencies may have changed while this request was pending. Do not
        // let results from the previous account/chain replace the reset list.
        if (requestVersion !== requestVersionRef.current) return

        const nextData = isRefresh ? list : [...dataRef.current, ...list]

        setTotal(total)
        dataRef.current = nextData
        setData(nextData)

        setHasMore(nextData.length < total)

        const nextPage = isRefresh ? 2 : pageToLoad + 1
        pageRef.current = nextPage
        setPage(nextPage)
      } catch (e) {
        console.error(e)
      } finally {
        loadingRef.current = false
        setLoading(false)
        if (refreshQueuedRef.current) {
          refreshQueuedRef.current = false
          void loadData(true)
        }
      }
    },
    []
  )

  const onRefresh = () => {
    if (loadingRef.current) {
      refreshQueuedRef.current = true
      return
    }
    void loadData(true)
  }
  const onLoadMore = () => {
    if (hasMore && !loadingRef.current) loadData(false)
  }

  useEffect(() => {
    // Invalidate any result fetched with the previous dependency context.
    requestVersionRef.current += 1

    // reset
    dataRef.current = []
    setData([])
    setPage(1)
    setHasMore(true)

    if (loadingRef.current) {
      // The current request will start this refresh once it settles. `loadData`
      // reads the latest fetcher from its ref, so it uses the new context.
      refreshQueuedRef.current = true
    } else {
      void loadData(true)
    }
  }, dependencies)

  return {
    data,
    total,
    loading,
    hasMore,
    page,
    onRefresh,
    onLoadMore,
  }
}
