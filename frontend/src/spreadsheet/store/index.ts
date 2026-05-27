export { store, setWorksheet } from './workSheetStore'

import { store } from './workSheetStore'

export type RootState = ReturnType<typeof store.getState>
