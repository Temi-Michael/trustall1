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

// Same rule as the database's profile_contacts_phone_format check (0032), so
// the form can say what's wrong before saving: optional +, then 7-20 digits,
// spaces, brackets or dashes.
export function isValidPhone(value) {
  return /^\+?[0-9 ()-]{7,20}$/.test(String(value ?? '').trim())
}
