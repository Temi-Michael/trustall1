import { Routes, Route, useLocation } from 'react-router-dom'
import { Suspense, lazy, useEffect } from 'react'
import { Analytics } from '@vercel/analytics/react'
import { SpeedInsights } from '@vercel/speed-insights/react'
import Navbar, { MobileBottomNav } from './components/Navbar.jsx'
import Footer from './components/Footer.jsx'
import { ProfileSetupBanner } from './components/ProfileSetupBanner.jsx'
import TrustallChat from './components/TrustallChat.jsx'
import { ErrorBoundary, NotFound } from './components/ErrorBoundary.jsx'
import { RoleProvider } from './lib/RoleContext.jsx'
import { useProfile } from './lib/useProfile.js'
import { messaging, onMessage } from './lib/firebaseConfig.js'
import { registerPushToken, unregisterPushToken } from './lib/useRegisterPush.js'
import { startPresenceTracking, stopPresenceTracking } from './lib/presenceUtils.js'
import { LAST_USER_ID_STORAGE_KEY } from './lib/signOut.js'
import { showAppNotification } from './lib/notifications.js'
import { safeRedirectPath } from './lib/authFlow.js'
import { NotificationPrompt } from './components/NotificationPrompt.jsx'

// The path of a push's full address, kept to this site ("/" otherwise).
function sitePathFromUrl(value) {
  // new URL(undefined, origin) would be the page "/undefined".
  if (typeof value !== 'string' || !value) return '/'
  try {
    const url = new URL(value, window.location.origin)
    return safeRedirectPath(`${url.pathname}${url.search}${url.hash}`)
  } catch {
    return '/'
  }
}

const Home = lazy(() => import('./pages/Home.jsx'))
const Admin = lazy(() => import('./pages/Admin.jsx'))
const Terms = lazy(() => import('./pages/Terms.jsx'))
const Privacy = lazy(() => import('./pages/Privacy.jsx'))
const Support = lazy(() => import('./pages/Support.jsx'))
const Auth = lazy(() => import('./pages/Auth.jsx'))
const ForgotPassword = lazy(() => import('./pages/ForgotPassword.jsx'))
const ResetPassword = lazy(() => import('./pages/ResetPassword.jsx'))
const Sell = lazy(() => import('./pages/Sell.jsx'))
const Browse = lazy(() => import('./pages/Browse.jsx'))
const Listing = lazy(() => import('./pages/Listing.jsx'))
const SellerProfile = lazy(() => import('./pages/SellerProfile.jsx'))
const Sellers = lazy(() => import('./pages/Sellers.jsx'))
const BuyerProfile = lazy(() => import('./pages/SellerProfile.jsx').then((module) => ({ default: module.BuyerProfile })))
const Messages = lazy(() => import('./pages/Messages.jsx'))
const Marketing = lazy(() => import('./pages/Marketing.jsx'))
const Refer = lazy(() => import('./pages/Refer.jsx'))
const Account = lazy(() => import('./pages/Account.jsx'))
const AccountSecurity = lazy(() => import('./pages/AccountSecurity.jsx'))
const AccountVerification = lazy(() => import('./pages/AccountVerification.jsx'))
const HowItWorks = lazy(() => import('./pages/HowItWorks.jsx'))
const SavedListings = lazy(() => import('./pages/SavedListings.jsx'))
const Orders = lazy(() => import('./pages/Orders.jsx').then((module) => ({ default: module.default })))
const OrderDetails = lazy(() => import('./pages/Orders.jsx').then((module) => ({ default: module.OrderDetails })))
const About = lazy(() => import('./pages/About.jsx'))
const BlogList = lazy(() => import('./pages/Blog.jsx').then((module) => ({ default: module.BlogList })))
const BlogPost = lazy(() => import('./pages/Blog.jsx').then((module) => ({ default: module.BlogPost })))
const TrustSafety = lazy(() => import('./pages/TrustSafety.jsx'))
const DisputePage = lazy(() => import('./pages/Dispute.jsx').then((module) => ({ default: module.default })))
const MyDisputes = lazy(() => import('./pages/Dispute.jsx').then((module) => ({ default: module.MyDisputes })))

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

function GlobalSetup() {
  const { session, loading } = useProfile()

  // Setup when user logs in
  useEffect(() => {
    if (!session?.user?.id) return

    // Set up presence tracking
    const unsubscribePresence = startPresenceTracking(session.user.id)

    // Registers this device for pushes if permission was already given. Asking
    // is left to NotificationPrompt, from a tap, as iPhones require.
    registerPushToken(session.user.id)

    // A push while the app is open comes here instead of the service worker.
    // The bell's live update shows the same notification with the same tag,
    // so at most one pop-up appears, and none while the app is in view.
    const unsubscribeMessages = messaging ? onMessage(messaging, (payload) => {
      const data = payload.data || {}
      const inAppOnly = data.inAppOnly === 'true'
      showAppNotification({
        title: data.title || payload.notification?.title,
        body: data.body || payload.notification?.body,
        notificationId: data.notificationId,
        path: inAppOnly ? null : sitePathFromUrl(data.actionUrl),
      })
    }) : () => {}

    return () => {
      if (unsubscribePresence) unsubscribePresence()
      unsubscribeMessages()
      stopPresenceTracking()
    }
  }, [session?.user?.id])

  // Fallback cleanup for sessions that ended without signOutThisDevice
  // (expiry, another tab, "sign out of other devices" on another device).
  // signOutThisDevice does the full cleanup itself and clears the key first.
  useEffect(() => {
    if (loading) return // Auth check is still in progress; do not treat this as logout.
    if (session?.user?.id) return // User is logged in, don't cleanup

    if (localStorage.getItem(LAST_USER_ID_STORAGE_KEY)) {
      unregisterPushToken()
      localStorage.removeItem(LAST_USER_ID_STORAGE_KEY)
    }
  }, [session, loading])

  // Remember who is signed in so the fallback above knows a session ended.
  useEffect(() => {
    if (session?.user?.id) {
      localStorage.setItem(LAST_USER_ID_STORAGE_KEY, session.user.id)
    }
  }, [session?.user?.id])

  return null
}

function HomeEntry() {
  return <Home />
}

export default function App() {
  const { pathname } = useLocation()
  const isAdminRoute = pathname.startsWith('/admin')
  const isMessagesRoute = pathname.startsWith('/messages')

  return (
    <RoleProvider>
      <ErrorBoundary>
        <GlobalSetup />
        <div className="app-shell flex min-h-screen flex-col bg-surface">
          {!isAdminRoute && <Navbar />}
          {!isAdminRoute && <ProfileSetupBanner />}
          {!isAdminRoute && <NotificationPrompt />}
          <main className={isAdminRoute ? 'flex-1' : 'flex-1 pb-24 md:pb-0'}>
            <ScrollToTop />
            <Suspense fallback={<div className="flex min-h-[40vh] items-center justify-center text-sm text-muted">Loading…</div>}>
              <Routes>
                <Route path="/" element={<HomeEntry />} />
                <Route path="/admin" element={<Admin />} />
                <Route path="/terms" element={<Terms />} />
                <Route path="/privacy" element={<Privacy />} />
                <Route path="/support" element={<Support />} />
                <Route path="/auth" element={<Auth />} />
                <Route path="/forgot-password" element={<ForgotPassword />} />
                <Route path="/reset-password" element={<ResetPassword />} />
                <Route path="/sell" element={<Sell />} />
                <Route path="/browse" element={<Browse />} />
                <Route path="/listing/:slug" element={<Listing />} />
                <Route path="/seller/:handle" element={<SellerProfile />} />
                <Route path="/sellers" element={<Sellers />} />
                <Route path="/buyer/:handle" element={<BuyerProfile />} />
                <Route path="/messages" element={<Messages />} />
                <Route path="/messages/:conversationId" element={<Messages />} />
                <Route path="/marketing" element={<Marketing />} />
                <Route path="/refer" element={<Refer />} />
                <Route path="/account" element={<Account />} />
                <Route path="/account/security" element={<AccountSecurity />} />
                <Route path="/account/verification" element={<AccountVerification />} />
                <Route path="/how-it-works" element={<HowItWorks />} />
                <Route path="/saved" element={<SavedListings />} />
                <Route path="/orders" element={<Orders />} />
                <Route path="/orders/:orderId" element={<OrderDetails />} />
                <Route path="/disputes/:disputeId" element={<DisputePage />} />
                <Route path="/disputes" element={<MyDisputes />} />
                <Route path="/trust-safety" element={<TrustSafety />} />
                <Route path="/about" element={<About />} />
                <Route path="/blog" element={<BlogList />} />
                <Route path="/blog/:slug" element={<BlogPost />} />
                <Route path="*" element={<NotFound message="The page you requested does not exist." />} />
              </Routes>
            </Suspense>
          </main>
          {!isAdminRoute && <MobileBottomNav />}
          {!isAdminRoute && !isMessagesRoute && <Footer />}
          {!isAdminRoute && !isMessagesRoute && <TrustallChat />}
          <Analytics />
          <SpeedInsights />
        </div>
      </ErrorBoundary>
    </RoleProvider>
  )
}
