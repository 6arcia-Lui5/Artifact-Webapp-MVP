
import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useAuth } from "@clerk/react";
import {
  ArrowLeftIcon,
  SendIcon,
  FileEditIcon,
  AlertCircleIcon,
  CheckCircleIcon,
  RotateCcwIcon,
} from "lucide-react";

import { useRecord } from "../../hooks/useRecords";
import { useObjectTypes } from "../../hooks/useObjectTypes";
import LoadingSpinner from "../components/LoadingSpinner";
import { recordFields } from "../components/recordFields";


// Convert field keys into readable labels when needed.
const formatLabel = (key) =>
  key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (letter) => letter.toUpperCase());


// Get the correct value from a record.
// Object types may be returned as a nested relation.
const getRecordValue = (record, field) => {
  if (field.key === "objectTypeId") {
    return record.objectTypeId || record.objectType?.id || "";
  }

  return record[field.key] ?? (field.type === "checkbox" ? false : "");
};


// Normalize values before comparing them.
const normalizeValue = (value) => {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  return value;
};


// Reusable field renderer
function ModificationField({
  field,
  value,
  onChange,
  objectTypes,
  objectTypesLoading,
}) {
  const {
    key,
    label,
    type,
    required,
    options,
    placeholder,
  } = field;

  const fieldLabel = label || formatLabel(key);

  return (
    <div className="form-control w-full">

      <label className="label" htmlFor={`field-${key}`}>
        <span className="label-text font-medium">
          {fieldLabel}

          {required && (
            <span className="text-error ml-1">*</span>
          )}
        </span>
      </label>

      {type === "object-type" ? (
        <select
          id={`field-${key}`}
          className="select select-bordered w-full bg-base-200"
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          disabled={objectTypesLoading}
          required={required}
        >
          <option value="">
            {objectTypesLoading
              ? "Loading object types..."
              : "Select object type..."}
          </option>

          {objectTypes.map((objectType) => (
            <option key={objectType.id} value={objectType.id}>
              {objectType.name}
            </option>
          ))}
        </select>

      ) : type === "select" ? (
        <select
          id={`field-${key}`}
          className="select select-bordered w-full bg-base-200"
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          required={required}
        >
          <option value="">Select...</option>

          {options?.map((option) => (
            <option
              key={option.value}
              value={option.value}
            >
              {option.label}
            </option>
          ))}
        </select>

      ) : type === "textarea" ? (
        <textarea
          id={`field-${key}`}
          className="textarea textarea-bordered w-full bg-base-200 min-h-28"
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder || `Enter ${fieldLabel.toLowerCase()}...`}
          required={required}
        />

      ) : type === "checkbox" ? (
        <label className="label justify-start gap-3 cursor-pointer">
          <input
            id={`field-${key}`}
            type="checkbox"
            className="checkbox checkbox-primary"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
          />

          <span className="label-text">
            {fieldLabel}
          </span>
        </label>

      ) : (
        <input
          id={`field-${key}`}
          type={type === "number" ? "number" : "text"}
          className="input input-bordered w-full bg-base-200"
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder || `Enter ${fieldLabel.toLowerCase()}...`}
          required={required}
        />
      )}

    </div>
  );
}


export default function EditRecordPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const { userId, isSignedIn, getToken } = useAuth();

  const {
    data: record,
    isLoading,
    error,
  } = useRecord(id);

  const {
    data: objectTypes = [],
    isLoading: objectTypesLoading,
  } = useObjectTypes();

  const [formData, setFormData] = useState({});
  const [initialized, setInitialized] = useState(false);

  const [submissionError, setSubmissionError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Populate the form when the existing record loads.
  useEffect(() => {
    if (!record || initialized) return;

    const initialValues = {};

    recordFields.forEach((field) => {
      initialValues[field.key] = getRecordValue(record, field);
    });

    setFormData(initialValues);
    setInitialized(true);
  }, [record, initialized]);


  // Identify publisher.
  const isOwner = userId && record?.userId === userId;

  // Identify fields that are actually different.
  const proposedChanges = useMemo(() => {
    if (!record || !initialized) return [];

    return recordFields
      .map((field) => {
        const originalValue = getRecordValue(record, field);
        const proposedValue = formData[field.key];

        if (
          JSON.stringify(normalizeValue(originalValue)) ===
          JSON.stringify(normalizeValue(proposedValue))
        ) {
          return null;
        }

        return {
          fieldKey: field.key,
          fieldLabel: field.label || formatLabel(field.key),
          originalValue: normalizeValue(originalValue),
          proposedValue: normalizeValue(proposedValue),
        };
      })
      .filter(Boolean);
  }, [record, formData, initialized]);


  const handleFieldChange = (key, value) => {
    setFormData((previous) => ({
      ...previous,
      [key]: value,
    }));
  };


  const handleReset = () => {
    if (!record) return;

    const originalValues = {};

    recordFields.forEach((field) => {
      originalValues[field.key] = getRecordValue(record, field);
    });

    setFormData(originalValues);
    setSubmissionError("");
  };


  // Submit one request containing all changed fields.
  const handleSubmit = async (e) => {
    e.preventDefault();

    setSubmissionError("");

    if (!userId || !isSignedIn) {
      setSubmissionError("You must be signed in to suggest modifications.");
      return;
    }

    if (isOwner) {
      setSubmissionError(
        "The original publisher should use the regular Edit page."
      );
      return;
    }

    if (proposedChanges.length === 0) {
      setSubmissionError("You haven't made any changes.");
      return;
    }

    try {
      setIsSubmitting(true);

      const token = await getToken();

      const response = await fetch(
        `/api/records/${id}/modifications`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...(token && {
              Authorization: `Bearer ${token}`,
            }),
          },
          body: JSON.stringify({
            changes: proposedChanges.map((change) => ({
              fieldName: change.fieldKey,
              proposedValue: change.proposedValue,
            })),
          }),
        }
      );

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          result.error || "Unable to submit modification request."
        );
      }

      navigate(`/record/${id}`, {
        state: {
          modificationSubmitted: true,
        },
      });

    } catch (error) {
      console.error("Modification submission failed:", error);

      setSubmissionError(
        error.message || "Something went wrong. Please try again."
      );
    } finally {
      setIsSubmitting(false);
    }
  };


  // Loading state
  if (isLoading || !initialized) {
    return <LoadingSpinner />;
  }


  // Record not found
  if (error || !record) {
    return (
      <div className="card bg-base-300 max-w-md mx-auto">
        <div className="card-body items-center text-center">

          <AlertCircleIcon className="size-10 text-error" />

          <h2 className="card-title text-error">
            Record not found
          </h2>

          <p className="text-sm text-base-content/60">
            The artifact you're trying to modify could not be found.
          </p>

          <Link to="/" className="btn btn-primary btn-sm">
            Return Home
          </Link>

        </div>
      </div>
    );
  }


  // Require authentication.
  if (!isSignedIn) {
    return (
      <div className="max-w-xl mx-auto card bg-base-300">
        <div className="card-body items-center text-center">

          <AlertCircleIcon className="size-10 text-warning" />

          <h2 className="card-title">
            Sign in required
          </h2>

          <p className="text-sm text-base-content/70">
            You must sign in before suggesting modifications
            to an artifact record.
          </p>

          <Link to="/login" className="btn btn-primary">
            Sign In
          </Link>

        </div>
      </div>
    );
  }


  // Original publisher should use the regular edit page.
  if (isOwner) {
    return (
      <div className="max-w-xl mx-auto card bg-base-300">
        <div className="card-body items-center text-center">

          <AlertCircleIcon className="size-10 text-warning" />

          <h2 className="card-title">
            You're the original publisher
          </h2>

          <p className="text-sm text-base-content/70">
            You can edit your own published record directly.
            Modification requests are intended for other contributors.
          </p>

          <Link
            to={`/edit/${record.id}`}
            className="btn btn-primary"
          >
            Edit Published Record
          </Link>

        </div>
      </div>
    );
  }


  // Render fields according to their existing conditions.
  const visibleFields = recordFields.filter((field) => {
    if (!field.condition) return true;

    return (
      formData[field.condition.field] === field.condition.value
    );
  });


  return (
    <main className="max-w-5xl mx-auto space-y-6">

      {/* Header */}
      <div className="space-y-3">

        <Link
          to={`/record/${record.id}`}
          className="btn btn-ghost btn-sm gap-2"
        >
          <ArrowLeftIcon className="size-4" />
          Back to Record
        </Link>

        <div className="flex items-start gap-3">

          <div className="rounded-xl bg-primary/10 p-3">
            <FileEditIcon className="size-7 text-primary" />
          </div>

          <div>
            <h1 className="text-3xl font-bold font-serif">
              Suggest Modifications
            </h1>

            <p className="text-base-content/60 mt-1">
              Propose corrections or additional information
              for this artifact record.
            </p>
          </div>

        </div>

      </div>


      {/* Explanation */}
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">

        <div className="flex items-start gap-3">

          <AlertCircleIcon className="size-5 text-primary shrink-0 mt-0.5" />

          <div className="space-y-1">

            <h2 className="font-semibold text-sm">
              Your changes will not immediately appear publicly.
            </h2>

            <p className="text-sm text-base-content/70 leading-relaxed">
              All proposed modifications will be sent together
              as one request to the original publisher.
              The publisher will review each changed field
              individually. Only approved changes will be
              applied to the published record.
            </p>

          </div>

        </div>
      </div>


      {/* Record identification */}
      <div className="card bg-base-300">

        <div className="card-body">

          <div className="flex flex-wrap items-center justify-between gap-2">

            <div>
              <p className="text-xs uppercase tracking-wide text-base-content/50">
                Record being modified
              </p>

              <h2 className="card-title text-xl mt-1">
                {record.itemName || record.title || "Untitled Artifact"}
              </h2>
            </div>

            {record.hhwIdentifier && (
              <span className="badge badge-outline">
                HHW: {record.hhwIdentifier}
              </span>
            )}

          </div>

          <p className="text-sm text-base-content/60">
            Original publisher:{" "}
            {record.user?.name || "Original publisher"}
          </p>

        </div>
      </div>


      {/* Modification form */}
      <form onSubmit={handleSubmit} className="space-y-6">

        <div className="card bg-base-300">

          <div className="card-body gap-5">

            <div>
              <h2 className="card-title text-xl">
                Artifact Information
              </h2>

              <p className="text-sm text-base-content/60 mt-1">
                The current published information is already
                filled in. Change only the fields you believe
                need correction.
              </p>
            </div>

            <div className="divider my-0"></div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-5 gap-y-4">

              {visibleFields.map((field) => (
                <div
                  key={field.key}
                  className={
                    field.type === "textarea"
                      ? "md:col-span-2"
                      : ""
                  }
                >
                  <ModificationField
                    field={field}
                    value={formData[field.key]}
                    onChange={(value) =>
                      handleFieldChange(field.key, value)
                    }
                    objectTypes={objectTypes}
                    objectTypesLoading={objectTypesLoading}
                  />
                </div>
              ))}

            </div>

          </div>
        </div>


        {/* Proposed changes preview */}
        <div className="card bg-base-300">

          <div className="card-body gap-4">

            <div className="flex flex-wrap items-center justify-between gap-2">

              <div>
                <h2 className="card-title text-xl">
                  Proposed Changes
                </h2>

                <p className="text-sm text-base-content/60 mt-1">
                  Review the differences before submitting.
                </p>
              </div>

              <span className="badge badge-primary">
                {proposedChanges.length}{" "}
                {proposedChanges.length === 1 ? "change" : "changes"}
              </span>

            </div>

            <div className="divider my-0"></div>

            {proposedChanges.length === 0 ? (
              <div className="text-center py-6 text-base-content/50">

                <CheckCircleIcon className="size-8 mx-auto mb-2" />

                <p className="text-sm">
                  No changes have been made yet.
                </p>

              </div>
            ) : (
              <div className="space-y-4">

                {proposedChanges.map((change) => (
                  <div
                    key={change.fieldKey}
                    className="rounded-xl border border-base-content/10 p-4 space-y-3"
                  >

                    <h3 className="font-semibold">
                      {change.fieldLabel}
                    </h3>

                    <div className="grid md:grid-cols-2 gap-3">

                      <div className="rounded-lg bg-base-200 p-3">
                        <p className="text-xs uppercase tracking-wide text-base-content/50 mb-2">
                          Currently Published
                        </p>

                        <p className="text-sm break-words whitespace-pre-wrap">
                          {change.originalValue === null
                            ? "Empty"
                            : String(change.originalValue)}
                        </p>
                      </div>

                      <div className="rounded-lg bg-primary/10 border border-primary/20 p-3">
                        <p className="text-xs uppercase tracking-wide text-primary mb-2">
                          Proposed Value
                        </p>

                        <p className="text-sm break-words whitespace-pre-wrap">
                          {change.proposedValue === null
                            ? "Empty"
                            : String(change.proposedValue)}
                        </p>
                      </div>

                    </div>

                  </div>
                ))}

              </div>
            )}

          </div>
        </div>


        {/* Errors */}
        {submissionError && (
          <div className="alert alert-error">

            <AlertCircleIcon className="size-5" />

            <span>{submissionError}</span>

          </div>
        )}


        {/* Actions */}
        <div className="flex flex-wrap justify-between gap-3">

          <button
            type="button"
            onClick={handleReset}
            className="btn btn-ghost gap-2"
            disabled={isSubmitting}
          >
            <RotateCcwIcon className="size-4" />
            Reset Changes
          </button>

          <div className="flex gap-2">

            <Link
              to={`/record/${record.id}`}
              className="btn btn-ghost"
            >
              Cancel
            </Link>

            <button
              type="submit"
              className="btn btn-primary gap-2"
              disabled={
                isSubmitting ||
                proposedChanges.length === 0
              }
            >
              {isSubmitting ? (
                <>
                  <span className="loading loading-spinner loading-sm" />
                  Submitting...
                </>
              ) : (
                <>
                  <SendIcon className="size-4" />
                  Submit Modification Request
                </>
              )}
            </button>

          </div>

        </div>

      </form>

    </main>
  );
}
