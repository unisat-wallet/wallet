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
        const pageToLoad = isRefresh ? 1 : pageRef.current
        const { list, total } = await fetcher(pageToLoad, pageSize)
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
      }
    },
    [fetcher, pageSize]
  )

  const onRefresh = () => loadData(true)
  const onLoadMore = () => {
    if (hasMore && !loadingRef.current) loadData(false)
  }

  useEffect(() => {
    // reset
    dataRef.current = []
    setData([])
    setPage(1)
    setHasMore(true)

    loadData(true)
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
