import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useParams, useNavigate, Link, useSearchParams, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient.js'
import { useProfile } from '../lib/useProfile.js'
import { getProfileInitials } from '../lib/profileDisplay.js'
import { fetchPayoutConnected } from '../lib/profileFields.js'
import { markConversationRead, subscribeToMessageReadUpdates } from '../lib/readReceiptUtils.js'
import { SealMark } from '../components/Navbar.jsx'
import { isOnline, formatLastSeen, subscribeToUserPresence } from '../lib/presenceUtils.js'
import { markConversationNotificationsRead } from '../lib/notificationUtils.js'
import { closeChatNotifications } from '../lib/notifications.js'
import { getSupportEmail } from '../lib/authRedirect.js'
import { usePaymentReadiness } from '../lib/usePaymentReadiness.js'
import { holdInactivity } from '../lib/deviceSession.js'
import { describePaymentRequirement, isPaymentVerificationError, verificationPageLink } from '../lib/paymentReadiness.js'
import { MAX_FILES_PER_MESSAGE, SEND_FAILED_MESSAGE, createCheckedFiles, createSignedUrlCache, isColumnPermissionError, newMessageId, sendMessageWithFiles } from '../lib/chatMedia.js'
import { hasTouchKeyboard, messageStatus, shouldSendOnEnter } from '../lib/chatUtils.js'
import { formatConversationTime, formatFullTimestamp, formatMessageTime, groupByDay } from '../lib/messageTime.js'
import { Check, CheckCheck, CircleAlert, Clock, Paperclip, Send } from 'lucide-react'

// The message box grows to about five lines (20px each, plus padding), then scrolls.
const COMPOSER_MAX_HEIGHT_PX = 128
// Links to chat photos work for an hour.
const SIGNED_URL_SECONDS = 60 * 60
// Changes that arrive together (a message, its photos, a read receipt) are
// shown with one refresh instead of one each.
const RELOAD_DELAY_MS = 150
const OFFLINE_NOTICE = 'You are offline. It will be sent when you reconnect.'

export default function Messages() {
  const { conversationId } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { session, profile, loading } = useProfile()
  const [isMobileView, setIsMobileView] = useState(() => (
    typeof window !== 'undefined' && window.innerWidth < 768
  ))
  const [mobileViewport, setMobileViewport] = useState({ height: 0, top: 0, keyboardOpen: false })

  // Detect mobile view on mount and on window resize
  useEffect(() => {
    const checkMobileView = () => {
      setIsMobileView(window.innerWidth < 768) // md breakpoint
    }

    checkMobileView()
    window.addEventListener('resize', checkMobileView)
    return () => window.removeEventListener('resize', checkMobileView)
  }, [])

  useEffect(() => {
    if (!isMobileView || !conversationId) {
      setMobileViewport({ height: 0, top: 0, keyboardOpen: false })
      return
    }

    const updateKeyboardOffset = () => {
      const viewport = window.visualViewport
      if (!viewport) {
        setMobileViewport((current) => ({ ...current, height: window.innerHeight, top: 0 }))
        return
      }

      const keyboardInset = window.innerHeight - viewport.height - viewport.offsetTop
      setMobileViewport((current) => ({
        height: viewport.height,
        top: viewport.offsetTop,
        keyboardOpen: current.inputFocused || keyboardInset > 100,
        inputFocused: current.inputFocused,
      }))
    }

    updateKeyboardOffset()
    window.addEventListener('resize', updateKeyboardOffset)
    window.visualViewport?.addEventListener('resize', updateKeyboardOffset)
    window.visualViewport?.addEventListener('scroll', updateKeyboardOffset)

    return () => {
      window.removeEventListener('resize', updateKeyboardOffset)
      window.visualViewport?.removeEventListener('resize', updateKeyboardOffset)
      window.visualViewport?.removeEventListener('scroll', updateKeyboardOffset)
    }
  }, [isMobileView, conversationId])

  useEffect(() => {
    if (!loading && !session) navigate('/auth', { state: { redirectTo: '/messages' } })
  }, [loading, session, navigate])

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const previousHeight = document.body.style.height
    document.body.style.height = '100dvh'
    return () => {
      document.body.style.overflow = previousOverflow
      document.body.style.height = previousHeight
    }
  }, [])

  if (loading || !profile) return <div className="px-6 py-24 text-center text-muted">Loading…</div>

  const showChatFullscreen = Boolean(isMobileView && conversationId)

  return (
    <section className={showChatFullscreen
      ? "fixed inset-x-0 z-40 mx-auto flex min-h-0 w-full max-w-6xl flex-col overflow-hidden bg-white px-0 py-0"
      : "mx-auto flex h-[calc(100dvh-10rem)] min-h-0 w-full max-w-6xl flex-col overflow-hidden px-6 py-10 sm:h-[calc(100dvh-5rem)]"}
      style={showChatFullscreen ? {
        top: `${mobileViewport.top}px`,
        height: mobileViewport.height ? `${mobileViewport.height}px` : '100dvh',
      } : undefined}>
      {/* Desktop & Mobile Header */}
      {!showChatFullscreen && (
        <>
          <p className="font-mono text-xs uppercase tracking-widest text-seal">Messages</p>
          <h1 className="mt-2 font-display text-2xl font-bold text-ink">Your conversations</h1>
        </>
      )}

      <div className={showChatFullscreen ? "mobile-chat-fullscreen flex h-full min-h-0 flex-1 flex-col" : "mt-6 grid min-h-0 flex-1 gap-4 md:grid-cols-[280px_1fr]"} >
        {/* On mobile, show conversation list only if no conversation selected */}
        {!showChatFullscreen && (
          <ConversationList userId={session.user.id} activeId={conversationId} />
        )}

        {/* Show thread/chat */}
        {conversationId ? (
          <Thread 
            conversationId={conversationId} 
            userId={session.user.id} 
            userEmail={session.user.email}
            listingId={searchParams.get('listing')}
            isMobileFullscreen={showChatFullscreen}
            mobileViewport={mobileViewport}
            onComposerFocus={() => setMobileViewport((current) => ({ ...current, keyboardOpen: true, inputFocused: true }))}
            onComposerBlur={() => {
              setMobileViewport((current) => ({ ...current, inputFocused: false }))
              window.setTimeout(() => {
                const viewport = window.visualViewport
                if (!viewport) return
                const keyboardInset = window.innerHeight - viewport.height - viewport.offsetTop
                setMobileViewport((current) => ({ ...current, keyboardOpen: keyboardInset > 100 }))
              }, 180)
            }}
            onBackClick={() => navigate('/messages')}
          />
        ) : (
          <div className="hidden items-center justify-center rounded-2xl border border-hairline bg-white text-sm text-muted md:flex">
            Select a conversation to view messages
          </div>
        )}
      </div>
    </section>
  )
}

function ConversationList({ userId, activeId }) {
  const [conversations, setConversations] = useState([])

  useEffect(() => {
    load()
    const channel = supabase
      .channel('conversations-list')
      // Pop-ups for new messages come from the bell (each message also makes
      // a notification), so the list only refreshes here.
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => load())
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [userId])

  async function load() {
    const { data: conversationRows } = await supabase
      .from('conversations')
      .select(`
        id, listing_id, created_at,
        buyer:buyer_id(id, business_name, full_name, handle, avatar_url, verified_seller),
        seller:seller_id(id, business_name, full_name, handle, avatar_url, verified_seller),
        listing:listing_id(title)
      `)
      .or(`buyer_id.eq.${userId},seller_id.eq.${userId}`)
      .order('created_at', { ascending: false })

    const conversationsWithActivity = conversationRows || []
    if (conversationsWithActivity.length === 0) {
      setConversations([])
      return
    }

    const conversationIds = conversationsWithActivity.map((conversation) => conversation.id)
    const { data: recentMessages } = await supabase
      .from('messages')
      .select('id, conversation_id, sender_id, body, created_at')
      .in('conversation_id', conversationIds)
      .order('created_at', { ascending: false })

    const lastMessageByConversation = (recentMessages || []).reduce((accumulator, message) => {
      if (!accumulator[message.conversation_id]) {
        accumulator[message.conversation_id] = message
      }
      return accumulator
    }, {})

    const nextConversations = conversationsWithActivity
      .map((conversation) => ({
        ...conversation,
        last_message_at: lastMessageByConversation[conversation.id]?.created_at || conversation.created_at,
        last_message_preview: lastMessageByConversation[conversation.id]?.body || '',
      }))
      .sort((a, b) => new Date(b.last_message_at) - new Date(a.last_message_at))

    setConversations(nextConversations)
  }

  return (
    <div className="h-full min-h-0 overscroll-contain overflow-y-auto rounded-2xl border border-hairline bg-white p-2">
      {conversations.length === 0 && (
        <p className="p-4 text-sm text-muted">No conversations yet — message a seller from a listing to start one.</p>
      )}
      {conversations.map((c) => {
        const isSeller = c.seller.id === userId
        const other = isSeller ? c.buyer : c.seller
        const otherName = other.business_name || other.full_name || 'User'
        const userRole = isSeller ? 'Buyer' : 'Seller'
        const isSellerVerified = !isSeller && other.verified_seller // Show badge only for sellers in the conversation
        
        const lastMessagePreview = (c.last_message_preview || '').trim()

        return (
          <Link
            key={c.id}
            to={`/messages/${c.id}`}
            className={`flex items-center gap-3 rounded-xl px-3 py-3 transition ${
              activeId === c.id ? 'bg-surfacealt' : 'hover:bg-surfacealt/60'
            }`}
          >
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-inksoft font-display text-xs font-bold text-surface">
              {other.avatar_url ? (
                <img src={other.avatar_url} alt={otherName} className="h-full w-full object-cover" />
              ) : (
                getProfileInitials(other, null, isSeller ? 'B' : 'S')
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1.5">
                  <p className="truncate font-body font-medium text-ink">{otherName}</p>
                  {isSellerVerified && <SealMark size={14} />}
                </div>
                {c.last_message_at && (
                  // "3:45 PM" today, then "Yesterday", "Mon", "16 Nov": a bare
                  // time made last week's messages look like today's.
                  <time
                    dateTime={c.last_message_at}
                    title={formatFullTimestamp(c.last_message_at)}
                    className="shrink-0 font-mono text-[10px] text-muted"
                  >
                    {formatConversationTime(c.last_message_at)}
                  </time>
                )}
              </div>
              <p className="mt-0.5 truncate font-mono text-[11px] text-muted">
                {userRole} {c.listing?.title ? `· ${c.listing.title}` : ''}
              </p>
              {lastMessagePreview && (
                <p className="mt-1 truncate text-xs text-muted">{lastMessagePreview}</p>
              )}
            </div>
          </Link>
        )
      })}
    </div>
  )
}

function Thread({ conversationId, userId, userEmail, listingId, isMobileFullscreen, mobileViewport, onComposerFocus, onComposerBlur, onBackClick }) {
  const [items, setItems] = useState([])
  const [conversation, setConversation] = useState(null)
  const [activeListing, setActiveListing] = useState(null)
  const [body, setBody] = useState('')
  const [composerFocused, setComposerFocused] = useState(false)
  const [sending, setSending] = useState(false)
  const [offerMode, setOfferMode] = useState(false)
  const [reportMode, setReportMode] = useState(false)
  const [latestOrderId, setLatestOrderId] = useState(null)
  const [otherUserLastSeen, setOtherUserLastSeen] = useState(null)
  const [attachmentsByMessageId, setAttachmentsByMessageId] = useState({})
  const [selectedFiles, setSelectedFiles] = useState([])
  // How many messages with photos or videos are sending right now.
  const [mediaSending, setMediaSending] = useState(0)
  const uploadingAttachments = mediaSending > 0
  const [composerNotice, setComposerNotice] = useState('')
  // The ID the next message will be saved with. Chosen here, so sending the
  // same message again after a lost reply can't save a second copy.
  const draftIdRef = useRef(newMessageId())
  // Files in the message box that already passed the photo check (a refused
  // message's files come back with their checks). Each message takes its own
  // when sent.
  const composerCheckedRef = useRef(null)
  if (composerCheckedRef.current === null) composerCheckedRef.current = createCheckedFiles()
  // Messages that couldn't be saved, sent again when the connection returns
  // or on "Tap to retry": [{ id, conversation_id, body, files?, checked?, localAttachments? }].
  const unsentRef = useRef([])
  // IDs of messages being saved right now, so one is never sent twice at once.
  const inFlightRef = useRef(new Set())
  // This device's copies of photos it sent ("<conversation>/<file>" -> a
  // local link), shown instead of downloading them again. Freed on leaving.
  const localMediaRef = useRef(new Map())
  const objectUrlsRef = useRef(new Set())
  const signedUrlsRef = useRef(null)
  if (signedUrlsRef.current === null) signedUrlsRef.current = createSignedUrlCache({ lifetimeSeconds: SIGNED_URL_SECONDS })
  // Only the newest refresh of the conversation is shown; an older one that
  // finishes later would put back what was there before (the "twitching").
  const loadSeqRef = useRef(0)
  const reloadTimerRef = useRef(null)
  const lastItemsSignatureRef = useRef('')
  const [threadError, setThreadError] = useState('')
  const listingContextInitialized = useRef(false)
  const messagesRef = useRef(null)
  const composerRef = useRef(null)
  const hasInitialMessageScroll = useRef(false)
  const shouldStickToMessageBottom = useRef(true)
  // Phones and tablets: Enter adds a new line and the button sends.
  const [touchKeyboard] = useState(hasTouchKeyboard)

  // The message box grows with its text, up to about five lines, then
  // scrolls. Runs whenever the text changes, including when it's filled in
  // ("Hi, I'm interested in…") or cleared after sending.
  useLayoutEffect(() => {
    const box = composerRef.current
    if (!box) return
    box.style.height = 'auto'
    box.style.height = `${Math.min(box.scrollHeight, COMPOSER_MAX_HEIGHT_PX)}px`
    box.style.overflowY = box.scrollHeight > COMPOSER_MAX_HEIGHT_PX ? 'auto' : 'hidden'
  }, [body, offerMode])

  function handleComposerKeyDown(event) {
    if (!shouldSendOnEnter(event, { touchKeyboard })) return
    event.preventDefault()
    // Same rule as the send button: one message at a time.
    if (sending || uploadingAttachments) return
    const form = event.currentTarget.form
    if (form?.requestSubmit) form.requestSubmit()
    else sendMessage(event)
  }

  // A new conversation gets a new draft and opens at its newest message.
  // Checked files and the draft ID belong to the conversation they were made for.
  useEffect(() => {
    draftIdRef.current = newMessageId()
    composerCheckedRef.current = createCheckedFiles()
    hasInitialMessageScroll.current = false
    lastItemsSignatureRef.current = ''
  }, [conversationId])

  // Frees this device's copies of photos it sent when the chat closes.
  useEffect(() => {
    const objectUrls = objectUrlsRef.current
    return () => {
      for (const url of objectUrls) URL.revokeObjectURL(url)
      objectUrls.clear()
    }
  }, [])

  // Saves one text message under its own ID. Saving the same ID twice can't
  // make two messages: the second try reports "already saved" (23505), which
  // means an earlier try got through and only its reply was lost.
  async function insertTextMessage(item) {
    const row = { conversation_id: item.conversation_id, sender_id: userId, body: item.body }
    const insert = (values) => supabase.from('messages').insert(values).select().single()
    let { data, error } = await insert({ id: item.id, ...row })
    if (isColumnPermissionError(error)) ({ data, error } = await insert(row))
    if (!error) return { status: 'sent', message: data }
    if (error.code === '23505') return { status: 'sent', message: null }
    // TC001: refused for contact or bank details (migration 0037).
    if (error.code === 'TC001') return { status: 'refused', error }
    return { status: 'failed', error }
  }

  function updateItem(id, changes) {
    setItems((prev) => prev.map((entry) => entry.id === id ? { ...entry, ...changes } : entry))
  }

  // My message appears straight away, with a clock until it's saved.
  function showSending(item) {
    setItems((prev) => [...prev, {
      id: item.id,
      conversation_id: item.conversation_id,
      body: item.body,
      localAttachments: item.localAttachments,
      sender_id: userId,
      created_at: new Date().toISOString(),
      kind: 'message',
      pending: true,
      failed: false,
      read_at: null,
    }])
  }

  // The saved message takes the place of the "sending" one (same ID, so the
  // bubble stays where it is and only its clock changes to a tick).
  function showSent(item, saved, extra = {}) {
    setItems((prev) => prev.map((entry) => entry.id === item.id
      ? { ...(saved || entry), kind: 'message', pending: false, failed: false, progress: null, error: null, ...extra }
      : entry))
  }

  function markUnsent(item, error) {
    unsentRef.current = [...unsentRef.current.filter((entry) => entry.id !== item.id), item]
    updateItem(item.id, { pending: true, failed: true, progress: null, error })
  }

  function forgetUnsent(id) {
    unsentRef.current = unsentRef.current.filter((entry) => entry.id !== id)
  }

  // Sends unsent messages again: all of them when the connection returns, or
  // one when its "Tap to retry" is pressed.
  async function retryUnsentMessages(onlyId = null) {
    if (!navigator.onLine) return
    const queue = unsentRef.current.filter((entry) => !onlyId || entry.id === onlyId)
    let anyTextSent = false
    for (const item of queue) {
      if (inFlightRef.current.has(item.id)) continue
      if (item.files) {
        await deliverWithFiles(item)
        continue
      }
      inFlightRef.current.add(item.id)
      updateItem(item.id, { failed: false })
      try {
        const outcome = await insertTextMessage(item)
        if (outcome.status === 'failed') {
          console.error('Retrying a message failed:', outcome.error)
          markUnsent(item, outcome.error.message)
          continue
        }
        forgetUnsent(item.id)
        if (outcome.status === 'refused') {
          setItems((prev) => prev.filter((entry) => entry.id !== item.id))
          setBody((current) => current || item.body)
          setComposerNotice(outcome.error.message)
          continue
        }
        anyTextSent = true
        showSent(item, outcome.message)
      } finally {
        inFlightRef.current.delete(item.id)
      }
    }
    if (anyTextSent) loadThread()
  }

  useEffect(() => {
    const handleOnline = () => {
      if (navigator.onLine) retryUnsentMessages()
    }
    window.addEventListener('online', handleOnline)
    return () => window.removeEventListener('online', handleOnline)
  }, [conversationId, userId])

  // Closing or reloading the page while photos send stops the upload, so the
  // browser asks first. (Phones may not ask; the message is then simply not
  // sent, and nothing half-sent reaches the other person.)
  useEffect(() => {
    if (!uploadingAttachments) return undefined
    const warn = (event) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [uploadingAttachments])

  // A new message, its photos and read receipts usually arrive within a
  // moment of each other: one refresh shows them all.
  function scheduleReload() {
    clearTimeout(reloadTimerRef.current)
    reloadTimerRef.current = setTimeout(loadThread, RELOAD_DELAY_MS)
  }

  useEffect(() => {
    loadThread()
    const channel = supabase
      .channel(`thread-${conversationId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` }, (payload) => {
        if (payload.new.sender_id !== userId) markConversationRead(conversationId)
        scheduleReload()
      })
      // Updates are read receipts and similar: refresh, never a pop-up.
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` }, scheduleReload)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'offers', filter: `conversation_id=eq.${conversationId}` }, scheduleReload)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'offers', filter: `conversation_id=eq.${conversationId}` }, scheduleReload)
      // A photo or video is saved just after its message (seconds after, from
      // older copies of the website), so it can arrive separately. The table
      // has no conversation column to filter on, but row security only sends
      // this user's own chats (live since migration 0043).
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'message_attachments' }, scheduleReload)
      .subscribe()

    // Mark conversation as read when opened, and clear its phone notification.
    markConversationRead(conversationId)
    markConversationNotificationsRead(userId, conversationId)
    closeChatNotifications(conversationId)

    // Subscribe to read receipt updates
    const unsubscribeReadUpdates = subscribeToMessageReadUpdates(conversationId, (updatedMessage) => {
      setItems((prev) =>
        prev.map((item) =>
          item.id === updatedMessage.id && item.kind === 'message'
            ? { ...item, ...updatedMessage }
            : item
        )
      )
    })
    // Subscribe to other user's presence
    let unsubscribePresence = null
    const setupPresenceSubscription = async () => {
      const { data: convo } = await supabase
        .from('conversations')
        .select('buyer_id, seller_id')
        .eq('id', conversationId)
        .single()

      if (convo) {
        const otherUserId = convo.buyer_id === userId ? convo.seller_id : convo.buyer_id

        // Fetch initial profile data with last_seen_at
        const { data: profile } = await supabase
          .from('profiles')
          .select('last_seen_at')
          .eq('id', otherUserId)
          .single()

        if (profile) {
          setOtherUserLastSeen(profile.last_seen_at)
        }

        // Subscribe to future updates
        unsubscribePresence = subscribeToUserPresence(otherUserId, (profile) => {
          setOtherUserLastSeen(profile.last_seen_at)
        })
      }
    }
    setupPresenceSubscription()

    return () => {
      clearTimeout(reloadTimerRef.current)
      supabase.removeChannel(channel)
      if (unsubscribeReadUpdates) unsubscribeReadUpdates()
      if (unsubscribePresence) unsubscribePresence()
    }
  }, [conversationId, userId, listingId])

  // Scrolls to a new message at the bottom: always for one I just sent,
  // otherwise only if the reader is already near the bottom. Read receipts
  // and a message changing from "sending" to "sent" don't move anything.
  useEffect(() => {
    const messagePane = messagesRef.current
    if (!messagePane || items.length === 0) return
    const last = items[items.length - 1]
    const signature = `${items.length}:${last.kind}-${last.id}`
    if (signature === lastItemsSignatureRef.current) return
    lastItemsSignatureRef.current = signature

    if (!hasInitialMessageScroll.current) {
      hasInitialMessageScroll.current = true
      messagePane.scrollTop = messagePane.scrollHeight
      return
    }
    const justSentByMe = last.kind === 'message' && last.sender_id === userId && last.pending
    if (justSentByMe || shouldStickToMessageBottom.current) {
      messagePane.scrollTo({ top: messagePane.scrollHeight, behavior: 'smooth' })
    }
  }, [items, userId])

  function updateMessageScrollPosition(event) {
    const pane = event.currentTarget
    shouldStickToMessageBottom.current = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 120
  }

  // Messages can't be edited or deleted once sent (migration 0041), so the
  // conversation stays a reliable record of what was agreed.

  // A link for each photo or video: this device's own copy if it sent it, a
  // link from earlier that still works, or a new one (one request for all).
  async function attachmentLinks(paths) {
    const links = new Map()
    const missing = []
    for (const path of new Set(paths)) {
      const link = localMediaRef.current.get(path) || signedUrlsRef.current.get(path)
      if (link) links.set(path, link)
      else missing.push(path)
    }
    if (missing.length === 0) return links

    const { data, error } = await supabase.storage.from('message-attachments').createSignedUrls(missing, SIGNED_URL_SECONDS)
    if (error) console.error('Failed to sign message attachment URLs:', error)
    for (const entry of data || []) {
      if (entry.error || !entry.signedUrl) {
        console.error('Failed to sign message attachment URL:', entry.path, entry.error)
        continue
      }
      signedUrlsRef.current.set(entry.path, entry.signedUrl)
      links.set(entry.path, entry.signedUrl)
    }
    return links
  }

  // Reads the whole conversation, then shows it in one go. Only the newest
  // call is shown: one that started earlier but finished later would bring
  // back an older state (a message flickering away and back).
  async function loadThread() {
    const loadId = ++loadSeqRef.current
    const isOutdated = () => loadId !== loadSeqRef.current

    const { data: convo, error: convoError } = await supabase
      .from('conversations')
      .select('*, listing:listing_id(id, title, price, images, slug), buyer:buyer_id(id, business_name, full_name, avatar_url, verified_seller), seller:seller_id(id, business_name, full_name, avatar_url, verified_seller)')
      .eq('id', conversationId).single()
    if (isOutdated()) return

    // Without this the thread would show "Loading…" forever when the query fails.
    if (convoError || !convo) {
      console.error('Conversation could not be loaded:', convoError)
      setConversation(null)
      setThreadError(convoError?.code === 'PGRST116'
        ? 'This conversation doesn’t exist, or you’re not part of it.'
        : 'This conversation couldn’t be loaded. Please try again.')
      return
    }

    // Looked up separately: the field differs between database versions, and a
    // missing column in the main query would stop the whole thread loading.
    let payoutConnected = false
    if (convo.seller?.id) {
      payoutConnected = await fetchPayoutConnected(supabase, convo.seller.id).catch((error) => {
        console.error('Could not check the seller payout account:', error)
        return false
      })
    }

    let nextListing = convo.listing || null
    if (listingId && listingId !== convo.listing_id) {
      const { data: contactedListing } = await supabase
        .from('listings')
        .select('id, title, price, images, slug')
        .eq('id', listingId)
        .maybeSingle()
      nextListing = contactedListing || nextListing
    }

    const [{ data: messages }, { data: offers }] = await Promise.all([
      supabase.from('messages').select('*').eq('conversation_id', conversationId).order('created_at'),
      supabase.from('offers').select('*').eq('conversation_id', conversationId).order('created_at'),
    ])

    let attachmentMap = {}
    if ((messages || []).length > 0) {
      const messageIds = messages.map((message) => message.id)
      const { data: attachments } = await supabase.from('message_attachments').select('*').in('message_id', messageIds).order('created_at', { ascending: true })
      const invalid = (attachments || []).filter(a => !a.file_url)
      if (invalid.length > 0) console.warn('Attachments missing file_url:', invalid)

      const links = await attachmentLinks((attachments || []).filter((a) => a.file_url).map((a) => a.file_url))
      attachmentMap = (attachments || []).reduce((accumulator, attachment) => {
        accumulator[attachment.message_id] = accumulator[attachment.message_id] || []
        accumulator[attachment.message_id].push({ ...attachment, signed_url: links.get(attachment.file_url) || null })
        return accumulator
      }, {})
    }

    let latestOrder
    const acceptedOfferIds = (offers || []).filter((o) => o.status === 'accepted').map((o) => o.id)
    if (acceptedOfferIds.length > 0) {
      const { data: order } = await supabase.from('orders').select('id').in('offer_id', acceptedOfferIds)
        .order('created_at', { ascending: false }).limit(1).maybeSingle()
      latestOrder = order?.id || null
    }

    if (isOutdated()) return
    setThreadError('')
    setConversation({ ...convo, seller: convo.seller && { ...convo.seller, payout_connected: payoutConnected } })
    setActiveListing(nextListing)
    if (!listingContextInitialized.current && listingId && nextListing) {
      setBody(`Hi, I'm interested in "${nextListing.title}". `)
      listingContextInitialized.current = true
    }
    setAttachmentsByMessageId(attachmentMap)

    const merged = [
      ...(messages || []).map((m) => ({ ...m, kind: 'message' })),
      ...(offers || []).map((o) => ({ ...o, kind: 'offer' })),
    ].sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    // Messages still sending, or waiting to be sent again, exist only on this
    // device: keep them in view below the saved ones.
    setItems((previous) => {
      const savedIds = new Set(merged.map((item) => item.id))
      const unsaved = previous.filter((item) => item.pending && item.conversation_id === conversationId && !savedIds.has(item.id))
      return [...merged, ...unsaved]
    })
    if (latestOrder !== undefined) setLatestOrderId(latestOrder)
  }

  async function sendMessage(e) {
    e.preventDefault()
    // One message at a time (the button and Enter are also blocked).
    if (sending || uploadingAttachments) return
    const text = body.trim()
    if (!text && selectedFiles.length === 0) return
    if (selectedFiles.length > 0) await sendWithFiles(text, selectedFiles)
    else await sendText(text)
  }

  // Text only: shown straight away with a clock, saved in the background, and
  // sent again automatically if the connection drops (never twice: see
  // insertTextMessage).
  async function sendText(text) {
    const item = { id: draftIdRef.current, conversation_id: conversationId, body: text }
    draftIdRef.current = newMessageId()
    showSending(item)
    setBody('')
    setComposerNotice('')

    if (!navigator.onLine) {
      markUnsent(item, OFFLINE_NOTICE)
      return
    }

    setSending(true)
    inFlightRef.current.add(item.id)
    try {
      const outcome = await insertTextMessage(item)
      if (outcome.status === 'refused') {
        // Nothing was saved: give the text back to edit.
        setItems((prev) => prev.filter((entry) => entry.id !== item.id))
        setBody((current) => current || text)
        setComposerNotice(outcome.error.message)
        return
      }
      if (outcome.status === 'failed') {
        console.error('Failed to send message:', outcome.error)
        markUnsent(item, outcome.error.message)
        return
      }
      showSent(item, outcome.message)
      await loadThread()
    } finally {
      inFlightRef.current.delete(item.id)
      setSending(false)
    }
  }

  // With photos or videos: the message appears straight away, showing this
  // device's copies and a clock. Every file is uploaded and checked first,
  // then the message and its files are saved together (src/lib/chatMedia.js),
  // so nothing half-sent reaches the other person if the sender leaves part
  // way through.
  function sendWithFiles(text, files) {
    const item = {
      id: draftIdRef.current,
      conversation_id: conversationId,
      body: text,
      files,
      checked: composerCheckedRef.current,
      localAttachments: files.map((file, index) => ({
        id: `local-${index}`,
        file_type: file.type?.startsWith('video/') ? 'video' : 'image',
        signed_url: localCopyOf(file),
      })),
    }
    draftIdRef.current = newMessageId()
    composerCheckedRef.current = createCheckedFiles()
    showSending(item)
    setBody('')
    setSelectedFiles([])
    setComposerNotice('')

    if (!navigator.onLine) {
      markUnsent(item, OFFLINE_NOTICE)
      return undefined
    }
    return deliverWithFiles(item)
  }

  function localCopyOf(file) {
    const url = URL.createObjectURL(file)
    objectUrlsRef.current.add(url)
    return url
  }

  // Uploads, checks and saves one message with files. Used for the first try
  // and for "Tap to retry" / reconnecting (same ID, so never two copies).
  async function deliverWithFiles(item) {
    if (inFlightRef.current.has(item.id)) return
    inFlightRef.current.add(item.id)
    const holdReason = `chat-media:${item.id}`
    // Uploads can take a while on mobile data with nothing being tapped.
    holdInactivity(holdReason, true)
    setMediaSending((count) => count + 1)
    updateItem(item.id, { failed: false, error: null, progress: null })
    try {
      const result = await sendMessageWithFiles({
        client: supabase,
        conversationId: item.conversation_id,
        userId,
        messageId: item.id,
        text: item.body,
        files: item.files,
        checked: item.checked,
        onProgress: (index, total) => updateItem(item.id, { progress: total > 1 ? { index, total } : null }),
      })

      if (result.status === 'sent') {
        forgetUnsent(item.id)
        // Keep showing this device's copies of the photos that went out,
        // instead of downloading them again.
        const sentCopies = []
        for (const { file, fileUrl } of result.sentFiles) {
          const copy = item.localAttachments[item.files.indexOf(file)]
          if (!copy) continue
          localMediaRef.current.set(fileUrl, copy.signed_url)
          sentCopies.push({ ...copy, id: fileUrl, file_url: fileUrl })
        }
        showSent(item, result.message, { localAttachments: sentCopies })
        // e.g. one photo of several was refused for showing a phone number.
        if (result.notices[0]) setComposerNotice(result.notices[0])
        loadThread()
        return
      }

      if (result.reason === 'failed') {
        markUnsent(item, result.notice)
        setComposerNotice(result.notice)
        return
      }

      // Refused (contact details in the text, or every photo refused): nothing
      // was saved. The text, and any photos that can still go, come back to
      // the message box to change, unless something new is already there.
      forgetUnsent(item.id)
      setItems((prev) => prev.filter((entry) => entry.id !== item.id))
      const remaining = item.files.filter((file) => !result.blockedFiles.includes(file))
      for (const file of remaining) {
        const path = item.checked.get(file, item.conversation_id)
        if (path) composerCheckedRef.current.set(file, item.conversation_id, path)
      }
      setBody((current) => current || item.body)
      if (remaining.length > 0) setSelectedFiles((current) => current.length > 0 ? current : remaining)
      setComposerNotice(result.notice)
    } catch (error) {
      console.error('Failed to send message:', error)
      markUnsent(item, SEND_FAILED_MESSAGE)
      setComposerNotice(SEND_FAILED_MESSAGE)
    } finally {
      inFlightRef.current.delete(item.id)
      holdInactivity(holdReason, false)
      setMediaSending((count) => count - 1)
    }
  }

  // A new choice of files replaces the old one (at most MAX_FILES_PER_MESSAGE).
  function chooseFiles(fileList) {
    const files = Array.from(fileList || [])
    composerCheckedRef.current = createCheckedFiles()
    setSelectedFiles(files.slice(0, MAX_FILES_PER_MESSAGE))
    setComposerNotice(files.length > MAX_FILES_PER_MESSAGE
      ? `You can send up to ${MAX_FILES_PER_MESSAGE} photos or videos in one message. The first ${MAX_FILES_PER_MESSAGE} are ready to send.`
      : '')
  }

  if (threadError && !conversation) {
    return (
      <div className="rounded-2xl border border-hairline bg-white p-6 text-center">
        <p role="alert" className="text-sm text-ink">{threadError}</p>
        <button type="button" onClick={() => { setThreadError(''); loadThread() }} className="mt-4 rounded-full bg-seal px-4 py-2 text-sm font-semibold text-surface hover:bg-seal/90">
          Try again
        </button>
      </div>
    )
  }
  if (!conversation) return <div className="rounded-2xl border border-hairline bg-white p-6 text-muted">Loading…</div>

  const isSeller = conversation.seller.id === userId
  const other = isSeller ? conversation.buyer : conversation.seller

  const isSellerInThread = !isSeller && other.verified_seller // Show badge only for sellers
  
  return (
    <div
      className={isMobileFullscreen ? "flex h-full min-h-0 flex-col overflow-hidden bg-white" : "flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-hairline bg-white"}
      style={isMobileFullscreen ? { height: mobileViewport.height ? `${mobileViewport.height}px` : '100dvh' } : undefined}
    >
      <div className="sticky top-0 z-10 flex flex-col gap-2 border-b border-hairline bg-white p-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:p-4">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          {/* Back button for mobile */}
          {isMobileFullscreen && (
            <button
              onClick={onBackClick}
              className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full hover:bg-surfacealt transition"
              aria-label="Back to conversations"
            >
              <svg className="h-5 w-5 text-ink" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}
          {/* Profile Picture */}
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-inksoft font-display text-xs font-bold text-surface">
            {other.avatar_url ? (
              <img src={other.avatar_url} alt={other.business_name || other.full_name} loading="lazy" className="h-full w-full object-cover" />
            ) : (
              getProfileInitials(other, null, isSeller ? 'B' : 'S')
            )}
          </div>
          {/* Name and Badge */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <p className="truncate font-body text-sm font-semibold text-ink">
                {other.business_name || other.full_name}
              </p>
              {isSellerInThread && <SealMark size={16} />}
            </div>
            {/* Online Status */}
            <div className="mt-0.5 flex items-center gap-1">
              <span className={`h-2 w-2 rounded-full ${isOnline(otherUserLastSeen) ? 'bg-seal' : 'bg-muted'}`} />
              <p className="text-xs text-muted">
                {isOnline(otherUserLastSeen) ? 'Online' : formatLastSeen(otherUserLastSeen)}
              </p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          <button
            onClick={() => setReportMode(!reportMode)}
            className="min-h-11 whitespace-nowrap rounded-full border border-hairline px-3 py-1.5 font-mono text-[11px] text-muted hover:border-marigold-deep hover:text-marigold-deep sm:px-4 sm:text-xs"
          >
            {latestOrderId ? 'Report / Dispute' : 'Report'}
          </button>
          {isSeller && (
            <button
              onClick={() => setOfferMode(!offerMode)}
              className="min-h-11 whitespace-nowrap rounded-full bg-marigold px-3 py-1.5 font-mono text-[11px] font-semibold text-ink hover:bg-marigold-deep sm:px-4 sm:text-xs"
            >
              {offerMode ? 'Cancel' : '+ Create offer'}
            </button>
          )}
        </div>
      </div>

      {reportMode && (
        <ReportForm
          reporterId={userId}
          reportedId={other.id}
          orderId={latestOrderId}
          onDone={() => setReportMode(false)}
        />
      )}

      {activeListing && (
        <div className="border-b border-hairline bg-surfacealt/40 px-3 py-2">
          <Link to={`/listing/${activeListing.slug}`} className="flex items-center gap-3 rounded-xl border border-hairline bg-white p-2 transition hover:border-seal/30">
            {activeListing.images && (
              <img
                src={getListingImage(activeListing.images)}
                alt={activeListing.title}
                loading="lazy"
                className="h-14 w-14 rounded-lg object-cover"
              />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-[10px] uppercase tracking-[0.2em] text-muted">Product</p>
              <p className="truncate font-medium text-ink">{activeListing.title}</p>
              <p className="text-xs text-seal">₦{Number(activeListing.price || 0).toLocaleString()}</p>
            </div>
          </Link>
        </div>
      )}

      <div ref={messagesRef} onScroll={updateMessageScrollPosition} className="flex-1 space-y-2 overscroll-contain overflow-y-auto px-3 py-3 sm:px-4" style={{ minHeight: 0 }}>
        {groupByDay(items).map((row) => {
          if (row.type === 'day') return <DayDivider key={row.key} label={row.label} />
          const item = row.item
          return item.kind === 'offer' ? (
            <OfferCard
              key={row.key}
              offer={item}
              isSeller={isSeller}
              conversationId={conversationId}
              userId={userId}
              buyerEmail={userEmail}
              sellerPayoutConnected={Boolean(conversation?.seller?.payout_connected)}
            />
          ) : (
            <MessageBubble
              key={row.key}
              message={item}
              isMine={item.sender_id === userId}
              attachments={attachmentsByMessageId[item.id] || item.localAttachments || []}
              onRetry={item.failed ? () => retryUnsentMessages(item.id) : undefined}
            />
          )
        })}
      </div>

      {offerMode ? (
        <OfferForm conversationId={conversationId} sellerId={userId} onDone={() => setOfferMode(false)} />
      ) : (
        <form
          onSubmit={sendMessage}
          className={`shrink-0 border-t border-hairline bg-white px-3 py-2 sm:py-3 sm:pb-3 ${isMobileFullscreen && (mobileViewport.keyboardOpen || composerFocused) ? 'pb-2' : 'pb-[calc(0.5rem+env(safe-area-inset-bottom))]'}`}
        >
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <input
              id="chat-attachment-input"
              type="file"
              accept="image/*,video/*"
              multiple
              onChange={(event) => {
                chooseFiles(event.target.files)
                // Lets the same file be chosen again after it's removed.
                event.target.value = ''
              }}
              className="sr-only"
            />
            <label
              htmlFor="chat-attachment-input"
              title="Attach photos or videos"
              className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-hairline text-muted transition hover:border-seal hover:text-seal"
            >
              <Paperclip size={18} aria-hidden="true" />
              <span className="sr-only">Choose files</span>
            </label>
            {selectedFiles.length > 0 && (
              <>
                <span className="max-w-[45vw] truncate text-[10px] text-seal">{selectedFiles.length} file{selectedFiles.length === 1 ? '' : 's'} selected</span>
                <button
                  type="button"
                  onClick={() => { setSelectedFiles([]); composerCheckedRef.current = createCheckedFiles() }}
                  className="rounded-full px-2 py-1 text-[10px] font-semibold text-muted hover:bg-surfacealt hover:text-ink"
                >
                  Remove
                </button>
              </>
            )}
          </div>
          {composerNotice && (
            <p role="alert" className="mb-2 rounded-xl bg-marigold/10 px-3 py-2 text-xs leading-relaxed text-marigold-deep">
              {composerNotice}
            </p>
          )}
          <div className="flex items-end gap-2">
            <label htmlFor="chat-message-input" className="sr-only">Message</label>
            <textarea
              id="chat-message-input"
              ref={composerRef}
              rows={1}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={handleComposerKeyDown}
              onFocus={() => { setComposerFocused(true); onComposerFocus?.() }}
              onBlur={() => { setComposerFocused(false); onComposerBlur?.() }}
              placeholder="Type a message…"
              enterKeyHint={touchKeyboard ? 'enter' : 'send'}
              aria-describedby={touchKeyboard ? undefined : 'chat-message-hint'}
              className="block min-h-11 flex-1 resize-none rounded-3xl bg-surfacealt px-4 py-3 text-sm leading-5 text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-seal focus:ring-offset-0 sm:min-h-12 sm:py-3.5"
            />
            {!touchKeyboard && <span id="chat-message-hint" className="sr-only">Press Enter to send, Shift and Enter for a new line.</span>}
            <button
              type="submit" disabled={sending || uploadingAttachments}
              aria-label={uploadingAttachments ? 'Wait until your photo or video is sent' : sending ? 'Sending message' : 'Send message'}
              aria-busy={sending || uploadingAttachments}
              // Dimmed only for photo sends (seconds); a text send is too quick to show.
              className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-seal text-surface hover:bg-seal/90 transition-colors sm:h-12 sm:w-12 ${uploadingAttachments ? 'opacity-60' : ''}`}
            >
              <Send className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

function getListingImage(images) {
  if (Array.isArray(images)) return images[0] || ''
  if (typeof images !== 'string') return ''
  try {
    const parsed = JSON.parse(images)
    return Array.isArray(parsed) ? parsed[0] || '' : ''
  } catch {
    return images
  }
}

function MediaLightbox({ media, onClose }) {
  useEffect(() => {
    if (!media) return undefined

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }

    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [media, onClose])

  if (!media) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4" role="dialog" aria-modal="true" aria-label="Media viewer">
      <button type="button" onClick={onClose} aria-label="Close media viewer" className="absolute right-4 top-4 rounded-full bg-white/10 px-4 py-2 text-2xl text-white hover:bg-white/20">×</button>
      {media.type === 'video' ? (
        <video src={media.url} controls autoPlay className="max-h-[90vh] max-w-[90vw] object-contain" />
      ) : (
        <img src={media.url} alt="Shared media" className="max-h-[90vh] max-w-[90vw] object-contain" />
      )}
    </div>
  )
}

// "Today", "Yesterday", "Monday" or "Mon, 16 Nov 2026" above each day's messages.
function DayDivider({ label }) {
  return (
    <div className="flex justify-center py-2" role="separator" aria-label={label}>
      <span className="rounded-full bg-surfacealt px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
        {label}
      </span>
    </div>
  )
}

// The time under a message or offer ("3:45 PM"). The time comes from the
// database, so the sender can't change it. Hover shows the full date and
// time; a tap shows it too, for phones, where there is no hover.
function MessageTime({ timestamp, align = 'start', children }) {
  const [showFull, setShowFull] = useState(false)
  const short = formatMessageTime(timestamp)
  const full = formatFullTimestamp(timestamp)
  if (!short) return children ? <div className="mt-0.5 px-1">{children}</div> : null

  return (
    <div className={`mt-0.5 flex items-center gap-1 px-1 ${align === 'end' ? 'justify-end' : 'justify-start'}`}>
      <button
        type="button"
        onClick={() => setShowFull((value) => !value)}
        title={full}
        aria-label={showFull ? `Sent ${full}. Show the time only` : `Sent ${full}`}
        className="rounded font-mono text-[10px] text-muted transition hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-seal"
      >
        <time dateTime={timestamp}>{showFull ? full : short}</time>
      </button>
      {children}
    </div>
  )
}

const MEDIA_CHECK_GRACE_MS = 2 * 60 * 1000

function StatusIcon({ icon: Icon, label, className = '' }) {
  return (
    <span title={label} className={`inline-flex h-3.5 w-3.5 items-center justify-center ${className}`}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  )
}

// The mark after the time on my own messages: a clock while it sends, one
// tick once saved (the other person can see it), two green ticks once they've
// read it. Every mark is the same size, so the message doesn't move when it
// changes.
function MessageStatus({ message }) {
  const status = messageStatus(message)
  if (status === 'sending') return <StatusIcon icon={Clock} label="Sending" className="text-muted" />
  if (status === 'not_sent') return <StatusIcon icon={CircleAlert} label="Not sent" className="text-marigold-deep" />
  if (status === 'read') return <StatusIcon icon={CheckCheck} label="Read" className="text-seal" />
  return <StatusIcon icon={Check} label="Sent" className="text-muted" />
}

// One chat message. Sent messages are final: there is no edit or delete
// (migration 0041). Messages edited or deleted before that still show
// "(edited)" or "This message was deleted", so the history stays honest.
// onRetry: given for my own message that couldn't be saved yet.
function MessageBubble({ message, isMine, attachments = [], onRetry }) {
  const [lightboxMedia, setLightboxMedia] = useState(null)

  const isDeleted = Boolean(message.is_deleted || message.deleted_at)
  // A photo/video message whose file isn't available to show (still being
  // checked, or removed by the check) would otherwise be an empty bubble.
  // For its first two minutes it is most likely still being checked.
  const hasNothingToShow = !message.body && attachments.length === 0 && !message.pending
  const mayStillArrive = hasNothingToShow && Date.now() - new Date(message.created_at).getTime() < MEDIA_CHECK_GRACE_MS

  return (
    <>
      <div className={`flex w-full ${isMine ? 'justify-end' : 'justify-start'}`}>
        <div className={`flex min-w-0 max-w-[70%] flex-col ${isMine ? 'items-end' : 'items-start'}`}>
          <div className={`min-w-0 max-w-full px-4 py-2.5 text-sm leading-relaxed break-words ${
            isMine 
              ? 'rounded-3xl rounded-br-sm bg-seal text-surface' 
              : 'rounded-3xl rounded-bl-sm bg-surfacealt text-ink'
          }`}>
            {isDeleted ? (
              <p className="text-[13px] italic text-current/70">This message was deleted</p>
            ) : message.flagged ? (
              <p className="italic text-marigold-deep">
                ⚠️ This message was hidden — it looked like it contained bank account details. For your
                safety, keep payments inside Trustall checkout.
              </p>
            ) : hasNothingToShow ? (
              <p className="text-[13px] italic text-current/70">
                {mayStillArrive ? 'Photo or video on its way…' : 'Photo or video unavailable'}
              </p>
            ) : (
              <>
                {message.body && <p className="whitespace-pre-wrap">{message.body}{message.edited_at && <span className="ml-1 text-[10px] opacity-75">(edited)</span>}</p>}
                {message.failed && isMine && (
                  <p className="mt-1 text-[10px] uppercase tracking-[0.2em] text-surface/80">
                    Not sent yet
                    {onRetry && (
                      <button
                        type="button"
                        onClick={onRetry}
                        className="ml-2 rounded-full bg-white/90 px-2 py-0.5 font-semibold normal-case tracking-normal text-seal hover:bg-white"
                      >
                        Tap to retry
                      </button>
                    )}
                  </p>
                )}
                {attachments.length > 0 && (
                  <div className="relative mt-3 grid gap-2 sm:grid-cols-2">
                    {message.pending && !message.failed && isMine && (
                      // Over the photos, so nothing moves when it goes away.
                      <p role="status" className="pointer-events-none absolute inset-x-2 bottom-2 z-10 rounded-full bg-black/65 px-3 py-1 text-center font-mono text-[10px] leading-snug text-white">
                        {message.progress
                          ? `Sending ${Math.min(message.progress.index + 1, message.progress.total)} of ${message.progress.total}`
                          : 'Sending'}
                        {' · keep Trustall open'}
                      </p>
                    )}
                    {attachments.map((attachment) => (
                      <button
                        // Keyed by the stored file, so a photo I just sent keeps
                        // its place on screen when the saved copy replaces it.
                        key={attachment.file_url || attachment.id}
                        type="button"
                        onClick={() => setLightboxMedia({
                          type: attachment.file_type === 'video' ? 'video' : 'image',
                          url: attachment.signed_url,
                        })}
                        className="overflow-hidden rounded-xl border border-current/15 bg-white/10 text-left"
                        aria-label={attachment.file_type === 'video' ? 'Open video attachment' : 'Open image attachment'}
                      >
                        {attachment.flagged ? (
                          <div className="p-3 text-xs italic text-marigold-deep">
                            ⚠️ This image was hidden — it looked like it contained contact or bank details. For your safety, keep payments and contact inside Trustall.
                          </div>
                        ) : !attachment.signed_url ? (
                          <div className="flex h-36 w-full items-center justify-center bg-black/10 text-xs text-current/60">
                            Media unavailable
                          </div>
                        ) : attachment.file_type === 'video' ? (
                          <div className="relative">
                            <video src={attachment.signed_url} className="h-36 w-full object-cover" loading="lazy" muted playsInline />
                            <span className="absolute bottom-2 right-2 rounded-full bg-black/60 px-2 py-1 font-mono text-[9px] text-white">Video</span>
                          </div>
                        ) : (
                          <img src={attachment.signed_url} alt="Shared media" className="h-36 w-full object-cover" loading="lazy" />
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          <MessageTime timestamp={message.created_at} align={isMine ? 'end' : 'start'}>
            {isMine && <MessageStatus message={message} />}
          </MessageTime>
        </div>
      </div>
      <MediaLightbox media={lightboxMedia} onClose={() => setLightboxMedia(null)} />
    </>
  )
}

function OfferCard({ offer, isSeller, userId, buyerEmail, sellerPayoutConnected }) {
  const navigate = useNavigate()
  const [paying, setPaying] = useState(false)
  const [deliveryAddress, setDeliveryAddress] = useState(offer.delivery_address || '')
  const [savedAddress, setSavedAddress] = useState(offer.delivery_address || '')
  const [addressSaved, setAddressSaved] = useState(Boolean(offer.delivery_address))
  const [savingAddress, setSavingAddress] = useState(false)
  const [addressError, setAddressError] = useState('')
  const supportEmail = getSupportEmail()
  const itemTotal = Number(offer.price) + Number(offer.delivery_fee)
  const sellerFee = Math.min(itemTotal * 0.05, 5000) // 5%, capped at ₦5,000
  const buyerFee = 100 // flat escrow protection fee
  const totalCharged = itemTotal + buyerFee
  const hasConnectedPayout = sellerPayoutConnected
  // Paying needs a verified account (migration 0040). The database refuses
  // unverified checkouts; this shows the checklist instead of a failing button.
  const location = useLocation()
  const { readiness, refresh: refreshReadiness } = usePaymentReadiness({ enabled: !isSeller && offer.status === 'pending' })
  const needsVerification = Boolean(readiness?.checked && !readiness.ready)
  // Nobody is signed out for inactivity while paying: taps inside the
  // Paystack window can't be seen by the app.
  useEffect(() => {
    const reason = `offer-checkout:${offer.id}`
    holdInactivity(reason, paying)
    return () => holdInactivity(reason, false)
  }, [paying, offer.id])

  async function shareDeliveryAddress() {
    const cleanAddress = deliveryAddress.trim()
    if (!cleanAddress) {
      setAddressError('Enter the address where you want the item delivered.')
      return
    }

    setSavingAddress(true)
    setAddressError('')
    try {
      const { error } = await supabase.rpc('share_offer_delivery_address', {
        p_offer_id: offer.id,
        p_delivery_address: cleanAddress,
      })
      if (error) throw error

      setDeliveryAddress(cleanAddress)
      setSavedAddress(cleanAddress)
      setAddressSaved(true)
    } catch (error) {
      console.error('Failed to share delivery address:', error)
      setAddressError(
        error.code === 'PGRST202' || error.code === '42883'
          ? 'Delivery address sharing is not enabled yet. Ask the Trustall admin to apply Supabase migration 0026_share_offer_delivery_address.sql, then try again.'
          : error.message || 'Could not share your address. Please try again.'
      )
    } finally {
      setSavingAddress(false)
    }
  }

  async function openAcceptedOfferOrder() {
    const { data: order, error } = await supabase
      .from('orders')
      .select('id')
      .eq('offer_id', offer.id)
      .maybeSingle()

    if (error) {
      console.error('Failed to find order for accepted offer:', error)
      navigate('/orders')
      return
    }
    navigate(order?.id ? `/orders/${order.id}` : '/orders')
  }

  async function acceptAndPay() {
    if (!window.PaystackPop) {
      alert("Payment isn't available right now — please refresh and try again.")
      return
    }
    if (!hasConnectedPayout) {
      alert("This seller hasn't connected a payout account yet — checkout isn't available for this offer.")
      return
    }
    setPaying(true)
    // References are issued server-side (e.g. TRUST-ORD-YBENA62B67JS) and can only be used once.
    const { data: reference, error: referenceError } = await supabase.rpc('issue_order_payment_reference', { p_offer_id: offer.id })
    if (isPaymentVerificationError(referenceError)) {
      // Readiness changed since the page loaded: show the checklist instead.
      setPaying(false)
      await refreshReadiness()
      return
    }
    if (referenceError || !reference) {
      setPaying(false)
      alert(referenceError?.message || "Couldn't start checkout. Please try again.")
      return
    }
    const handler = window.PaystackPop.setup({
      key: import.meta.env.VITE_PAYSTACK_PUBLIC_KEY,
      email: buyerEmail,
      amount: Math.round(totalCharged * 100), // kobo — buyer's full charge, including the ₦100 fee
      currency: 'NGN',
      ref: reference,
      bearer: 'account', // Trustall's main account bears the Paystack processing fee, not the seller
      callback: (response) => {
        ;(async () => {
          try {
            const { data: { session } } = await supabase.auth.getSession()
            const res = await fetch(
              `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/paystack-verify-payment`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${session.access_token}`,
                },
                body: JSON.stringify({ reference: response.reference, offer_id: offer.id }),
              }
            )
            const result = await res.json()
            
            if (result.error) {
              setPaying(false)
              alert(`Payment received but couldn't be confirmed: ${result.error}. Contact ${supportEmail} with reference ${response.reference}`)
              return
            }

            // Payment verified, now record it as pending
            if (result.order?.id || result.order_id) {
              const { error: pendingError } = await supabase.rpc('record_payment_as_pending', {
                p_order_id: result.order?.id || result.order_id,
              })

              if (pendingError) {
                setPaying(false)
                alert(`Payment confirmed but couldn't be recorded: ${pendingError.message}. Contact ${supportEmail} with reference ${response.reference}`)
                return
              }
            }

            const orderId = result.order?.id || result.order_id
            setPaying(false)
            navigate(orderId ? `/orders/${orderId}` : '/orders')
          } catch (err) {
            setPaying(false)
            console.error('Payment callback error:', err)
            alert(`Payment processing error: ${err.message}`)
          }
        })()
      },
      onClose: () => setPaying(false),
    })
    handler.openIframe()
  }

  return (
    <div
      className={`max-w-[85%] rounded-2xl border border-marigold/30 bg-gradient-to-br from-marigold/5 to-white p-4 shadow-sm transition ${offer.status === 'accepted' ? 'cursor-pointer hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-seal' : 'hover:shadow-md'}`}
      onClick={offer.status === 'accepted' ? openAcceptedOfferOrder : undefined}
      onKeyDown={offer.status === 'accepted' ? (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          openAcceptedOfferOrder()
        }
      } : undefined}
      role={offer.status === 'accepted' ? 'link' : undefined}
      tabIndex={offer.status === 'accepted' ? 0 : undefined}
      aria-label={offer.status === 'accepted' ? `Open order for accepted offer: ${offer.item_title}` : undefined}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="font-mono text-[9px] uppercase tracking-widest text-marigold-deep font-semibold">Offer</p>
            {/* When the offer was sent (set by the database), with the full date on hover. */}
            {offer.created_at && (
              <time dateTime={offer.created_at} title={formatFullTimestamp(offer.created_at)} className="font-mono text-[10px] text-muted">
                {formatMessageTime(offer.created_at)}
              </time>
            )}
          </div>
          <p className="mt-2 font-display text-base font-bold text-ink">{offer.item_title}</p>
          {offer.item_description && <p className="mt-1 text-xs text-muted leading-relaxed">{offer.item_description}</p>}
        </div>
      </div>
      
      <div className="mt-4 space-y-3 border-t border-marigold/20 pt-3">
        {/* Pricing Summary */}
        <div className="flex items-baseline justify-between rounded-lg bg-seal/5 px-3 py-2">
          <span className="text-xs text-muted">Total cost:</span>
          <span className="font-display text-xl font-bold text-seal">
            ₦{(isSeller ? itemTotal - sellerFee : totalCharged).toLocaleString()}
          </span>
        </div>

        {/* Price Breakdown */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg bg-white border border-hairline p-2">
            <span className="text-muted">Item:</span>
            <p className="font-semibold text-ink">₦{Number(offer.price).toLocaleString()}</p>
          </div>
          <div className="rounded-lg bg-white border border-hairline p-2">
            <span className="text-muted">Delivery:</span>
            <p className="font-semibold text-ink">₦{Number(offer.delivery_fee).toLocaleString()}</p>
          </div>
        </div>

        <div className="space-y-2 bg-white rounded-lg p-3 border border-hairline/50">
          <div className="flex gap-2 text-xs">
            <span className="font-semibold text-seal">🚚</span>
            <div>
              <p className="text-muted">Delivery Method</p>
              <p className="font-medium text-ink">
                {offer.delivery_type === 'fast' ? '⚡ Fast Delivery' : 'Normal Delivery'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {isSeller && offer.delivery_address && (
        <div className="mt-3 rounded-lg border border-seal/20 bg-seal/5 p-3">
          <p className="font-mono text-[9px] font-semibold uppercase tracking-widest text-seal">Buyer delivery address</p>
          <p className="mt-1 whitespace-pre-wrap break-words text-xs text-ink">{offer.delivery_address}</p>
        </div>
      )}
      
      {!isSeller && offer.status === 'pending' && (
        <>
          <div className="mt-4 rounded-xl border border-hairline bg-white p-3">
            <label htmlFor={`offer-address-${offer.id}`} className="block text-xs font-semibold text-ink">Delivery address</label>
            <p className="mt-1 text-[11px] text-muted">Shared securely with the seller and attached to your order.</p>
            <textarea
              id={`offer-address-${offer.id}`}
              value={deliveryAddress}
              maxLength={500}
              rows={3}
              onChange={(event) => {
                setDeliveryAddress(event.target.value)
                setAddressSaved(false)
              }}
              placeholder="Street address, area, city, state"
              className="mt-2 w-full resize-y rounded-lg border border-hairline bg-surfacealt px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-seal focus:outline-none"
            />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-[10px] text-muted">{addressSaved ? 'Shared with seller' : 'Not shared yet'}</span>
              <button
                type="button"
                onClick={shareDeliveryAddress}
                disabled={savingAddress || !deliveryAddress.trim() || (addressSaved && deliveryAddress.trim() === savedAddress)}
                className="rounded-full border border-seal px-3 py-1.5 font-mono text-[10px] font-semibold text-seal hover:bg-seal/5 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {savingAddress ? 'Sharing…' : addressSaved ? 'Update address' : 'Share with seller'}
              </button>
            </div>
            {addressError && <p role="alert" className="mt-2 text-xs text-red-700">{addressError}</p>}
          </div>
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
            🔒 Safe Pay: Your ₦{totalCharged.toLocaleString()} will be held in escrow. The seller only gets paid after you receive your item and approve it.
          </div>
          {needsVerification ? (
            <div role="status" className="mt-4 rounded-xl border border-marigold/40 bg-marigold/10 p-3">
              <p className="text-sm font-semibold text-ink">Verify your account to pay</p>
              <ul className="mt-1 list-disc pl-5 text-xs text-muted">
                {readiness.missing.map((code) => <li key={code}>{describePaymentRequirement(code)}</li>)}
              </ul>
              <Link
                to={verificationPageLink(location.pathname)}
                className="mt-3 inline-flex rounded-full bg-seal px-4 py-2 font-mono text-xs font-semibold text-white hover:bg-seal-deep"
              >
                Verify now
              </Link>
            </div>
          ) : (
            <button
              onClick={acceptAndPay}
              disabled={paying}
              className="mt-4 w-full rounded-lg bg-gradient-to-r from-seal to-seal-deep py-3 font-body text-sm font-semibold text-surface hover:shadow-lg hover:shadow-seal/20 disabled:opacity-60 disabled:cursor-not-allowed transition transform hover:-translate-y-0.5"
            >
              {paying ? 'Processing…' : `Accept & Pay ₦${totalCharged.toLocaleString()}`}
            </button>
          )}
        </>
      )}
      {offer.status !== 'pending' && (
        <div className="mt-3 inline-block rounded-full px-3 py-1 text-xs font-medium" style={{
          backgroundColor: offer.status === 'accepted' ? '#10b98130' : offer.status === 'declined' ? '#ef444430' : '#f5a62230',
          color: offer.status === 'accepted' ? '#047857' : offer.status === 'declined' ? '#991b1b' : '#b45309'
        }}>
          {offer.status.charAt(0).toUpperCase() + offer.status.slice(1)}
        </div>
      )}
    </div>
  )
}

function OfferForm({ conversationId, sellerId, onDone }) {
  const [itemTitle, setItemTitle] = useState('')
  const [description, setDescription] = useState('')
  const [price, setPrice] = useState('')
  const [deliveryType, setDeliveryType] = useState('normal')
  const [fastDeliveryPrice, setFastDeliveryPrice] = useState('')
  const [normalDeliveryPrice, setNormalDeliveryPrice] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const displayDeliveryFee = deliveryType === 'fast' ? Number(fastDeliveryPrice || 500) : Number(normalDeliveryPrice || 0)
  const totalPrice = Number(price) + displayDeliveryFee

  async function submit(e) {
    e.preventDefault()

    if (deliveryType === 'normal' && !normalDeliveryPrice) {
      alert('Please enter a normal delivery price')
      return
    }

    setSubmitting(true)
    try {
      const payload = {
        conversation_id: conversationId,
        seller_id: sellerId,
        item_title: itemTitle,
        item_description: description,
        price: Number(price),
        delivery_fee: displayDeliveryFee,
      }

      const { data: offer, error: offerError } = await supabase.from('offers').insert(payload).select().single()

      if (offerError) throw offerError

      // Create notification for the buyer
      const { data: conversation } = await supabase
        .from('conversations')
        .select('buyer_id')
        .eq('id', conversationId)
        .single()
      
      setSubmitting(false)
      onDone()
    } catch (err) {
      setSubmitting(false)
      console.error('Error creating offer:', err)
      // TC001: the offer text had contact or bank details; the message says so plainly.
      alert(err.code === 'TC001' ? err.message : `Failed to create offer: ${err.message}`)
    }
  }

  return (
    <form onSubmit={submit} className="min-h-0 max-h-[65%] shrink-0 space-y-3 overflow-y-auto border-t border-hairline bg-gradient-to-br from-seal/5 to-surface p-4 sm:max-h-[70%]">
      <input 
        required 
        placeholder="Item title" 
        value={itemTitle} 
        onChange={(e) => setItemTitle(e.target.value)}
        className="w-full rounded-lg border border-hairline bg-white px-3 py-2.5 text-sm text-ink placeholder:text-muted focus:border-seal focus:ring-1 focus:ring-seal/20 outline-none transition"
      />

      <textarea 
        placeholder="Description (optional)" 
        value={description} 
        onChange={(e) => setDescription(e.target.value)}
        rows={2}
        className="w-full rounded-lg border border-hairline bg-white px-3 py-2.5 text-sm text-ink placeholder:text-muted focus:border-seal focus:ring-1 focus:ring-seal/20 outline-none transition resize-none"
      />

      <div>
        <label className="block text-xs font-semibold text-muted mb-1">Price (₦)</label>
        <input 
          required 
          type="number" 
          min="0" 
          step="0.01"
          placeholder="0" 
          value={price} 
          onChange={(e) => setPrice(e.target.value)}
          className="w-full rounded-lg border border-hairline bg-white px-3 py-2.5 text-sm text-ink placeholder:text-muted focus:border-seal focus:ring-1 focus:ring-seal/20 outline-none transition"
        />
      </div>

      <div className="bg-white rounded-lg p-3 border border-hairline/50 space-y-2">
        <label className="block text-xs font-semibold text-muted">Delivery Options</label>
        <div className="space-y-2">
          <label className="flex items-center gap-2 cursor-pointer p-2 rounded-lg hover:bg-seal/5 transition">
            <input 
              type="radio" 
              name="delivery" 
              value="normal" 
              checked={deliveryType === 'normal'} 
              onChange={(e) => setDeliveryType(e.target.value)} 
              className="cursor-pointer"
            />
            <span className="flex-1 text-xs font-medium text-ink">Normal Delivery</span>
          </label>
          {deliveryType === 'normal' && (
            <input 
              required 
              type="number" 
              min="0" 
              step="0.01"
              placeholder="Delivery price ₦" 
              value={normalDeliveryPrice} 
              onChange={(e) => setNormalDeliveryPrice(e.target.value)}
              className="ml-6 w-[calc(100%-24px)] rounded-lg border border-hairline bg-seal/5 px-2.5 py-1.5 text-xs text-ink placeholder:text-muted focus:border-seal outline-none"
            />
          )}

          <label className="flex items-center gap-2 cursor-pointer p-2 rounded-lg hover:bg-seal/5 transition">
            <input 
              type="radio" 
              name="delivery" 
              value="fast" 
              checked={deliveryType === 'fast'} 
              onChange={(e) => setDeliveryType(e.target.value)} 
              className="cursor-pointer"
            />
            <span className="flex-1 text-xs font-medium text-ink">⚡ Fast Delivery</span>
          </label>
          {deliveryType === 'fast' && (
            <input 
              type="number" 
              min="0" 
              step="0.01"
              placeholder="Fast delivery price (default: ₦500)" 
              value={fastDeliveryPrice} 
              onChange={(e) => setFastDeliveryPrice(e.target.value)}
              className="ml-6 w-[calc(100%-24px)] rounded-lg border border-hairline bg-seal/5 px-2.5 py-1.5 text-xs text-ink placeholder:text-muted focus:border-seal outline-none"
            />
          )}
        </div>
      </div>

      <div className="rounded-lg bg-gradient-to-r from-seal/10 to-seal/5 p-3 border border-seal/20">
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-muted">Total for buyer:</span>
          <span className="font-display text-lg font-bold text-seal">₦{totalPrice.toLocaleString()}</span>
        </div>
        <p className="mt-1 text-xs text-muted">
          Item: ₦{Number(price || 0).toLocaleString()} + Delivery: ₦{displayDeliveryFee.toLocaleString()}
        </p>
      </div>

      <button 
        type="submit" 
        disabled={submitting} 
        className="w-full rounded-lg bg-gradient-to-r from-seal to-seal-deep py-3 font-body text-sm font-semibold text-surface hover:shadow-lg hover:shadow-seal/20 disabled:opacity-60 disabled:cursor-not-allowed transition transform hover:-translate-y-0.5"
      >
        {submitting ? 'Sending…' : 'Send Offer'}
      </button>
    </form>
  )
}

function ReportForm({ reporterId, reportedId, orderId, onDone }) {
  const [reason, setReason] = useState(orderId ? 'Item/service not as described' : 'Suspicious behavior')
  const [details, setDetails] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setSubmitting(true)
    await supabase.from('reports').insert({
      reporter_id: reporterId, reported_id: reportedId, reason, details,
      order_id: orderId || null,
      is_dispute: !!orderId,
    })
    setSubmitting(false)
    setDone(true)
  }

  if (done) {
    return (
      <div className="border-t border-hairline p-4 text-sm text-seal">
        {orderId
          ? 'Dispute submitted — Trustall will review it and reach out via WhatsApp or the platform to help resolve this between you and the other party.'
          : 'Report submitted — the Trustall team will review it.'}
        <button onClick={onDone} className="ml-2 font-mono text-xs text-muted underline">Close</button>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-2 border-t border-hairline bg-marigold/5 p-4">
      {orderId && (
        <p className="text-xs text-marigold-deep">
          Disputes on an order can be raised within 2 days of receiving the item or service.
        </p>
      )}
      <select
        value={reason} onChange={(e) => setReason(e.target.value)}
        className="w-full rounded-xl border border-hairline bg-white px-3 py-2 text-sm text-ink focus:border-seal outline-none"
      >
        {orderId && <option>Item/service not as described</option>}
        {orderId && <option>Never received item/service</option>}
        <option>Suspicious behavior</option>
        <option>Requested payment outside Trustall</option>
        <option>Harassment or abuse</option>
        <option>Other</option>
      </select>
      <textarea
        placeholder="Add any details that would help us look into this"
        rows={2} value={details} onChange={(e) => setDetails(e.target.value)}
        className="w-full rounded-xl border border-hairline bg-white px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-seal outline-none"
      />
      <button
        type="submit" disabled={submitting}
        className="w-full rounded-full bg-marigold-deep py-2.5 font-body text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
      >
        {submitting ? 'Submitting…' : orderId ? 'Submit dispute' : 'Submit report'}
      </button>
    </form>
  )
}
