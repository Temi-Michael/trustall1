import { useEffect } from 'react'

const SITE_ORIGIN = (import.meta.env.VITE_PUBLIC_SITE_URL || 'https://trustall.online').replace(/\/$/, '')
const DEFAULT_IMAGE = 'https://images.unsplash.com/photo-1563013544-824ae1b704d3?auto=format&fit=crop&w=1200&q=85'

function setMeta(attribute, key, content) {
  let element = document.head.querySelector(`meta[${attribute}="${key}"]`)
  if (!element) {
    element = document.createElement('meta')
    element.setAttribute(attribute, key)
    document.head.appendChild(element)
  }
  element.setAttribute('content', content)
}

export default function Seo({
  title,
  description,
  path = '/',
  image = DEFAULT_IMAGE,
  type = 'website',
  noindex = false,
  structuredData,
}) {
  useEffect(() => {
    const canonicalUrl = new URL(path, `${SITE_ORIGIN}/`).toString()
    const imageUrl = /^https?:\/\//i.test(image) ? image : new URL(image, `${SITE_ORIGIN}/`).toString()
    document.title = title
    setMeta('name', 'description', description)
    setMeta('name', 'robots', noindex ? 'noindex,nofollow' : 'index,follow')
    setMeta('property', 'og:type', type)
    setMeta('property', 'og:title', title)
    setMeta('property', 'og:description', description)
    setMeta('property', 'og:url', canonicalUrl)
    setMeta('property', 'og:image', imageUrl)
    setMeta('name', 'twitter:card', 'summary_large_image')
    setMeta('name', 'twitter:title', title)
    setMeta('name', 'twitter:description', description)
    setMeta('name', 'twitter:image', imageUrl)

    let canonical = document.head.querySelector('link[rel="canonical"]')
    if (!canonical) {
      canonical = document.createElement('link')
      canonical.rel = 'canonical'
      document.head.appendChild(canonical)
    }
    canonical.href = canonicalUrl

    let schema = document.getElementById('trustall-page-schema')
    if (!structuredData) {
      schema?.remove()
      return
    }
    if (!schema) {
      schema = document.createElement('script')
      schema.id = 'trustall-page-schema'
      schema.type = 'application/ld+json'
      document.head.appendChild(schema)
    }
    schema.textContent = JSON.stringify(structuredData)
  }, [title, description, path, image, type, noindex, structuredData])

  return null
}