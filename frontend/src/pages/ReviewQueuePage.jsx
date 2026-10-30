import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getResearchAccess, getModerationQueue, moderateRecord, getResearchRoles, changeResearchRole, parseModerationParams, validateModerationDecision, validateRoleChange, moderationError } from "../../lib/moderationApi";
import { invalidateCatalog } from "../../lib/ingestApi";
import { CatalogPagination } from "../components/research/CatalogFeedback";

const statusLabels = { pending: "Pending approval", approved: "Approved", changes_requested: "Changes requested" };

function ErrorMessage({ error, retry, label = "Retry" }) {
  return <div className="alert alert-error flex flex-wrap" role="alert"><span>{moderationError(error)}</span>{retry ? <button type="button" className="btn btn-sm" onClick={retry}>{label}</button> : null}</div>;
}

function SubmissionDecision({ record, access, reload, notify }) {
  const client = useQueryClient();
  const [status, setStatus] = useState("");
  const [notes, setNotes] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [validation, setValidation] = useState("");
  const [inspectedRevision, setInspectedRevision] = useState(record.revision);
  const [reloading, setReloading] = useState(false);
  const own = record.userId === access.userId;
  const changed = record.revision !== inspectedRevision;
  const mutation = useMutation({
    mutationFn: moderateRecord,
    retry: false,
    onSuccess: async (_result, decision) => {
      notify(`${record.itemName}: ${statusLabels[decision.status].toLowerCase()}.`);
      setStatus(""); setNotes(""); setConfirmed(false);
      await Promise.all([client.invalidateQueries({ queryKey: ["researchModeration"] }), invalidateCatalog(client, record.id), client.invalidateQueries({ queryKey: ["researchHistory", record.id] })]);
    },
  });
  async function reloadLatest() {
    setReloading(true);
    try {
      const result = await reload();
      if (result.error) { setValidation(moderationError(result.error)); return; }
      const latest = result.data?.items?.find(item => item.id === record.id);
      if (latest) setInspectedRevision(latest.revision);
      setConfirmed(false); mutation.reset();
      setValidation("Latest queue loaded. Inspect the current record before confirming a decision. Your notes have been kept.");
    } finally { setReloading(false); }
  }
  function submit(event) {
    event.preventDefault();
    const problem = validateModerationDecision({ record: { ...record, revision: inspectedRevision }, access, status, notes });
    if (problem || changed || !confirmed) {
      setValidation(problem || (changed ? "This record changed. Reload and inspect the latest revision." : "Confirm that you inspected the submission before saving your decision."));
      return;
    }
    setValidation("");
    mutation.mutate({ id: record.id, status, notes: notes.trim(), expectedRevision: inspectedRevision });
  }
  const blocked = mutation.isPending || reloading;
  const conflict = mutation.error?.response?.status === 409 || changed;
  const inscriptions = record.inscriptions || [];
  return <article className="card bg-base-200 shadow-sm"><div className="card-body gap-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="card-title"><Link className="link-hover" to={`/record/${record.id}`}>{record.itemName}</Link></h2><p className="text-sm text-base-content/60">Submitted by {record.user?.name || record.userId || "Unknown contributor"}{own ? " (you)" : ""}</p></div><span className="badge badge-outline">{statusLabels[record.moderationStatus] || "Status unavailable"}</span></div>
    {record.museumDescription ? <p className="text-sm line-clamp-3">{record.museumDescription}</p> : null}
    <p className="text-sm">Scholarly assessment: {record.reviewStatus || "Not recorded"}. Editorial approval is a separate decision.</p>
    {inscriptions.length ? <div className="space-y-3"><h3 className="font-semibold text-sm">Original inscription snippets</h3>{inscriptions.slice(0, 2).map((inscription, index) => <div key={inscription.id || index} className="bg-base-100 rounded-box p-3 space-y-1"><p className="text-xs text-base-content/60">{inscription.language || "Language not supplied"} · {inscription.script || "Script not supplied"}</p><p className="whitespace-pre-wrap break-words">{inscription.content ? `${inscription.content.slice(0, 600)}${inscription.content.length > 600 ? "…" : ""}` : "Original text not supplied"}</p>{inscription.translation ? <p className="text-sm whitespace-pre-wrap break-words"><span className="font-semibold">Translation: </span>{inscription.translation.slice(0, 600)}{inscription.translation.length > 600 ? "…" : ""}</p> : null}</div>)}{inscriptions.length > 2 ? <p className="text-xs">{inscriptions.length - 2} more inscriptions are available in the full record.</p> : null}</div> : <p className="text-sm text-base-content/60">No original inscriptions supplied.</p>}
    <Link to={`/record/${record.id}`} className="link text-sm">Inspect full record and photographs</Link>
    {record.moderationNotes ? <p className="text-sm whitespace-pre-wrap break-words"><span className="font-semibold">Previous editorial notes: </span>{record.moderationNotes}</p> : null}
    <form onSubmit={submit} className="border-t border-base-content/20 pt-4 space-y-3">
      <label className="form-control space-y-1"><span>Editorial decision</span><select className="select select-bordered w-full" value={status} disabled={blocked} onChange={event => { setStatus(event.target.value); setConfirmed(false); setValidation(""); }}><option value="">Choose a decision</option><option value="approved" disabled={own && access.role !== "admin"}>Approve submission{own && access.role !== "admin" ? ". Another reviewer required" : ""}</option><option value="changes_requested">Request changes</option></select></label>
      {own ? <p className="text-sm text-base-content/70">{access.role === "admin" ? "Approving your own submission requires a documented reason in the decision notes." : "You cannot approve your own submission. Another reviewer or administrator must approve it."}</p> : null}
      <label className="form-control space-y-1"><span>Decision notes (required)</span><textarea className="textarea textarea-bordered w-full" rows={3} maxLength={10000} required value={notes} disabled={blocked} onChange={event => { setNotes(event.target.value); setConfirmed(false); }} /><span className="text-xs text-base-content/60">Write a short factual review note for approval, or explain the changes needed. An administrator approving their own submission must document the reason.</span></label>
      <label className="flex items-start gap-2"><input type="checkbox" className="checkbox checkbox-sm" checked={confirmed} disabled={blocked || conflict} onChange={event => setConfirmed(event.target.checked)} /><span className="text-sm">I inspected the full submission and confirm this editorial decision.</span></label>
      <button type="submit" className="btn btn-primary btn-sm" disabled={blocked || conflict || !status || !confirmed}>{mutation.isPending ? "Saving decision…" : status === "approved" ? "Approve submission" : status === "changes_requested" ? "Request changes" : "Save decision"}</button>
    </form>
    {validation ? <p role="status" className="text-sm">{validation}</p> : null}
    {mutation.isError ? <ErrorMessage error={mutation.error} /> : null}
    {conflict ? <div className="space-y-2"><p role="alert" className="text-sm">A fresh inspection is required before another decision.</p><button type="button" className="btn btn-sm btn-outline" disabled={blocked} onClick={reloadLatest}>{reloading ? "Reloading…" : "Reload latest queue"}</button></div> : null}
  </div></article>;
}

function RoleControl({ person, access, notify }) {
  const client = useQueryClient();
  const [role, setRole] = useState(person.role);
  const [confirmed, setConfirmed] = useState(false);
  const [validation, setValidation] = useState("");
  const mutation = useMutation({ mutationFn: changeResearchRole, retry: false, onSuccess: async () => {
    notify(`${person.name || person.email || person.userId}: role changed to ${role}.`);
    await Promise.all([client.invalidateQueries({ queryKey: ["researchRoles"] }), client.invalidateQueries({ queryKey: ["researchAccess"] })]);
  } });
  const locked = person.role === "admin" || person.userId === access.userId;
  function submit(event) {
    event.preventDefault();
    const problem = validateRoleChange({ access, target: person, role });
    if (problem || !confirmed) { setValidation(problem || "Confirm the role change before saving."); return; }
    setValidation(""); mutation.mutate({ userId: person.userId, role });
  }
  return <div className="border-t border-base-content/20 pt-3 space-y-2"><div><p className="font-semibold">{person.name || person.userId}</p>{person.email ? <p className="text-sm break-all">{person.email}</p> : null}<p className="text-xs text-base-content/60 break-all">{person.userId} · Current role: {person.role}</p></div>
    {locked ? <p className="text-sm">Administrator assignments are managed on the server. You cannot change your own role here.</p> : <form onSubmit={submit} className="flex flex-wrap items-center gap-3"><label className="flex items-center gap-2 text-sm">Role <select className="select select-bordered select-sm" value={role} disabled={mutation.isPending} onChange={event => { setRole(event.target.value); setConfirmed(false); }}><option value="contributor">Contributor</option><option value="reviewer">Trusted reviewer</option></select></label><label className="flex items-center gap-2 text-sm"><input type="checkbox" className="checkbox checkbox-sm" checked={confirmed} disabled={mutation.isPending || role === person.role} onChange={event => setConfirmed(event.target.checked)} />Confirm role change</label><button type="submit" className="btn btn-outline btn-sm" disabled={mutation.isPending || role === person.role || !confirmed}>{mutation.isPending ? "Saving…" : "Save role"}</button></form>}
    {validation ? <p role="alert" className="text-sm text-error">{validation}</p> : null}{mutation.isError ? <ErrorMessage error={mutation.error} /> : null}
  </div>;
}

function RoleManagement({ access }) {
  const [message, setMessage] = useState("");
  const roles = useQuery({ queryKey: ["researchRoles"], queryFn: ({ signal }) => getResearchRoles(signal), retry: false });
  return <section className="card bg-base-200 shadow-sm"><div className="card-body space-y-3"><h2 className="card-title">Manage trusted reviewers</h2><p className="text-sm">Trusted reviewers can approve other contributors’ submissions or request changes. Contributors submit records for approval. Administrator assignment is managed on the server.</p>{message ? <p role="status">{message}</p> : null}{roles.isPending ? <p role="status">Loading account roles…</p> : roles.isError ? <ErrorMessage error={roles.error} retry={() => roles.refetch()} /> : roles.data.items.length ? roles.data.items.map(person => <RoleControl key={`${person.userId}:${person.role}`} person={person} access={access} notify={setMessage} />) : <p>No accounts available for role management.</p>}</div></section>;
}

function ModerationQueue({ access }) {
  const [search, setSearch] = useSearchParams();
  const [message, setMessage] = useState("");
  const params = parseModerationParams(search);
  const queue = useQuery({ queryKey: ["researchModeration", params], queryFn: ({ signal }) => getModerationQueue(params, signal), retry: false });
  function update(changes) {
    const next = new URLSearchParams(search);
    for (const [key, value] of Object.entries(changes)) next.set(key, String(value));
    if (!("page" in changes)) next.set("page", "1");
    setSearch(next);
  }
  return <div className="space-y-6"><div className="flex flex-wrap items-center justify-between gap-3"><label className="flex items-center gap-2">Editorial status <select aria-label="Editorial queue status" className="select select-bordered select-sm" value={params.status} onChange={event => update({ status: event.target.value })}><option value="pending">Pending approval</option><option value="approved">Approved</option><option value="changes_requested">Changes requested</option></select></label><button type="button" className="btn btn-outline btn-sm" disabled={queue.isFetching} onClick={() => queue.refetch()}>{queue.isFetching ? "Refreshing…" : "Refresh queue"}</button></div>
    {message ? <p role="status">{message}</p> : null}
    {queue.isPending ? <p role="status">Loading submissions…</p> : queue.isError ? <ErrorMessage error={queue.error} retry={() => queue.refetch()} /> : <><p className="text-sm text-base-content/60">{queue.data.total} submissions with editorial status “{statusLabels[params.status].toLowerCase()}”.</p>{queue.data.items.length ? <div className="space-y-4">{queue.data.items.map(record => <SubmissionDecision key={record.id} record={record} access={access} reload={() => queue.refetch()} notify={setMessage} />)}</div> : <div className="card bg-base-200"><div className="card-body"><p>{queue.data.total > 0 ? "No submissions on this page. Use Previous to return to the queue." : `No ${statusLabels[params.status].toLowerCase()} submissions.`}</p></div></div>}<CatalogPagination data={queue.data} params={params} update={update} /></>}
    {access.role === "admin" && access.canManageRoles ? <RoleManagement access={access} /> : null}
  </div>;
}

export default function ReviewQueuePage() {
  const access = useQuery({ queryKey: ["researchAccess"], queryFn: ({ signal }) => getResearchAccess(signal), retry: false });
  return <div className="space-y-6"><div><h1 className="text-3xl font-bold">Submission review queue</h1><p className="text-base-content/70 mt-2">Approve submissions for the shared catalog or request changes from their contributors. Access remains limited to approved accounts. Approval does not certify an inscription or change its scholarly review status.</p></div>
    {access.isPending ? <p role="status">Checking review access…</p> : access.isError ? <ErrorMessage error={access.error} retry={() => access.refetch()} label="Reload access" /> : access.data.canReview ? <><div className="flex flex-wrap items-center gap-3 text-sm"><span>Your role: {access.data.role}</span><button type="button" className="btn btn-ghost btn-sm" disabled={access.isFetching} onClick={() => access.refetch()}>Reload access</button></div><ModerationQueue access={access.data} /></> : <div className="card bg-base-200"><div className="card-body"><h2 className="card-title">Reviewer access required</h2><p>Only trusted reviewers and administrators can moderate submissions. Your own pending submissions are available in My Records.</p><div className="card-actions"><Link to="/profile" className="btn btn-primary btn-sm">My Records</Link><button type="button" className="btn btn-sm btn-outline" onClick={() => access.refetch()}>Reload access</button></div></div></div>}
  </div>;
}
