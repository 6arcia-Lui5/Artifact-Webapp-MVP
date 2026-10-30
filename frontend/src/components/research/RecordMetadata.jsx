import { formatYear } from "./catalogParams";

export default function RecordMetadata({ record }) {
  const date = [formatYear(record.dateStart), formatYear(record.dateEnd)].filter(Boolean).join(" – ");
  return <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-base-content/60">
    {record.museumName ? <span>{record.museumName}</span> : null}
    {record.reviewStatus ? <span>Review: {record.reviewStatus}</span> : null}
    {record.moderationStatus ? <span>Approval: {{ pending: 'Pending approval', approved: 'Approved', changes_requested: 'Changes requested' }[record.moderationStatus] || record.moderationStatus}</span> : null}
    {record.sourceProvider ? <span>Source: {record.sourceProvider}{record.sourceObjectId ? ` · ${record.sourceObjectId}` : ""}</span> : null}
    {date ? <span>{date}</span> : null}
  </div>;
}
