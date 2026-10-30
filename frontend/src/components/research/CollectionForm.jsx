import { useState } from "react";
import { researchError } from "../../../lib/researchApi";

export default function CollectionForm({ initial = {}, mutation, onSave, onCancel }) {
  const [validation, setValidation] = useState("");
  async function submit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const values = Object.fromEntries(["title", "description", "timePeriod", "imageUrl"].map(field => [field, String(form.get(field) || "").trim()]));
    if (!values.title) return setValidation("Enter a collection title.");
    if (values.imageUrl) {
      try { if (!["http:", "https:"].includes(new URL(values.imageUrl).protocol)) throw new Error(); }
      catch { return setValidation("Use an HTTP or HTTPS image URL."); }
    }
    setValidation("");
    await onSave(values);
  }
  return <form onSubmit={submit} className="card bg-base-200 shadow-sm"><div className="card-body gap-3">
    <h2 className="card-title">{initial.id ? "Edit collection" : "New collection"}</h2>
    <label className="form-control"><span className="label-text mb-1">Title</span><input name="title" defaultValue={initial.title || ""} maxLength={200} required className="input input-bordered w-full" /></label>
    <label className="form-control"><span className="label-text mb-1">Description</span><textarea name="description" defaultValue={initial.description || ""} maxLength={4000} className="textarea textarea-bordered w-full" /></label>
    <label className="form-control"><span className="label-text mb-1">Time period</span><input name="timePeriod" defaultValue={initial.timePeriod || ""} maxLength={200} className="input input-bordered w-full" /></label>
    <label className="form-control"><span className="label-text mb-1">Image URL (optional)</span><input name="imageUrl" type="url" maxLength={2048} defaultValue={initial.imageUrl || ""} className="input input-bordered w-full" /></label>
    {validation || mutation.isError ? <p role="alert" className="text-error">{validation || researchError(mutation.error)}</p> : null}
    <div className="card-actions"><button type="submit" disabled={mutation.isPending} className="btn btn-primary">{mutation.isPending ? "Saving…" : "Save collection"}</button><button type="button" onClick={onCancel} disabled={mutation.isPending} className="btn btn-ghost">Cancel</button></div>
  </div></form>;
}
