// Helpers that keep user input as plain data, never as query syntax or paths.

// like/ilike treat % and _ as wildcards (PostgREST also turns * into %), and \
// is the escape character. Escaping them makes user text match literally.
export function escapeLikePattern(value) {
  return String(value ?? '').replace(/[\\%_*]/g, (char) => `\\${char}`)
}

// Storage object names keep only letters, digits, dot, dash and underscore, so
// a file name can't add folders ("../", "/") or break the file's URL.
export function safeFileName(name, fallback = 'file') {
  const cleaned = String(name ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w.-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[._-]+/, '')
    .slice(-100)
  return cleaned || fallback
}
