import { createSlice, PayloadAction, Slice, SliceCaseReducers } from '@reduxjs/toolkit'

import { updateVersion } from '../actions/global'

export type TabOption = 'home' | 'discover' | 'settings'

export interface GlobalState {
  tab: TabOption
  isUnlocked: boolean
  isReady: boolean
  isBooted: boolean
}

export const initialState: GlobalState = {
  tab: 'home',
  isUnlocked: false,
  isReady: false,
  isBooted: false,
}

const reducers: SliceCaseReducers<GlobalState> = {
  reset: state => initialState,
  update: (
    state,
    action: PayloadAction<{
      tab?: TabOption
      isUnlocked?: boolean
      isReady?: boolean
      isBooted?: boolean
    }>
  ) => {
    const { payload } = action
    state = Object.assign({}, state, payload)
    return state
  },
}

const slice = createSlice({
  name: 'global',
  initialState,
  reducers,
  extraReducers: builder => {
    builder.addCase(updateVersion, state => {
      // todo
    })
  },
})

export const globalActions = slice.actions as any

export default slice.reducer
