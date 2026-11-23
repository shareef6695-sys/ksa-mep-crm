// The ERP store is shared with feature screens through this context (Prompt 15).
import { createContext, useContext } from 'react';

export const ErpContext = createContext(null);

export function useErp() {
  const v = useContext(ErpContext);
  if (!v) throw new Error('useErp() must be used inside <ErpContext.Provider>.');
  return v;
}
