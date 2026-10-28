#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js'

async function main() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in env')
    process.exit(1)
  }
  const supabase = createClient(url, key)
  const buckets = [
    { name: 'avatars', public: true },
    { name: 'message-attachments', public: false },
  ]
  for (const b of buckets) {
    try {
      const { data, error } = await supabase.storage.getBucket(b.name)
      if (error && error.message && error.message.match(/not found/i)) {
        console.log(`Creating bucket: ${b.name}`)
        const { data: created, error: createErr } = await supabase.storage.createBucket(b.name, { public: b.public })
        if (createErr) console.error('Failed to create bucket', b.name, createErr)
        else console.log('Created', created.name)
      } else if (error) {
        console.error('Error checking bucket', b.name, error)
      } else {
        console.log('Bucket exists:', b.name)
      }
    } catch (e) {
      console.error('Unexpected error for bucket', b.name, e)
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
