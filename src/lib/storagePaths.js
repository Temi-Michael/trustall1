// Returns the object path inside `bucket` for a stored value that is either a
// plain path or an old public URL (…/storage/v1/object/public/<bucket>/<path>).
export function storagePathFromUrl(value, bucket) {
  const text = String(value ?? '')
  if (!/^https?:\/\//i.test(text)) return text
  const marker = `/object/public/${bucket}/`
  const index = text.indexOf(marker)
  if (index === -1) return ''
  return decodeURIComponent(text.slice(index + marker.length).split('?')[0])
}
