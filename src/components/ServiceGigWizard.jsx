import { useEffect, useReducer, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { escapeLikePattern, safeFileName } from '../lib/inputSafety.js'

const STEP_NAMES = [
  'category', 'title', 'tags', 'description', 'requirements', 'packages',
  'extras', 'media', 'faq', 'attributes', 'preview_submit',
]

const STEP_LABELS = [
  'Category', 'Title', 'Tags', 'Description', 'Requirements', 'Packages',
  'Extras', 'Media', 'FAQ', 'Attributes', 'Preview',
]

const EMPTY_PACKAGE = { id: null, tier: '', name: '', description: '', price: '', delivery_days: '', revisions: '', features: [''] }
const EMPTY_REQUIREMENT = { id: null, question: '', answer_type: 'short_text', options: [''], is_required: true }
const EMPTY_EXTRA = { id: null, name: '', description: '', price: '', additional_days: '' }
const EMPTY_FAQ = { id: null, question: '', answer: '', display_order: 0 }

function blankDraft() {
  return {
    listingId: null,
    categoryId: '',
    subcategoryId: '',
    title: '',
    description: '',
    tags: [],
    tagInput: '',
    requirements: [{ ...EMPTY_REQUIREMENT }],
    packages: [
      { ...EMPTY_PACKAGE, tier: 'basic', name: 'Basic' },
      { ...EMPTY_PACKAGE, tier: 'standard', name: 'Standard' },
      { ...EMPTY_PACKAGE, tier: 'premium', name: 'Premium' },
    ],
    extras: [{ ...EMPTY_EXTRA }],
    mediaUrls: [],
    faqs: [{ ...EMPTY_FAQ }],
    attributes: {},
    currentStep: 0,
    completedSteps: 0,
    lastSavedStep: '',
  }
}

function draftReducer(state, action) {
  if (action.type === 'hydrate') return { ...blankDraft(), ...action.value }
  if (action.type === 'set') return { ...state, [action.key]: action.value }
  if (action.type === 'merge') return { ...state, ...action.value }
  if (action.type === 'reset') return blankDraft()
  return state
}

function cleanRows(rows, requiredKeys) {
  return rows.filter((row) => requiredKeys.every((key) => String(row[key] || '').trim()))
}

function normalizeOptions(value) {
  if (Array.isArray(value)) return value
  if (typeof value === 'string') return value.split(',').map((item) => item.trim()).filter(Boolean)
  return []
}

function tagSlug(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

function normalizeMediaUrls(value) {
  if (Array.isArray(value)) return value.filter(Boolean)
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) return parsed.filter(Boolean)
    } catch {
      return value ? [value] : []
    }
  }
  return []
}

function inputClass() {
  return 'w-full rounded-xl border border-hairline bg-surfacealt px-3 py-2.5 text-sm text-ink placeholder:text-muted outline-none focus:border-seal'
}

function Section({ title, children }) {
  return <div className="rounded-2xl border border-hairline bg-white p-5"><h3 className="font-display text-lg font-bold text-ink">{title}</h3><div className="mt-4 space-y-3">{children}</div></div>
}

export default function ServiceGigWizard({ session, onCancel, onPublished, existingListing = null }) {
  const [state, dispatch] = useReducer(draftReducer, undefined, blankDraft)
  const [categories, setCategories] = useState([])
  const [subcategories, setSubcategories] = useState([])
  const [categoryAttributes, setCategoryAttributes] = useState([])
  const [draft, setDraft] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    async function loadOptionsAndDraft() {
      setLoading(true)
      const [{ data: categoryRows }, { data: draftRow }] = await Promise.all([
        supabase.from('categories').select('*').order('name'),
        existingListing
          ? Promise.resolve({ data: existingListing })
          : supabase.from('listings').select('*').eq('seller_id', session.user.id).eq('product_type', 'digital_service').eq('status', 'draft').order('updated_at', { ascending: false }).limit(1).maybeSingle(),
      ])
      setCategories(categoryRows || [])
      setDraft(draftRow || null)
      setLoading(false)
    }
    loadOptionsAndDraft()
  }, [session.user.id, existingListing])

  useEffect(() => {
    if (!state.categoryId) {
      setSubcategories([])
      setCategoryAttributes([])
      return
    }
    Promise.all([
      supabase.from('subcategories').select('*').eq('category_id', state.categoryId).order('name'),
      supabase.from('category_attributes').select('*').eq('category_id', state.categoryId).order('display_order'),
    ]).then(([subcategoryResult, attributeResult]) => {
      setSubcategories(subcategoryResult.data || [])
      setCategoryAttributes(attributeResult.data || [])
    })
  }, [state.categoryId])

  function startNew() {
    dispatch({ type: 'reset' })
    setDraft(false)
    setNotice('')
  }

  async function resumeDraft() {
    if (!draft) return
    setLoading(true)
    const [tagResult, requirementResult, packageResult, extraResult, faqResult, attributeResult] = await Promise.all([
      supabase.from('listing_tags').select('tag:tag_id(id, name)').eq('listing_id', draft.id),
      supabase.from('gig_requirements').select('*').eq('listing_id', draft.id).order('created_at'),
      supabase.from('service_packages').select('*').eq('listing_id', draft.id).order('tier'),
      supabase.from('gig_extras').select('*').eq('listing_id', draft.id).order('created_at'),
      supabase.from('gig_faqs').select('*').eq('listing_id', draft.id).order('display_order'),
      supabase.from('listing_attributes').select('*').eq('listing_id', draft.id),
    ])
    const attributes = (attributeResult.data || []).reduce((result, row) => ({ ...result, [row.category_attribute_id]: row.value }), {})
    dispatch({ type: 'hydrate', value: {
      listingId: draft.id,
      categoryId: draft.category_id || '',
      subcategoryId: draft.subcategory_id || '',
      title: draft.title || '',
      description: draft.description || '',
      mediaUrls: normalizeMediaUrls(draft.images),
      tags: (tagResult.data || []).map((row) => row.tag).filter(Boolean),
      requirements: requirementResult.data?.length ? requirementResult.data : [{ ...EMPTY_REQUIREMENT }],
      packages: ['basic', 'standard', 'premium'].map((tier) => packageResult.data?.find((item) => item.tier === tier) || { ...EMPTY_PACKAGE, tier, name: tier[0].toUpperCase() + tier.slice(1) }),
      extras: extraResult.data?.length ? extraResult.data : [{ ...EMPTY_EXTRA }],
      faqs: faqResult.data?.length ? faqResult.data : [{ ...EMPTY_FAQ }],
      attributes,
      currentStep: Math.min(STEP_NAMES.indexOf(draft.last_saved_step) + 1, 10),
      completedSteps: Number(draft.completion_percentage || 0) / 100 * 11,
      lastSavedStep: draft.last_saved_step || '',
    } })
    setDraft(false)
    setLoading(false)
  }

  async function ensureListing() {
    if (state.listingId) return state.listingId
    const slug = `${String(state.title || 'service').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}-${Date.now().toString(36)}`
    const { data, error: insertError } = await supabase.from('listings').insert({
      seller_id: session.user.id,
      title: state.title.trim() || 'Untitled service',
      description: state.description.trim() || null,
      price: 0,
      category_id: state.categoryId || null,
      subcategory_id: state.subcategoryId || null,
      product_type: 'digital_service',
      status: 'draft',
      completion_percentage: 0,
      last_saved_step: STEP_NAMES[state.currentStep],
      slug,
      images: state.mediaUrls,
    }).select().single()
    if (insertError) throw insertError
    dispatch({ type: 'set', key: 'listingId', value: data.id })
    return data.id
  }

  async function syncChildRows(listingId) {
    const tagNames = state.tags.map((tag) => typeof tag === 'string' ? tag.trim() : tag.name?.trim()).filter(Boolean)
    const tagRows = []
    for (const name of tagNames) {
      const { data: existingTag, error: tagLookupError } = await supabase.from('tags').select('id, name').ilike('name', escapeLikePattern(name)).maybeSingle()
      if (tagLookupError) throw tagLookupError
      let tag = existingTag
      if (!tag) {
        const { data: createdTag, error: tagInsertError } = await supabase.from('tags').insert({ name, slug: tagSlug(name) }).select('id, name').single()
        if (tagInsertError) throw tagInsertError
        tag = createdTag
      }
      tagRows.push({ listing_id: listingId, tag_id: tag.id })
    }
    await supabase.from('listing_tags').delete().eq('listing_id', listingId)
    if (tagRows.length) {
      const { error: tagJoinError } = await supabase.from('listing_tags').insert(tagRows)
      if (tagJoinError) throw tagJoinError
    }

    const collections = [
      ['gig_requirements', cleanRows(state.requirements, ['question']), (row) => ({ listing_id: listingId, question: row.question.trim(), answer_type: row.answer_type, options: row.answer_type === 'multiple_choice' ? row.options.filter(Boolean) : [], is_required: Boolean(row.is_required) })],
      ['gig_extras', cleanRows(state.extras, ['name', 'price']), (row) => ({ listing_id: listingId, name: row.name.trim(), description: row.description.trim() || null, price: Number(row.price), additional_days: Number(row.additional_days || 0) })],
      ['gig_faqs', cleanRows(state.faqs, ['question', 'answer']), (row, index) => ({ listing_id: listingId, question: row.question.trim(), answer: row.answer.trim(), display_order: index })],
    ]
    for (const [table, rows, mapRow] of collections) {
      const { error: deleteError } = await supabase.from(table).delete().eq('listing_id', listingId)
      if (deleteError) throw deleteError
      if (rows.length) {
        const { error: insertError } = await supabase.from(table).insert(rows.map(mapRow))
        if (insertError) throw insertError
      }
    }

    const packages = state.packages.filter((row) => row.price !== '' && Number(row.price) >= 0)
    const { error: packageDeleteError } = await supabase.from('service_packages').delete().eq('listing_id', listingId)
    if (packageDeleteError) throw packageDeleteError
    if (packages.length) {
      const { error: packageInsertError } = await supabase.from('service_packages').insert(packages.map((row) => ({
        listing_id: listingId, tier: row.tier, name: row.name.trim() || row.tier, description: row.description.trim() || null,
        price: Number(row.price), delivery_days: Number(row.delivery_days || 0), revisions: Number(row.revisions || 0), features: row.features.filter(Boolean),
      })))
      if (packageInsertError) throw packageInsertError
    }

    const { error: attributeDeleteError } = await supabase.from('listing_attributes').delete().eq('listing_id', listingId)
    if (attributeDeleteError) throw attributeDeleteError
    const attributeRows = Object.entries(state.attributes).filter(([, value]) => value !== '' && value !== null && value !== undefined).map(([categoryAttributeId, value]) => ({ listing_id: listingId, category_attribute_id: categoryAttributeId, value: String(value) }))
    if (attributeRows.length) {
      const { error: attributeInsertError } = await supabase.from('listing_attributes').insert(attributeRows)
      if (attributeInsertError) throw attributeInsertError
    }
  }

  async function saveDraft(stepIndex = state.currentStep, completed = state.completedSteps) {
    const listingId = await ensureListing()
    const completion = Math.min(100, Math.round((completed / 11) * 100))
    const { error: listingError } = await supabase.from('listings').update({
      title: state.title.trim() || 'Untitled service',
      description: state.description.trim() || null,
      category_id: state.categoryId || null,
      subcategory_id: state.subcategoryId || null,
      images: state.mediaUrls,
      status: 'draft',
      completion_percentage: completion,
      last_saved_step: STEP_NAMES[stepIndex],
    }).eq('id', listingId).eq('seller_id', session.user.id)
    if (listingError) throw listingError
    await syncChildRows(listingId)
    dispatch({ type: 'merge', value: { completedSteps: completed, lastSavedStep: STEP_NAMES[stepIndex] } })
    return listingId
  }

  async function transition(direction) {
    setSaving(true)
    setError('')
    try {
      const nextStep = Math.max(0, Math.min(10, state.currentStep + direction))
      const completed = direction > 0 ? Math.max(state.completedSteps, state.currentStep + 1) : state.completedSteps
      await saveDraft(state.currentStep, completed)
      dispatch({ type: 'set', key: 'currentStep', value: nextStep })
      setNotice('Draft saved')
    } catch (saveError) {
      setError(saveError.message || 'Draft could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  async function uploadMedia(files) {
    if (!files.length) return
    setUploading(true)
    setError('')
    try {
      const listingId = await ensureListing()
      const urls = []
      for (const [index, file] of files.entries()) {
        const path = `${session.user.id}/${listingId}/${Date.now()}_${index}_${safeFileName(file.name)}`
        const { error: uploadError } = await supabase.storage.from('listing-images').upload(path, file, { upsert: true })
        if (uploadError) throw uploadError
        const { data } = supabase.storage.from('listing-images').getPublicUrl(path)
        urls.push(data.publicUrl)
      }
      dispatch({ type: 'set', key: 'mediaUrls', value: [...state.mediaUrls, ...urls] })
      const { error: mediaSaveError } = await supabase.from('listings').update({ images: [...state.mediaUrls, ...urls] }).eq('id', listingId).eq('seller_id', session.user.id)
      if (mediaSaveError) throw mediaSaveError
      setNotice('Media uploaded')
    } catch (uploadError) {
      setError(uploadError.message || 'Media upload failed.')
    } finally {
      setUploading(false)
    }
  }

  async function submit() {
    setSaving(true)
    setError('')
    try {
      const listingId = await ensureListing()
      const [{ data: listing, error: listingError }, { data: packages, error: packageError }] = await Promise.all([
        supabase.from('listings').select('category_id, title').eq('id', listingId).eq('seller_id', session.user.id).single(),
        supabase.from('service_packages').select('id').eq('listing_id', listingId),
      ])
      if (listingError) throw listingError
      if (packageError) throw packageError
      if (!listing.category_id || !listing.title?.trim() || !(packages || []).length) throw new Error('Category, title, and at least one package are required before submission.')
      const { error: submitError } = await supabase.from('listings').update({ status: 'pending_review', completion_percentage: 100, last_saved_step: 'preview_submit' }).eq('id', listingId).eq('seller_id', session.user.id)
      if (submitError) throw submitError
      setNotice('Submitted for review')
      onPublished?.()
    } catch (submitError) {
      setError(submitError.message || 'The service could not be submitted.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="mt-6 rounded-2xl border border-hairline bg-white p-6 text-sm text-muted">Checking for service drafts…</div>
  if (draft === null) {
    return <div className="mt-6 rounded-2xl border border-seal/30 bg-seal/5 p-6"><p className="font-mono text-xs uppercase tracking-widest text-seal">Digital service wizard</p><h3 className="mt-2 font-display text-xl font-bold text-ink">Create a service gig</h3><p className="mt-2 text-sm text-muted">Build packages, requirements, extras, FAQs, and category details in one guided flow.</p><button type="button" onClick={startNew} className="mt-5 rounded-full bg-seal px-5 py-2.5 font-mono text-xs font-semibold text-surface">Start new gig</button></div>
  }
  if (draft) {
    const editingPublished = Boolean(existingListing)
    return <div className="mt-6 rounded-2xl border border-marigold/40 bg-marigold/10 p-6"><p className="font-mono text-xs uppercase tracking-widest text-marigold-deep">{editingPublished ? 'Edit service gig' : 'Unfinished service draft'}</p><h3 className="mt-2 font-display text-xl font-bold text-ink">{editingPublished ? 'Update your published service' : `Resume draft — ${Math.round(Number(draft.completion_percentage || 0))}% complete`}</h3><div className="mt-5 flex flex-wrap gap-2"><button type="button" onClick={resumeDraft} className="rounded-full bg-seal px-5 py-2.5 font-mono text-xs font-semibold text-surface">{editingPublished ? 'Edit gig' : 'Resume draft'}</button>{!editingPublished && <button type="button" onClick={startNew} className="rounded-full border border-hairline bg-white px-5 py-2.5 font-mono text-xs font-semibold text-ink">Start new gig</button>}</div></div>
  }

  const step = state.currentStep
  const updateArray = (key, index, value) => dispatch({ type: 'set', key, value: state[key].map((row, rowIndex) => rowIndex === index ? { ...row, ...value } : row) })
  const addArrayRow = (key, template) => dispatch({ type: 'set', key, value: [...state[key], { ...template }] })
  const removeArrayRow = (key, index, template) => dispatch({ type: 'set', key, value: state[key].length === 1 ? [{ ...template }] : state[key].filter((_, rowIndex) => rowIndex !== index) })

  return (
    <div className="mt-6 rounded-2xl border border-hairline bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-mono text-xs uppercase tracking-widest text-seal">Digital service wizard</p><h3 className="mt-2 font-display text-2xl font-bold text-ink">{STEP_LABELS[step]}</h3></div><button type="button" onClick={onCancel} className="font-mono text-xs text-muted hover:text-ink">Close</button></div>
      <div className="mt-5 grid grid-cols-4 gap-1 sm:grid-cols-11">{STEP_LABELS.map((label, index) => <button type="button" key={label} onClick={() => index <= state.completedSteps && dispatch({ type: 'set', key: 'currentStep', value: index })} className={`h-2 rounded-full ${index === step ? 'bg-seal' : index < state.completedSteps ? 'bg-seal/40' : 'bg-surfacealt'}`} aria-label={label} />)}</div>
      <div className="mt-6 space-y-5">
        {step === 0 && <Section title="Choose your category"><select value={state.categoryId} onChange={(event) => dispatch({ type: 'merge', value: { categoryId: event.target.value, subcategoryId: '' } })} className={inputClass()}><option value="">Select category</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select><select value={state.subcategoryId} onChange={(event) => dispatch({ type: 'set', key: 'subcategoryId', value: event.target.value })} disabled={!state.categoryId} className={inputClass()}><option value="">Select subcategory</option>{subcategories.map((subcategory) => <option key={subcategory.id} value={subcategory.id}>{subcategory.name}</option>)}</select></Section>}
        {step === 1 && <Section title="Name your service"><input value={state.title} onChange={(event) => dispatch({ type: 'set', key: 'title', value: event.target.value })} placeholder="I will…" className={inputClass()} /></Section>}
        {step === 2 && <Section title="Add searchable tags"><div className="flex gap-2"><input value={state.tagInput} onChange={(event) => dispatch({ type: 'set', key: 'tagInput', value: event.target.value })} onKeyDown={(event) => { if (event.key === 'Enter' && state.tagInput.trim()) { event.preventDefault(); dispatch({ type: 'merge', value: { tags: [...state.tags, { name: state.tagInput.trim() }], tagInput: '' } }) } }} placeholder="Press Enter after each tag" className={inputClass()} /><button type="button" onClick={() => { if (state.tagInput.trim()) dispatch({ type: 'merge', value: { tags: [...state.tags, { name: state.tagInput.trim() }], tagInput: '' } }) }} className="rounded-xl bg-ink px-4 text-xs font-semibold text-white">Add</button></div><div className="flex flex-wrap gap-2">{state.tags.map((tag, index) => <button type="button" key={`${tag.name}-${index}`} onClick={() => dispatch({ type: 'set', key: 'tags', value: state.tags.filter((_, tagIndex) => tagIndex !== index) })} className="rounded-full bg-seal/10 px-3 py-1 text-xs text-seal">{tag.name} ×</button>)}</div></Section>}
        {step === 3 && <Section title="Describe the service"><textarea rows={8} value={state.description} onChange={(event) => dispatch({ type: 'set', key: 'description', value: event.target.value })} placeholder="Explain your process, deliverables, and what buyers should expect." className={inputClass()} /></Section>}
        {step === 4 && <Section title="Buyer requirements">{state.requirements.map((row, index) => <div key={index} className="rounded-xl border border-hairline bg-surfacealt p-3"><input value={row.question} onChange={(event) => updateArray('requirements', index, { question: event.target.value })} placeholder="What do you need from the buyer?" className={inputClass()} /><div className="mt-2 grid gap-2 sm:grid-cols-2"><select value={row.answer_type} onChange={(event) => updateArray('requirements', index, { answer_type: event.target.value })} className={inputClass()}><option value="short_text">Short text</option><option value="long_text">Long text</option><option value="multiple_choice">Multiple choice</option><option value="file_upload">File upload</option></select><label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" checked={row.is_required} onChange={(event) => updateArray('requirements', index, { is_required: event.target.checked })} /> Required</label></div>{row.answer_type === 'multiple_choice' && <input value={row.options.join(', ')} onChange={(event) => updateArray('requirements', index, { options: event.target.value.split(',').map((item) => item.trim()) })} placeholder="Options separated by commas" className={`${inputClass()} mt-2`} />}<button type="button" onClick={() => removeArrayRow('requirements', index, EMPTY_REQUIREMENT)} className="mt-2 text-xs text-marigold-deep">Remove</button></div>)}<button type="button" onClick={() => addArrayRow('requirements', EMPTY_REQUIREMENT)} className="text-xs font-semibold text-seal">+ Add requirement</button></Section>}
        {step === 5 && <Section title="Set your packages">{state.packages.map((row, index) => <div key={row.tier} className="rounded-xl border border-hairline bg-surfacealt p-4"><p className="font-mono text-xs uppercase tracking-widest text-seal">{row.tier}</p><div className="mt-3 grid gap-2 sm:grid-cols-2"><input value={row.name} onChange={(event) => updateArray('packages', index, { name: event.target.value })} placeholder="Package name" className={inputClass()} /><input type="number" min="0" value={row.price} onChange={(event) => updateArray('packages', index, { price: event.target.value })} placeholder="Price (₦)" className={inputClass()} /><textarea value={row.description} onChange={(event) => updateArray('packages', index, { description: event.target.value })} placeholder="Package description" rows={2} className={inputClass()} /><input type="number" min="0" value={row.delivery_days} onChange={(event) => updateArray('packages', index, { delivery_days: event.target.value })} placeholder="Delivery days" className={inputClass()} /><input type="number" min="0" value={row.revisions} onChange={(event) => updateArray('packages', index, { revisions: event.target.value })} placeholder="Revisions" className={inputClass()} /><input value={row.features.join(', ')} onChange={(event) => updateArray('packages', index, { features: event.target.value.split(',').map((item) => item.trim()) })} placeholder="Features separated by commas" className={inputClass()} /></div>{row.tier !== 'basic' && <p className="mt-2 text-xs text-muted">Leave price blank to skip this tier.</p>}</div>)}</Section>}
        {step === 6 && <Section title="Offer extras">{state.extras.map((row, index) => <div key={index} className="grid gap-2 rounded-xl border border-hairline bg-surfacealt p-3 sm:grid-cols-2"><input value={row.name} onChange={(event) => updateArray('extras', index, { name: event.target.value })} placeholder="Extra name" className={inputClass()} /><input type="number" min="0" value={row.price} onChange={(event) => updateArray('extras', index, { price: event.target.value })} placeholder="Price (₦)" className={inputClass()} /><input value={row.description} onChange={(event) => updateArray('extras', index, { description: event.target.value })} placeholder="Description" className={inputClass()} /><input type="number" min="0" value={row.additional_days} onChange={(event) => updateArray('extras', index, { additional_days: event.target.value })} placeholder="Additional days" className={inputClass()} /><button type="button" onClick={() => removeArrayRow('extras', index, EMPTY_EXTRA)} className="text-left text-xs text-marigold-deep">Remove</button></div>)}<button type="button" onClick={() => addArrayRow('extras', EMPTY_EXTRA)} className="text-xs font-semibold text-seal">+ Add extra</button></Section>}
        {step === 7 && <Section title="Add media"><input type="file" accept="image/*,video/*" multiple onChange={(event) => uploadMedia(Array.from(event.target.files || []))} className="w-full text-sm text-muted" />{uploading && <p className="text-xs text-muted">Uploading…</p>}<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{state.mediaUrls.map((url) => <img key={url} src={url} alt="Service media" className="aspect-square rounded-xl object-cover" />)}</div></Section>}
        {step === 8 && <Section title="Answer common questions">{state.faqs.map((row, index) => <div key={index} className="rounded-xl border border-hairline bg-surfacealt p-3"><input value={row.question} onChange={(event) => updateArray('faqs', index, { question: event.target.value })} placeholder="Question" className={inputClass()} /><textarea value={row.answer} onChange={(event) => updateArray('faqs', index, { answer: event.target.value })} placeholder="Answer" rows={3} className={`${inputClass()} mt-2`} /><button type="button" onClick={() => removeArrayRow('faqs', index, EMPTY_FAQ)} className="mt-2 text-xs text-marigold-deep">Remove</button></div>)}<button type="button" onClick={() => addArrayRow('faqs', EMPTY_FAQ)} className="text-xs font-semibold text-seal">+ Add FAQ</button></Section>}
        {step === 9 && <Section title="Category-specific details">{categoryAttributes.length === 0 && <p className="text-sm text-muted">No additional attributes are configured for this category.</p>}{categoryAttributes.map((attribute) => <label key={attribute.id} className="block text-sm font-semibold text-ink">{attribute.label || attribute.name}{attribute.is_required ? ' *' : ''}{attribute.attribute_type === 'boolean' ? <input type="checkbox" checked={Boolean(state.attributes[attribute.id])} onChange={(event) => dispatch({ type: 'set', key: 'attributes', value: { ...state.attributes, [attribute.id]: event.target.checked } })} className="ml-3" /> : attribute.attribute_type === 'select' ? <select value={state.attributes[attribute.id] || ''} onChange={(event) => dispatch({ type: 'set', key: 'attributes', value: { ...state.attributes, [attribute.id]: event.target.value } })} className={`${inputClass()} mt-1`}><option value="">Select</option>{normalizeOptions(attribute.options).map((option) => <option key={option} value={option}>{option}</option>)}</select> : <input type={attribute.attribute_type === 'number' ? 'number' : 'text'} value={state.attributes[attribute.id] || ''} onChange={(event) => dispatch({ type: 'set', key: 'attributes', value: { ...state.attributes, [attribute.id]: event.target.value } })} className={`${inputClass()} mt-1`} />}</label>)}</Section>}
        {step === 10 && <Section title="Review and submit"><div className="space-y-3 text-sm text-muted"><p><strong className="text-ink">Title:</strong> {state.title || 'Not set'}</p><p><strong className="text-ink">Category:</strong> {categories.find((category) => category.id === state.categoryId)?.name || 'Not set'}</p><p><strong className="text-ink">Packages:</strong> {state.packages.filter((row) => row.price !== '').map((row) => `${row.name}: ₦${Number(row.price).toLocaleString()}`).join(' · ') || 'None'}</p><p><strong className="text-ink">Requirements:</strong> {state.requirements.filter((row) => row.question.trim()).length}</p><p><strong className="text-ink">Extras:</strong> {state.extras.filter((row) => row.name.trim()).length}</p><p><strong className="text-ink">FAQs:</strong> {state.faqs.filter((row) => row.question.trim() && row.answer.trim()).length}</p></div><button type="button" onClick={submit} disabled={saving} className="mt-5 rounded-full bg-seal px-5 py-2.5 font-mono text-xs font-semibold text-surface disabled:opacity-50">{saving ? 'Submitting…' : 'Submit for review'}</button></Section>}
      </div>
      {(error || notice) && <p className={`mt-4 text-sm ${error ? 'text-marigold-deep' : 'text-seal'}`}>{error || notice}</p>}
      <div className="mt-6 flex justify-between gap-3"><button type="button" onClick={() => transition(-1)} disabled={step === 0 || saving} className="rounded-full border border-hairline px-4 py-2 font-mono text-xs text-ink disabled:opacity-40">Back</button>{step < 10 && <button type="button" onClick={() => transition(1)} disabled={saving} className="rounded-full bg-ink px-5 py-2 font-mono text-xs font-semibold text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save & continue'}</button>}</div>
    </div>
  )
}
