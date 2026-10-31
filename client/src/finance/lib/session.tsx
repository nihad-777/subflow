import { createContext, useContext } from 'react';

/** Set by FinancePage from the app's auth state. The server still enforces every rule. */
export const FinanceRoleContext = createContext<{ isAdmin: boolean }>({ isAdmin: false });
export const useIsAdmin = () => useContext(FinanceRoleContext).isAdmin;
