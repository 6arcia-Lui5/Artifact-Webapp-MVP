import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createRestoreSelection, getRecordHistory, ingestError, invalidateCatalog, restoreRecordRevision, safeHttpUrl, saveRecordReview } from '../../lib/ingestApi';

const displayDate = value => value && Number.isFinite(new Date(value).getTime()) ? new Date(value).toLocaleString() : 'Not recorded';
const snapshotText = value => typeof value === 'string' ? value : JSON.stringify(value, null, 2);
const publicationLabels = { pending: 'Pending approval', approved: 'Approved', changes_requested: 'Changes requested' };

export default function RecordCuration({ record, isOwner, canReadHistory = false }) {
  const client = useQueryClient();
  const [reviewStatus, setReviewStatus] = useState(null);
  const [notes, setNotes] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [restoreSelection, setRestoreSelection] = useState(null);
  const [restoreConfirmed, setRestoreConfirmed] = useState(false);
  const [saved, setSaved] = useState(null);
  const current = saved && (saved.revision == null || record.revision == null || saved.revision >= record.revision) ? saved : record;
  const hasHistoryAccess = !!(isOwner || canReadHistory);
  const history = useQuery({ queryKey: ['researchHistory', record.id], queryFn: ({ signal }) => getRecordHistory(record.id, signal), enabled: hasHistoryAccess && expanded, retry: false });
  const review = useMutation({
    retry: false,
    mutationFn: () => saveRecordReview(record.id, { reviewStatus: reviewStatus ?? current.reviewStatus ?? 'draft', notes: notes ?? current.reviewNotes ?? '' }),
    onSuccess: async result => {
      setSaved(result.record || null);
      setReviewStatus(null); setNotes(null);
      await Promise.all([invalidateCatalog(client, record.id), client.invalidateQueries({ queryKey: ['researchHistory', record.id] })]);
    },
  });
  const restore = useMutation({
    retry: false,
    mutationFn: selection => restoreRecordRevision(record.id, selection.revisionId, selection.expectedRevision),
    onSuccess: async result => {
      setRestoreSelection(null); setRestoreConfirmed(false); setSaved(result.record || null);
      setReviewStatus(null); setNotes(null);
      await Promise.all([invalidateCatalog(client, record.id), client.invalidateQueries({ queryKey: ['researchHistory', record.id] }), client.invalidateQueries({ queryKey: ['researchImages', record.id] })]);
    },
  });
  const pending = review.isPending || restore.isPending;
  const canRestore = !!isOwner && Number.isInteger(current.revision) && current.revision >= 1 && history.data?.canRestore !== false;
  return <section className="card bg-base-300"><div className="card-body space-y-4">
    <h2 className="card-title">Review and source history</h2>
    <dl className="grid sm:grid-cols-2 gap-3 text-sm">
      <div><dt className="font-semibold">Catalog approval</dt><dd>{publicationLabels[current.moderationStatus] || current.moderationStatus || 'Not recorded'}</dd></div>
      <div><dt className="font-semibold">Moderation saved</dt><dd>{displayDate(current.moderatedAt)}</dd></div>
      <div className="sm:col-span-2"><dt className="font-semibold">Moderator notes</dt><dd className="whitespace-pre-wrap break-words">{current.moderationNotes || 'Not supplied'}</dd></div>
    </dl>
    <p>Scholarly review status: <span className="font-semibold">{current.reviewStatus || 'Not recorded'}</span></p>
    <p className="text-sm text-base-content/70">Review status is a researcher’s saved assessment. Importing a museum record or running a model does not verify its contents.</p>
    <dl className="grid sm:grid-cols-2 gap-3 text-sm">
      <div><dt className="font-semibold">Source provider</dt><dd>{record.sourceProvider || 'Not recorded'}</dd></div>
      <div><dt className="font-semibold">Source object ID</dt><dd className="break-words">{record.sourceObjectId || 'Not recorded'}</dd></div>
      <div><dt className="font-semibold">Source retrieved</dt><dd>{displayDate(record.sourceRetrievedAt)}</dd></div>
      <div><dt className="font-semibold">Source page</dt><dd>{safeHttpUrl(record.sourceUrl) ? <a className="link break-all" href={safeHttpUrl(record.sourceUrl)} target="_blank" rel="noreferrer">View original source</a> : 'Not recorded'}</dd></div>
      {current.reviewedAt && <div><dt className="font-semibold">Review saved</dt><dd>{displayDate(current.reviewedAt)}</dd></div>}
    </dl>
    {current.sourceProvenance && <details><summary className="cursor-pointer text-sm">Original source provenance</summary><pre className="text-xs whitespace-pre-wrap break-words rounded bg-base-100 p-3 mt-2">{snapshotText(current.sourceProvenance)}</pre></details>}
    {isOwner && <>
      <form className="border-t border-base-content/20 pt-4 space-y-3" onSubmit={event => { event.preventDefault(); review.mutate(); }}>
        <label className="form-control space-y-1"><span>Review status</span><select className="select select-bordered w-full" value={reviewStatus ?? current.reviewStatus ?? 'draft'} disabled={pending} onChange={event => setReviewStatus(event.target.value)}><option value="draft">Draft</option><option value="reviewed">Reviewed</option><option value="uncertain">Uncertain</option></select></label>
        <label className="form-control space-y-1"><span>Review notes</span><textarea className="textarea textarea-bordered w-full" rows={4} maxLength={10000} value={notes ?? current.reviewNotes ?? ''} disabled={pending} onChange={event => setNotes(event.target.value)} /></label>
        <button className="btn btn-primary" disabled={pending}>{review.isPending ? 'Saving review...' : 'Save review'}</button>
      </form>
      {review.error && <p role="alert" className="alert alert-error">{ingestError(review.error)} Your notes have been kept.</p>}
      {review.isSuccess && !review.isPending && <p role="status">Review saved.</p>}
    </>}
    {hasHistoryAccess && (
      <div className="border-t border-base-content/20 pt-4 space-y-3">
        <button className="btn btn-outline btn-sm" aria-expanded={expanded} aria-controls={`history-${record.id}`} onClick={() => setExpanded(value => !value)}>{expanded ? 'Hide revision history' : 'Show revision history'}</button>
        {expanded && <div id={`history-${record.id}`} className="space-y-3">
          {history.isPending && <p role="status">Loading revision history...</p>}
          {history.error && <p role="alert">{history.error.response?.status === 404 ? 'Revision history is unavailable for this record.' : ingestError(history.error)} <button className="btn btn-sm" onClick={() => history.refetch()}>Retry loading history</button></p>}
          {history.data?.items?.length === 0 && <p>No recorded revisions yet.</p>}
          {history.data?.items?.map(revision => <details key={revision.id} className="bg-base-100 p-3 rounded-lg">
            <summary className="cursor-pointer break-words">{revision.action || 'Revision'}: {displayDate(revision.createdAt)}</summary>
            {revision.summary && <p className="mt-2 whitespace-pre-wrap break-words">{typeof revision.summary === 'string' ? revision.summary : snapshotText(revision.summary)}</p>}
            <p className="text-xs mt-2">Actor: {revision.actorId || 'Not recorded'}</p>
            {revision.snapshot != null ? <pre className="text-xs whitespace-pre-wrap break-words bg-base-200 p-3 my-3 rounded">{snapshotText(revision.snapshot)}</pre> : <p className="text-sm">{revision.snapshotOmitted ? 'This snapshot is too large to display. Its revision summary is shown above.' : 'No snapshot available.'}</p>}
            {canRestore && revision.snapshot != null && revision.restorable !== false && <button className="btn btn-sm btn-outline" disabled={pending} onClick={() => { setRestoreSelection(createRestoreSelection(revision.id, current)); setRestoreConfirmed(false); restore.reset(); }}>Restore this revision</button>}
            {canRestore && restoreSelection?.revisionId === revision.id && <div className="mt-3 space-y-3">
              <p className="text-sm">Restore the record’s saved fields from this revision? This creates an audited revision and checks for concurrent changes. Ownership is preserved.</p>
              <label className="flex items-start gap-2"><input type="checkbox" className="checkbox checkbox-sm" checked={restoreConfirmed} disabled={pending} onChange={event => setRestoreConfirmed(event.target.checked)} />I confirm restoring this record from the selected snapshot.</label>
              <button className="btn btn-sm btn-primary" disabled={pending || !restoreConfirmed} onClick={() => restore.mutate(restoreSelection)}>{restore.isPending ? 'Restoring...' : 'Confirm restore'}</button>
              <button className="btn btn-sm btn-ghost" disabled={pending} onClick={() => { setRestoreSelection(null); setRestoreConfirmed(false); }}>Cancel</button>
            </div>}
          </details>)}
          {isOwner && !canRestore && !!history.data?.items?.length && <p className="text-sm text-base-content/70">Restoring is unavailable without revision conflict checks.</p>}
          {isOwner && restore.error && <p role="alert" className="alert alert-error">{ingestError(restore.error)} Reload the record to check its current revision before trying again.</p>}
          {isOwner && restore.isSuccess && <p role="status">Revision restored.</p>}
        </div>}
      </div>
    )}
  </div></section>;
}
