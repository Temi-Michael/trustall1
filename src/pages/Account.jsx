import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { Bookmark, CircleHelp, ClipboardList, Clock3, Upload } from 'lucide-react'
import { useRole } from '../lib/RoleContext.jsx'
import { supabase } from '../lib/supabaseClient.js'
import { safeFileName } from '../lib/inputSafety.js'

async function uploadAvatar(file, userId) {
  if (!file || !userId) return null
  const path = `${userId}/${Date.now()}-${safeFileName(file.name)}`
  const { error } = await supabase.storage.from('avatars').upload(path, file, { upsert: true })
  if (error) throw error
  return supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl
}

export default function Account() {
  const { session, profile, loading, isSeller } = useRole()
  const navigate = useNavigate()
  const [avatarPreview, setAvatarPreview] = useState(profile?.avatar_url || null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setAvatarPreview(profile?.avatar_url || null)
  }, [profile?.avatar_url])

  useEffect(() => {
    if (!loading && !session) navigate('/auth', { state: { redirectTo: '/account' } })
  }, [loading, session, navigate])

  async function handleAvatarChange(event) {
    const file = event.target.files?.[0]
    if (!file || !session?.user?.id) return

    const previewUrl = URL.createObjectURL(file)
    setAvatarPreview(previewUrl)
    setError('')
    setUploading(true)

    try {
      const avatarUrl = await uploadAvatar(file, session.user.id)
      const { data, error: updateError } = await supabase
        .from('profiles')
        .update({ avatar_url: avatarUrl })
        .eq('id', session.user.id)
        .select()
        .single()
      if (updateError) throw updateError
      URL.revokeObjectURL(previewUrl)
      setAvatarPreview(data.avatar_url || avatarUrl)
      window.location.reload()
    } catch (uploadError) {
      URL.revokeObjectURL(previewUrl)
      setAvatarPreview(profile?.avatar_url || null)
      setError(uploadError.message || 'Unable to update your profile photo.')
    } finally {
      setUploading(false)
      event.target.value = ''
    }
  }

  if (loading || !profile) return <div className="px-6 py-24 text-center text-muted">Loading your profile…</div>
  if (!session) return <div className="px-6 py-24 text-center text-muted">Redirecting to sign in…</div>
  if (isSeller) return <Navigate replace to={`/seller/${encodeURIComponent(profile.handle || profile.id)}`} />

  const displayName = profile.full_name || profile.business_name || 'Your profile'
  const initials = displayName.slice(0, 2).toUpperCase()

  return (
    <section className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-14">
      <div className="border-b border-hairline pb-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.26em] text-seal">Buyer account</p>
        <h1 className="mt-2 font-display text-3xl font-bold text-ink">My profile</h1>
        <p className="mt-2 text-sm text-muted">Your account, saved finds, and purchase activity in one place.</p>
      </div>

      <div className="mt-7 grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section className="rounded-[24px] border border-hairline bg-white p-5 sm:p-7">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
            <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-full bg-seal/10 font-display text-2xl font-bold text-seal ring-4 ring-seal/5">
              {avatarPreview ? <img src={avatarPreview} alt={displayName} className="h-full w-full object-cover" /> : initials}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="font-display text-xl font-bold text-ink">{displayName}</h2>
              <p className="mt-1 break-all text-sm text-muted">{session.user.email}</p>
              <p className="mt-1 font-mono text-xs text-muted">{profile.handle ? `@${profile.handle}` : 'Buyer on Trustall'}</p>
            </div>
            <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-full bg-seal px-5 py-3 text-sm font-semibold text-white transition hover:bg-seal-deep sm:self-center">
              <Upload size={16} aria-hidden="true" />
              {uploading ? 'Uploading…' : 'Change photo'}
              <input type="file" accept="image/*" onChange={handleAvatarChange} disabled={uploading} className="sr-only" />
            </label>
          </div>
          {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}

          <div className="mt-7 grid gap-3 border-t border-hairline pt-5 sm:grid-cols-2">
            <div className="rounded-xl bg-surfacealt/70 p-4">
              <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted">Name</p>
              <p className="mt-1 text-sm font-semibold text-ink">{profile.full_name || 'Add your name'}</p>
            </div>
            <div className="rounded-xl bg-surfacealt/70 p-4">
              <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted">Location</p>
              <p className="mt-1 text-sm font-semibold text-ink">{profile.state || 'Location not set'}</p>
            </div>
          </div>
        </section>

        <aside className="space-y-3">
          <Link to="/orders" className="flex items-center gap-3 rounded-2xl border border-hairline bg-white p-4 text-ink transition hover:border-seal/40">
            <ClipboardList className="text-seal" size={19} aria-hidden="true" />
            <span><span className="block text-sm font-semibold">Orders</span><span className="block text-xs text-muted">Track deliveries and order status</span></span>
          </Link>
          <Link to="/saved" className="flex items-center gap-3 rounded-2xl border border-hairline bg-white p-4 text-ink transition hover:border-seal/40">
            <Bookmark className="text-seal" size={19} aria-hidden="true" />
            <span><span className="block text-sm font-semibold">Saved listings</span><span className="block text-xs text-muted">Your bookmarked products and services</span></span>
          </Link>
          <Link to="/browse" className="flex items-center gap-3 rounded-2xl border border-hairline bg-white p-4 text-ink transition hover:border-seal/40">
            <Clock3 className="text-seal" size={19} aria-hidden="true" />
            <span><span className="block text-sm font-semibold">Recently viewed</span><span className="block text-xs text-muted">Pick up where you left off</span></span>
          </Link>
          <Link to="/how-it-works" className="flex items-center gap-3 rounded-2xl border border-hairline bg-white p-4 text-ink transition hover:border-seal/40">
            <CircleHelp className="text-seal" size={19} aria-hidden="true" />
            <span><span className="block text-sm font-semibold">How Trustall works</span><span className="block text-xs text-muted">A simple guide to safe buying</span></span>
          </Link>
        </aside>
      </div>
    </section>
  )
}
