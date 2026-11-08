import { createContext, useContext, useMemo } from 'react'
import { ProfileContext, SessionContext, useAuthStateSource } from './useProfile.js'

const RoleContext = createContext(null)

// Owns the app's only auth subscription and profile load (useAuthStateSource)
// and shares them: useSession() and useProfile() read the two inner contexts,
// useRole() reads the role derived here.
export function RoleProvider({ children }) {
  const { sessionValue, profileValue } = useAuthStateSource()
  const { session, profile, loading, error } = profileValue

  const roleData = useMemo(() => {
    if (!session) {
      return {
        role: 'guest',
        isBuyer: false,
        isSeller: false,
        loading: false,
        session,
        profile,
        error,
      }
    }

    const sellerSignals = Boolean(
      profile && (
        profile.verified_seller === true ||
        profile.seller_level === 1 ||
        profile.seller_level === 2 ||
        profile.seller_level === 3 ||
        profile.status === 'seller'
      )
    )

    const nextRole = sellerSignals ? 'seller' : 'buyer'

    return {
      role: nextRole,
      isBuyer: nextRole === 'buyer',
      isSeller: nextRole === 'seller',
      loading,
      session,
      profile,
      error,
    }
  }, [loading, session, profile, error])

  return (
    <SessionContext.Provider value={sessionValue}>
      <ProfileContext.Provider value={profileValue}>
        <RoleContext.Provider value={roleData}>
          {children}
        </RoleContext.Provider>
      </ProfileContext.Provider>
    </SessionContext.Provider>
  )
}

export function useRole() {
  return useContext(RoleContext) || {
    role: 'guest',
    isBuyer: false,
    isSeller: false,
    loading: true,
    session: null,
    profile: null,
    error: null,
  }
}
