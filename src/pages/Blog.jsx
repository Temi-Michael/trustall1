import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient.js'
import { sanitizeHtml } from '../lib/sanitizeHtml.js'

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}

function getReadingTimeMinutes(content, excerpt = '') {
  const text = `${content || ''} ${excerpt || ''}`.replace(/<[^>]*>/g, ' ')
  const words = text.trim().split(/\s+/).filter(Boolean).length
  return Math.max(1, Math.ceil(words / 200))
}

function stripHtml(value) {
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

function RichTextEditor({ value, onChange, placeholder = 'Start writing…' }) {
  const editorRef = useRef(null)

  useEffect(() => {
    if (!editorRef.current) return
    if (editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = sanitizeHtml(value)
    }
  }, [value])

  const applyCommand = (command, valueArg) => {
    const editor = editorRef.current
    if (!editor) return
    editor.focus()
    document.execCommand(command, false, valueArg)
    onChange(editor.innerHTML)
  }

  return (
    <div className="rounded-2xl border border-hairline bg-white shadow-sm overflow-hidden">
      <div className="flex flex-wrap gap-2 border-b border-hairline bg-surfacealt p-2">
        <button type="button" onClick={() => applyCommand('bold')} className="rounded-md border border-hairline bg-white px-2 py-1 text-xs font-semibold text-ink">Bold</button>
        <button type="button" onClick={() => applyCommand('italic')} className="rounded-md border border-hairline bg-white px-2 py-1 text-xs font-semibold text-ink">Italic</button>
        <button type="button" onClick={() => applyCommand('formatBlock', 'h2')} className="rounded-md border border-hairline bg-white px-2 py-1 text-xs font-semibold text-ink">H2</button>
        <button type="button" onClick={() => applyCommand('insertUnorderedList')} className="rounded-md border border-hairline bg-white px-2 py-1 text-xs font-semibold text-ink">Bullets</button>
        <button type="button" onClick={() => applyCommand('insertOrderedList')} className="rounded-md border border-hairline bg-white px-2 py-1 text-xs font-semibold text-ink">Numbered</button>
        <button type="button" onClick={() => applyCommand('formatBlock', 'blockquote')} className="rounded-md border border-hairline bg-white px-2 py-1 text-xs font-semibold text-ink">Quote</button>
        <button
          type="button"
          onClick={() => {
            const url = window.prompt('Paste a link URL')
            if (!url) return
            applyCommand('createLink', url)
          }}
          className="rounded-md border border-hairline bg-white px-2 py-1 text-xs font-semibold text-ink"
        >
          Link
        </button>
      </div>
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={(event) => onChange(event.currentTarget.innerHTML)}
        data-placeholder={placeholder}
        className="min-h-[260px] w-full bg-white px-4 py-4 text-sm leading-7 text-ink outline-none empty:before:text-muted empty:before:content-[attr(data-placeholder)] empty:before:opacity-60"
      />
    </div>
  )
}

export function BlogList() {
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedCategory, setSelectedCategory] = useState('all')

  useEffect(() => {
    async function fetchPosts() {
      setLoading(true)
      const { data, error } = await supabase
        .from('blog_posts')
        .select('id, title, slug, excerpt, cover_image_url, category, reading_time_minutes, published_at')
        .eq('is_published', true)
        .order('published_at', { ascending: false })

      if (!error) setPosts(data || [])
      setLoading(false)
    }

    fetchPosts()
  }, [])

  const categories = useMemo(
    () => ['all', ...new Set(posts.map((post) => post.category).filter(Boolean))],
    [posts]
  )

  const filteredPosts = selectedCategory === 'all'
    ? posts
    : posts.filter((post) => post.category === selectedCategory)

  const [featured, ...rest] = filteredPosts

  return (
    <section className="mx-auto max-w-6xl px-6 py-16">
      <p className="font-mono text-xs uppercase tracking-widest text-seal">Blog</p>
      <h1 className="mt-3 font-display text-4xl font-bold text-ink">Buying and selling smarter.</h1>
      <p className="mt-3 max-w-lg text-sm text-muted">Guides, trust & safety tips, and product updates from the Trustall team.</p>

      {categories.length > 1 && (
        <div className="mt-8 flex flex-wrap gap-2">
          {categories.map((category) => (
            <button
              key={category}
              type="button"
              onClick={() => setSelectedCategory(category)}
              className={`rounded-full px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-wide transition ${
                selectedCategory === category ? 'bg-seal text-surface' : 'border border-hairline bg-white text-muted hover:text-ink'
              }`}
            >
              {category === 'all' ? 'All posts' : category}
            </button>
          ))}
        </div>
      )}

      {loading && <p className="mt-14 text-muted">Loading posts…</p>}

      {!loading && filteredPosts.length === 0 && (
        <p className="mt-14 rounded-2xl border border-hairline bg-white p-8 text-center text-muted">
          Nothing published yet — check back soon.
        </p>
      )}

      {featured && (
        <Link to={`/blog/${featured.slug}`} className="mt-12 grid gap-8 rounded-3xl border border-hairline bg-white p-8 transition hover:border-seal md:grid-cols-2">
          <div className="aspect-video rounded-2xl bg-surfacealt bg-cover bg-center md:aspect-auto" style={featured.cover_image_url ? { backgroundImage: `url(${featured.cover_image_url})` } : undefined} />
          <div className="flex flex-col justify-center">
            <p className="font-mono text-xs text-marigold-deep">Featured</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {featured.category && <span className="rounded-full bg-seal/10 px-2 py-1 font-mono text-[10px] font-semibold uppercase text-seal">{featured.category}</span>}
              <span className="font-mono text-[10px] text-muted">{featured.reading_time_minutes || 4} min read</span>
            </div>
            <h2 className="mt-3 font-display text-2xl text-ink">{featured.title}</h2>
            {featured.excerpt && <p className="mt-3 text-sm leading-relaxed text-muted">{featured.excerpt}</p>}
            <p className="mt-4 font-mono text-xs text-muted">
              {featured.published_at ? new Date(featured.published_at).toLocaleDateString() : 'Recently published'}
            </p>
          </div>
        </Link>
      )}

      {rest.length > 0 && (
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {rest.map((post) => (
            <Link key={post.id} to={`/blog/${post.slug}`} className="rounded-2xl border border-hairline bg-white p-5 transition hover:border-seal hover:shadow-sm">
              <div className="mb-4 aspect-video rounded-xl bg-surfacealt bg-cover bg-center" style={post.cover_image_url ? { backgroundImage: `url(${post.cover_image_url})` } : undefined} />
              <div className="flex flex-wrap items-center gap-2">
                {post.category && <span className="rounded-full bg-surfacealt px-2 py-1 font-mono text-[10px] font-semibold uppercase text-muted">{post.category}</span>}
                <span className="font-mono text-[10px] text-muted">{post.reading_time_minutes || 4} min</span>
              </div>
              <p className="mt-2 font-mono text-[10px] text-muted">{post.published_at ? new Date(post.published_at).toLocaleDateString() : 'Recently published'}</p>
              <h3 className="mt-3 font-display text-base text-ink">{post.title}</h3>
              {post.excerpt && <p className="mt-2 text-sm text-muted line-clamp-2">{post.excerpt}</p>}
            </Link>
          ))}
        </div>
      )}
    </section>
  )
}

export function BlogPost() {
  const { slug } = useParams()
  const [post, setPost] = useState(null)
  const [loading, setLoading] = useState(true)
  const trackView = useRef(false)

  useEffect(() => {
    let active = true

    async function load() {
      setLoading(true)
      const { data, error } = await supabase
        .from('blog_posts')
        .select('*')
        .eq('slug', slug)
        .eq('is_published', true)
        .single()

      if (!active) return
      setPost(error ? null : data)
      setLoading(false)
    }

    load()
    return () => { active = false }
  }, [slug])

  useEffect(() => {
    if (!post?.id || trackView.current) return
    trackView.current = true
    supabase
      .rpc('increment_blog_view', { p_post_id: post.id })
      .then(({ error: viewError }) => {
        if (viewError) console.warn('Blog view update skipped:', viewError)
      })
  }, [post?.id])

  if (loading) return <div className="px-6 py-24 text-center text-muted">Loading…</div>
  if (!post) return <div className="px-6 py-24 text-center text-muted">Post not found.</div>

  return (
    <article className="mx-auto max-w-3xl px-6 py-16">
      <Link to="/blog" className="font-mono text-xs text-muted hover:text-seal">← Back to blog</Link>

      {post.cover_image_url && (
        <div className="mt-8 aspect-[16/9] overflow-hidden rounded-3xl border border-hairline bg-surfacealt bg-cover bg-center" style={{ backgroundImage: `url(${post.cover_image_url})` }} />
      )}

      <div className="mt-8 flex flex-wrap items-center gap-2">
        {post.category && <span className="rounded-full bg-seal/10 px-2 py-1 font-mono text-[10px] font-semibold uppercase text-seal">{post.category}</span>}
        {post.tags?.map((tag) => (
          <span key={tag} className="rounded-full border border-hairline px-2 py-1 font-mono text-[10px] uppercase text-muted">#{tag}</span>
        ))}
        <span className="font-mono text-[10px] text-muted">{post.reading_time_minutes || 4} min read</span>
      </div>

      <p className="mt-4 font-mono text-xs text-muted">
        {post.published_at ? new Date(post.published_at).toLocaleDateString() : 'Recently published'}
      </p>

      <h1 className="mt-3 font-display text-3xl font-bold text-ink sm:text-5xl">{post.title}</h1>

      {post.excerpt && <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted">{post.excerpt}</p>}

      <div className="mt-10 prose prose-slate max-w-none text-base leading-8 text-ink prose-headings:font-display prose-headings:text-ink prose-p:text-ink prose-p:leading-8 prose-a:text-seal prose-strong:text-ink prose-blockquote:border-l-seal prose-blockquote:text-muted" dangerouslySetInnerHTML={{ __html: sanitizeHtml(post.content) }} />
    </article>
  )
}
