import { lazy, Suspense, useState } from "react";
import { Link } from "react-router";
import { recordFields } from "./recordFields";
import ArtifactImage from "./ArtifactImage";
import { useObjectTypes, useCreateObjectType } from "../../hooks/useObjectTypes";
import { addPhotoDraft } from "../../lib/inscriptionDrafts";
import { hasIncompleteMetadata, prepareRecordDraft, prepareInscriptionDraft } from "../../lib/recordDraft";

const PhotoTranscription = lazy(() => import('./photoTranscription/PhotoTranscription'));
const editableFields = [...recordFields,
  { key: 'dateStart', label: 'Start year (negative for BCE)', type: 'number' },
  { key: 'dateEnd', label: 'End year (negative for BCE)', type: 'number' },
];

const groups = [
  ["Identification", ["itemName", "hhwIdentifier", "objectTypeId"]],
  ["Museum", ["museumName", "museumDepartment", "museumCity", "museumCountry", "museumNumber", "museumDescription"]],
  ["Dating and provenance", ["dateCulturePeriod", "dateStart", "dateEnd", "datingBasis", "issuingAuthority", "productionPlace", "findspot", "acquisitionDate", "excavationInformation"]],
  ["Physical description", ["materials", "technique", "dimensions", "thickness", "weight", "scientificTesting"]],
  ["Inscriptions", ["inscribed"]],
  ["Images and sources", ["imagery", "imageryDescription", "imageryInscriptionPlacement", "imageSourceUrl", "imageType", "bibliography", "imageCopyrightDetails"]],
];
const fieldsByKey = new Map(editableFields.map(field => [field.key, field]));
const blankInscription = () => ({
  clientKey: crypto.randomUUID(), content: "", language: "", script: "", translation: "",
  serifsPresent: false, stopmarksPresent: false,
});

function ObjectTypeInput({ value, onChange, required }) {
  const { data: types = [], isLoading, isError, refetch } = useObjectTypes();
  const create = useCreateObjectType();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const selected = types.find(type => type.id === value);
  const matches = types.filter(type => type.name.toLowerCase().includes(query.toLowerCase()));
  const select = type => { onChange(type.id); setQuery(""); setOpen(false); };
  return <div className="relative">
    <input id="artifact-objectTypeId" aria-label="Object Type" className="input input-bordered w-full"
      placeholder={isLoading ? "Loading object types..." : "Search or enter object type..."}
      value={selected ? selected.name : query} required={required} disabled={isLoading || create.isPending || isError}
      onFocus={() => setOpen(true)} onKeyDown={event => { if (event.key === "Escape") setOpen(false); }}
      onChange={event => { setQuery(event.target.value); onChange(""); setOpen(true); }} />
    <p className="text-xs text-base-content/60 mt-1">Object type names are shared with other approved researchers.</p>
    {isError && <p role="alert" className="text-error mt-2">Object types could not load. <button type="button" className="link" onClick={() => refetch()}>Try again</button></p>}
    {open && query && <div className="absolute z-20 mt-1 w-full rounded-xl border border-base-300 bg-base-100 shadow-md p-2">
      {matches.map(type => <button key={type.id} type="button" className="block w-full rounded-lg px-3 py-2 text-left hover:bg-base-200" onClick={() => select(type)}>{type.name}</button>)}
      <button type="button" className="btn btn-sm btn-outline mt-2 w-full" disabled={create.isPending || !query.trim()}
        onClick={async () => { try { select(await create.mutateAsync(query.trim())); } catch { /* Mutation error is displayed below. */ } }}>
        {create.isPending ? "Creating..." : `+ Create "${query}"`}
      </button>
      {create.isError && <p role="alert" className="text-error mt-2">{create.error?.response?.data?.error || "Could not create this object type. Try again."}</p>}
    </div>}
  </div>;
}

export default function ArtifactForm({ record, onSubmit, pending, error, submitLabel = "Create Record", cancelTo = "/" }) {
  const [values, setValues] = useState(() => Object.fromEntries(editableFields
    .filter(field => !field.key.startsWith("inscription"))
    .map(field => [field.key, record?.[field.key] ?? (field.type === "checkbox" ? (record ? null : false) : "")])));
  const [entries, setEntries] = useState(() => (record?.inscriptions || []).map(entry => ({ ...entry, clientKey: entry.id })));
  const [preview, setPreview] = useState(null);
  const [transcribeOpen, setTranscribeOpen] = useState(false);
  const [draftMode, setDraftMode] = useState(() => hasIncompleteMetadata(record));
  const [expectedRevision] = useState(() => record?.revision);
  const change = (key, value) => {
    setValues(current => ({ ...current, [key]: value }));
    if (key === "inscribed" && value && entries.length === 0) setEntries([blankInscription()]);
  };
  const changeEntry = (clientKey, key, value) => setEntries(current => current.map(entry => entry.clientKey === clientKey ? { ...entry, [key]: value } : entry));
  const renderField = field => {
    const { key, label, type, required, placeholder, options } = field;
    const isRequired = Boolean(required && (!draftMode || key === 'itemName'));
    if (field.condition && values[field.condition.field] !== field.condition.value) return null;
    const id = `artifact-${key}`;
    const common = { id, required: isRequired, value: values[key] ?? "", onChange: event => change(key, event.target.value) };
    return <div key={key} className={`form-control min-w-0 ${type === "textarea" ? "sm:col-span-2" : ""}`}>
      <label className="label block pb-2" htmlFor={id}><span className="label-text">{label}{isRequired && <span aria-hidden="true" className="text-error ml-1">*</span>}</span></label>
      {type === "object-type" ? <ObjectTypeInput value={values[key]} onChange={value => change(key, value)} required={isRequired} />
        : type === "checkbox" && (draftMode || values[key] == null) ? <select id={id} className="select select-bordered w-full" value={values[key] == null ? '' : String(values[key])} onChange={event => change(key, event.target.value === '' ? null : event.target.value === 'true')}><option value="">Unknown</option><option value="true">Yes</option><option value="false">No</option></select>
        : type === "checkbox" ? <input id={id} type="checkbox" className="checkbox checkbox-primary" checked={Boolean(values[key])} onChange={event => change(key, event.target.checked)} />
        : type === "textarea" ? <textarea {...common} className="textarea textarea-bordered w-full min-h-24" placeholder={placeholder} />
        : type === "select" ? <select {...common} className="select select-bordered w-full"><option value="">Select...</option>{options?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
        : <input {...common} type={type} {...(type === 'number' ? { min: -1000000, max: 1000000, step: 1 } : {})} className="input input-bordered w-full" placeholder={placeholder} />}
    </div>;
  };
  return <form className="space-y-8" onSubmit={async event => {
    event.preventDefault();
    try {
      await onSubmit({ ...prepareRecordDraft(values, draftMode), ...(Number.isInteger(expectedRevision) ? { expectedRevision } : {}), inscriptions: entries.map(entry => prepareInscriptionDraft(entry, draftMode)) });
    } catch { /* Keep input and display the caller's mutation error. */ }
  }}>
    <p className="text-sm text-base-content/70">Fields marked with * are required. Optional information can be added later.</p>
    {error && <div role="alert" className="alert alert-error block space-y-2"><p>{error.response?.data?.error || "Could not save this artifact. Your entries are still here; check your connection and try again."}</p>
      {error.response?.status === 409 && <p>Your unsaved entries are still here. <Link to={cancelTo} target="_blank" rel="noopener noreferrer" className="link">Open the latest saved record</Link>, then copy any changes you need before reloading this editor.</p>}
    </div>}
    <fieldset disabled={pending} className="space-y-8 min-w-0">
      <div className="rounded-xl border border-base-300 p-4 space-y-2">
        <label className="flex items-center gap-3"><input type="checkbox" className="checkbox checkbox-sm" checked={draftMode} onChange={event => setDraftMode(event.target.checked)} />Save as a draft with incomplete metadata</label>
        <p className="text-sm text-base-content/70">Keep unknown details blank. A draft needs an item name and original text for any inscription entries. Unknown language, script and physical markings can be completed during research.</p>
      </div>
      {groups.map(([title, keys]) => <fieldset key={title} className="min-w-0 border-t border-base-300 pt-5">
        <legend className="pr-3 text-lg font-semibold">{title}</legend>
        <div className="grid gap-4 sm:grid-cols-2">{keys.map(key => renderField(fieldsByKey.get(key)))}</div>
        {title === "Inscriptions" && <div className="space-y-5 mt-4">
          <button type="button" className="btn btn-outline btn-sm" aria-expanded={transcribeOpen} aria-controls="photo-transcription-panel" onClick={() => setTranscribeOpen(open => !open)}>Transcribe a photo</button>
          {transcribeOpen && <div id="photo-transcription-panel" className="rounded-xl border border-base-300 p-4">
            <Suspense fallback={<p role="status">Loading photo transcription...</p>}>
              <PhotoTranscription imageSourceUrl={values.imageSourceUrl} full={entries.length >= 30} onAdd={draft => {
                setEntries(current => addPhotoDraft(current, draft));
                setValues(current => ({ ...current, inscribed: true }));
              }} />
            </Suspense>
          </div>}
          {!values.inscribed && entries.length > 0 && <p role="alert" className="text-error">Keep Inscribed checked, or explicitly remove the entries below before saving this artifact as not inscribed.</p>}
          {entries.map((entry, index) => <fieldset key={entry.clientKey} className="rounded-xl border border-base-300 p-4 min-w-0">
            <legend className="px-2 font-medium">Inscription {index + 1}</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              {[["content", "Original inscription text", true], ["language", "Language of inscription", true], ["script", "Script used", true], ["translation", "Translation (English)", false]].map(([key, label, required]) => {
                const id = `${entry.clientKey}-${key}`;
                const isRequired = required && (key === 'content' || !draftMode);
                return <div key={key} className={`min-w-0 ${key === "content" || key === "translation" ? "sm:col-span-2" : ""}`}>
                  <label className="label block pb-2" htmlFor={id}>{label}{isRequired ? " *" : " (optional)"}</label>
                  {key === "content" || key === "translation" ? <textarea id={id} className="textarea textarea-bordered w-full min-h-24" required={isRequired} maxLength={10000} value={entry[key] ?? ''} onChange={event => changeEntry(entry.clientKey, key, event.target.value)} />
                    : <input id={id} className="input input-bordered w-full" required={isRequired} maxLength={10000} value={entry[key] ?? ''} onChange={event => changeEntry(entry.clientKey, key, event.target.value)} />}
                </div>;
              })}
              {[["serifsPresent", "Serifs present"], ["stopmarksPresent", "Stopmarks present"]].map(([key, label]) => draftMode || entry[key] == null
                ? <label key={key} className="form-control space-y-1"><span>{label}</span><select className="select select-bordered w-full" value={entry[key] == null ? '' : String(entry[key])} onChange={event => changeEntry(entry.clientKey, key, event.target.value === '' ? null : event.target.value === 'true')}><option value="">Unknown</option><option value="true">Yes</option><option value="false">No</option></select></label>
                : <label key={key} className="flex items-center gap-3"><input type="checkbox" className="checkbox checkbox-sm" checked={entry[key]} onChange={event => changeEntry(entry.clientKey, key, event.target.checked)} />{label}</label>)}
            </div>
            <button type="button" className="btn btn-ghost btn-sm text-error mt-4" onClick={() => setEntries(current => current.filter(item => item.clientKey !== entry.clientKey))}>Remove inscription {index + 1}</button>
            <p className="text-xs text-base-content/70 mt-2">Removal takes effect when you save the artifact.</p>
          </fieldset>)}
          {values.inscribed && <>
            {entries.length === 0 && <p className="text-sm text-base-content/70">No transcription is stored. Add the original text to make this artifact available for an ML check.</p>}
            <button type="button" className="btn btn-outline btn-sm" disabled={entries.length >= 30} onClick={() => setEntries(current => [...current, blankInscription()])}>Add inscription</button>
          </>}
        </div>}
        {title === "Images and sources" && <div className="mt-4">
          <button type="button" className="btn btn-outline btn-sm" disabled={!values.imageSourceUrl} onClick={() => setPreview(values.imageSourceUrl)}>Preview image</button>
          {preview && <div className="mt-4 max-w-sm"><ArtifactImage source={preview} name={values.itemName || "Artifact preview"} className="h-48 w-full object-contain rounded-xl" /></div>}
        </div>}
      </fieldset>)}
      <div className="flex flex-wrap gap-3 border-t border-base-300 pt-5">
        <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? "Saving..." : submitLabel}</button>
        <Link className="btn btn-ghost" to={cancelTo}>Cancel</Link>
      </div>
    </fieldset>
  </form>;
}
