import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  getUnreadNotificationCount,
  fetchNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  markConversationNotificationsRead,
  subscribeToNotifications,
  formatRelativeTime,
  getNotificationRoute,
  getNotificationIcon,
  getNotificationDisplayTitle,
} from "../lib/notificationUtils";
import { supabase } from "../lib/supabaseClient.js";
import { SHOW_NOTIFICATION_EVENT, showAppNotification } from "../lib/notifications.js";
import { isUuid } from "../../supabase/functions/_shared/notificationRoutes.js";

export function NotificationBell({ userId }) {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [senderNames, setSenderNames] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const ref = useRef(null);
  const senderNamesRef = useRef({});
  const navigate = useNavigate();
  const location = useLocation();
  const [selectedNotification, setSelectedNotification] = useState(null);

  const loadNotifications = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [count, list] = await Promise.all([
        getUnreadNotificationCount(userId),
        fetchNotifications(userId),
      ]);
      setUnreadCount(count);
      setNotifications(list);
      console.log("Notifications loaded:", list.length, "unread:", count);
    } catch (err) {
      console.error("Failed to load notifications:", err);
      setError("Failed to load notifications");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    senderNamesRef.current = senderNames;
  }, [senderNames]);

  useEffect(() => {
    if (!userId) return;

    loadNotifications();

    const unsubscribe = subscribeToNotifications(userId, (newNotification) => {
      console.log("New notification received:", newNotification);
      setNotifications((prev) => {
        if (prev.some((n) => n.id === newNotification.id)) return prev;
        return [newNotification, ...prev];
      });
      setUnreadCount((prev) => prev + 1);

      // Only while the app is out of view, with the push's tag for this row,
      // and a tap opens the same page as "View".
      showAppNotification({
        title: getNotificationDisplayTitle(newNotification, senderNamesRef.current[newNotification.sender_id]),
        body: newNotification.message || "You have a new notification",
        notificationId: newNotification.id,
        path: getNotificationRoute(newNotification),
      });
    });

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [userId, loadNotifications]);

  // Shows one notification's full message (marketing has no page of its own).
  // The row is read back from the database, limited to this user's own, so an
  // id from a link can never show someone else's notification.
  const showNotificationById = useCallback(async (notificationId) => {
    if (!userId || !isUuid(notificationId)) return;
    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .eq("id", notificationId)
      .eq("recipient_id", userId)
      .maybeSingle();
    if (error || !data) return;

    setSelectedNotification(data);
    if (!data.read_at) {
      await markNotificationRead(data.id);
      setNotifications((prev) => prev.filter((n) => n.id !== data.id));
      setUnreadCount(await getUnreadNotificationCount(userId));
    }
  }, [userId]);

  // A tapped marketing push (public/sw.js) or app pop-up (notifications.js).
  useEffect(() => {
    function onWorkerMessage(event) {
      if (event.data?.type === SHOW_NOTIFICATION_EVENT) showNotificationById(event.data.notificationId);
    }
    function onPageEvent(event) {
      showNotificationById(event.detail?.notificationId);
    }
    navigator.serviceWorker?.addEventListener("message", onWorkerMessage);
    window.addEventListener(SHOW_NOTIFICATION_EVENT, onPageEvent);
    return () => {
      navigator.serviceWorker?.removeEventListener("message", onWorkerMessage);
      window.removeEventListener(SHOW_NOTIFICATION_EVENT, onPageEvent);
    };
  }, [showNotificationById]);

  // A tapped marketing push that had to open the app arrives as
  // /?notification=<id>. The id is taken out of the address so a reload or
  // a shared link doesn't open it again.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const notificationId = params.get("notification");
    if (notificationId === null) return;
    params.delete("notification");
    const search = params.toString();
    navigate({ pathname: location.pathname, search: search ? `?${search}` : "", hash: location.hash }, { replace: true });
    showNotificationById(notificationId);
  }, [location.pathname, location.search, location.hash, navigate, showNotificationById]);

  useEffect(() => {
    if (!notifications.length) return;

    const senderIds = [...new Set(
      notifications
        .filter((notification) => notification.sender_id)
        .map((notification) => notification.sender_id)
    )];

    if (senderIds.length === 0) return;

    let active = true;

    async function loadSenderNames() {
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, business_name, handle')
        .in('id', senderIds);

      if (!active || !data) return;

      const nextNames = data.reduce((accumulator, profile) => {
        accumulator[profile.id] = profile.business_name || profile.full_name || profile.handle || 'Someone';
        return accumulator;
      }, {});

      setSenderNames((previous) => ({ ...previous, ...nextNames }));
    }

    loadSenderNames();

    return () => {
      active = false;
    };
  }, [notifications]);

  useEffect(() => {
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (unreadCount > 0 && typeof navigator.setAppBadge === "function") {
      navigator.setAppBadge(unreadCount).catch(() => {});
    } else if (unreadCount === 0 && typeof navigator.clearAppBadge === "function") {
      navigator.clearAppBadge().catch(() => {});
    }
  }, [unreadCount]);

  async function handleNotificationClick(notification) {
    try {
      await markNotificationRead(notification.id);
      if (notification.related_conversation_id) {
        await markConversationNotificationsRead(userId, notification.related_conversation_id);
      }
      setNotifications((prev) => prev.filter((n) => n.id !== notification.id));
      setUnreadCount((prev) => Math.max(0, prev - 1));
      setSelectedNotification(notification);
    } catch (err) {
      console.error("Failed to mark notification as read:", err);
    }
  }

  function closeNotificationDetail() {
    setSelectedNotification(null);
    setOpen(false);
  }

  function handleNotificationView() {
    if (!selectedNotification) return;
    // null for marketing: the full message is already on screen.
    const route = getNotificationRoute(selectedNotification);
    if (route) navigate(route);
    closeNotificationDetail();
  }

  async function handleMarkAllRead() {
    try {
      await markAllNotificationsRead(userId);
      setNotifications([]);
      setUnreadCount(0);
    } catch (err) {
      console.error("Failed to mark all as read:", err);
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="relative flex h-11 w-11 items-center justify-center rounded-full hover:bg-surfacealt transition"
        aria-label="Notifications"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          className="h-5 w-5"
          aria-hidden="true"
        >
          <path
            d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute top-0 right-0 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs font-bold text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && !selectedNotification && (
        <div className="absolute right-0 mt-2 w-[calc(100vw-1.5rem)] max-w-80 rounded-xl border border-hairline bg-white shadow-lg z-50">
          <div className="border-b border-hairline px-4 py-3 flex items-center justify-between">
            <h3 className="font-semibold text-ink">Notifications</h3>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="text-xs text-seal hover:text-seal/80 transition font-medium"
              >
                Mark all as read
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {loading ? (
              <div className="px-4 py-6 text-center text-sm text-muted">Loading…</div>
            ) : notifications.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-muted">No notifications yet</div>
            ) : (
              notifications.map((notification) => {
                const displayTitle = getNotificationDisplayTitle(notification, senderNames[notification.sender_id]);

                return (
                  <button
                    key={notification.id}
                    onClick={() => handleNotificationClick(notification)}
                    className={`w-full border-b border-hairline px-4 py-3 text-left transition hover:bg-surfacealt ${
                      !notification.read_at ? "bg-blue-50" : ""
                    }`}
                  >
                    <div className="flex gap-3">
                      <span className="text-xl flex-shrink-0">
                        {getNotificationIcon(notification.type)}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm text-ink line-clamp-1">
                          {displayTitle}
                        </p>
                        <p className="text-xs text-muted line-clamp-2 mt-0.5">
                          {notification.message || notification.body || "You have a new update."}
                        </p>
                        <p className="text-xs text-muted mt-1">
                          {formatRelativeTime(notification.created_at)}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}

      {selectedNotification && (
        <div className="fixed inset-x-3 top-[calc(4.75rem+env(safe-area-inset-top))] z-[60] max-h-[calc(100dvh-7rem)] overflow-y-auto rounded-2xl border border-hairline bg-white p-4 shadow-2xl sm:absolute sm:left-auto sm:right-0 sm:top-auto sm:mt-2 sm:max-h-none sm:w-96 sm:rounded-xl sm:shadow-lg">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="text-2xl">{getNotificationIcon(selectedNotification.type)}</span>
              <div className="min-w-0 flex-1">
                <p className="font-mono text-[10px] uppercase tracking-widest text-muted">Notification</p>
                <h3 className="mt-1 font-display text-xl font-bold text-ink">
                  {getNotificationDisplayTitle(selectedNotification, senderNames[selectedNotification.sender_id])}
                </h3>
              </div>
            </div>
            <button onClick={closeNotificationDetail} className="min-h-11 shrink-0 rounded-lg px-2 font-mono text-xs text-muted hover:bg-surfacealt hover:text-ink">Close</button>
          </div>

          <div className="mt-4 rounded-xl border border-hairline bg-surfacealt p-3">
            <p className="whitespace-pre-wrap text-sm leading-6 text-ink">
              {selectedNotification.message || selectedNotification.body || 'No message content was attached to this notification.'}
            </p>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {getNotificationRoute(selectedNotification) ? (
              <button
                onClick={handleNotificationView}
                className="rounded-full bg-seal px-4 py-2 font-mono text-xs font-semibold text-surface hover:bg-seal-deep"
              >
                View
              </button>
            ) : (
              <button
                onClick={closeNotificationDetail}
                className="rounded-full bg-seal px-4 py-2 font-mono text-xs font-semibold text-surface hover:bg-seal-deep"
              >
                Close
              </button>
            )}
            <button
              onClick={closeNotificationDetail}
              className="rounded-full border border-hairline px-4 py-2 font-mono text-xs text-ink hover:border-marigold-deep hover:text-marigold-deep"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
