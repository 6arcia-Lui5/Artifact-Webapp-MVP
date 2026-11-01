
import React, { useState } from 'react';
import {
  ArrowLeftIcon,
  EditIcon,
  Trash2Icon,
  CalendarIcon,
  UserIcon,
  CopyIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  MapPinIcon,
  BookOpenIcon,
  FlaskConicalIcon,
  UsersIcon,
  ClockIcon,
} from 'lucide-react';

import LoadingSpinner from '../components/LoadingSpinner';
import { useAuth } from '@clerk/react';
import { useRecord, useDeleteRecord } from '../../hooks/useRecords';
import { useParams, Link, useNavigate } from 'react-router';


// Reusable detail field
const Detail = ({ label, value }) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  return (
    <div className="space-y-1">
      <p className="text-xs text-base-content/50 uppercase tracking-wide">
        {label}
      </p>

      <p className="text-sm text-base-content/80">
        {value}
      </p>
    </div>
  );
};


// Reusable section
const Section = ({ title, children }) => (
  <div className="card bg-base-300">
    <div className="card-body gap-4">
      <h2 className="card-title text-xl">{title}</h2>

      <div className="divider my-0"></div>

      <div className="grid sm:grid-cols-2 gap-4">
        {children}
      </div>
    </div>
  </div>
);


function RecordPage() {
  const { id } = useParams();
  const { userId } = useAuth();
  const navigate = useNavigate();

  const {
    data: record,
    isLoading,
    error,
  } = useRecord(id);

  const deleteMutation = useDeleteRecord(id);

  const [currentImage, setCurrentImage] = useState(0);
  const [copied, setCopied] = useState(false);

  // Delete record
  const handleDelete = (id) => {
    if (
      window.confirm(
        "Are you sure you want to permanently delete this record?"
      )
    ) {
      deleteMutation.mutate(id, {
        onSuccess: () => navigate("/")
      });
    }
  };

  // Copy record URL
  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
    } catch (err) {
      console.error("Unable to copy URL:", err);
    }
  };

  if (isLoading) {
    return <LoadingSpinner />;
  }

  if (error || !record) {
    return (
      <div className="card bg-base-300 max-w-md mx-auto">
        <div className="card-body items-center text-center">
          <h2 className="card-title text-error">
            Record not found
          </h2>

          <Link to="/" className="btn btn-primary btn-sm">
            Go Home
          </Link>
        </div>
      </div>
    );
  }

  // Identify original publisher
  const isOwner = userId === record.userId;

  // Only signed-in users who are not the publisher
  // can suggest modifications.
  const canSuggestModification = Boolean(userId) && !isOwner;

  // Supports either an images array or the existing imageUrl field.
  const images = Array.isArray(record.images)
    ? record.images
        .map(image =>
          typeof image === 'string'
            ? image
            : image?.imageUrl || image?.url || image?.sourceUrl
        )
        .filter(Boolean)
    : [];

  if (images.length === 0 && record.imageUrl) {
    images.push(record.imageUrl);
  }

  const displayedImage = images[currentImage];

  return (
    <div className="max-w-5xl mx-auto space-y-6">

      {/* Navigation and actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">

        <Link to="/" className="btn btn-ghost btn-sm gap-1">
          <ArrowLeftIcon className="size-4" />
          Back
        </Link>

        <div className="flex flex-wrap gap-2">

          {/* Original publisher actions */}
          {isOwner && (
            <>
              <Link
                to={`/edit/${record.id}`}
                className="btn btn-ghost btn-sm gap-1"
              >
                <EditIcon className="size-4" />
                Edit
              </Link>

              <button
                onClick={() => handleDelete(record.id)}
                className="btn btn-error btn-sm gap-1"
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? (
                  <span className="loading loading-spinner loading-xs" />
                ) : (
                  <Trash2Icon className="size-4" />
                )}

                Delete
              </button>
            </>
          )}

          {/* Other signed-in users */}
          {canSuggestModification && (
            <Link
              to={`/modify/${record.id}`}
              className="btn btn-primary btn-sm gap-2"
            >
              <EditIcon className="size-4" />
              Suggest an Edit
            </Link>
          )}

        </div>
      </div>


      {/* Modification explanation for contributors */}
      {canSuggestModification && (
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
          <div className="flex items-start gap-3">

            <ClockIcon className="size-5 text-primary shrink-0 mt-0.5" />

            <div>
              <p className="font-semibold text-sm">
                Help improve this record
              </p>

              <p className="text-sm text-base-content/70 mt-1 leading-relaxed">
                Notice something that could be corrected or improved?
                You can suggest modifications to this record.
                Proposed changes are intended to be reviewed by
                the original publisher before appearing in the
                public record.
              </p>
            </div>

          </div>
        </div>
      )}


      {/* Main artifact information */}
      <div className="grid lg:grid-cols-2 gap-6">

        {/* Images */}
        <div className="card bg-base-300">

          <figure className="p-4 relative">

            {displayedImage ? (
              <img
                src={displayedImage}
                alt={record.title || "Artifact"}
                className="rounded-xl w-full h-80 object-contain bg-base-200"
              />
            ) : (
              <div className="rounded-xl w-full h-80 bg-base-200 flex items-center justify-center text-base-content/50">
                No image available
              </div>
            )}

            {/* Image carousel controls */}
            {images.length > 1 && (
              <>
                <button
                  onClick={() =>
                    setCurrentImage(
                      (currentImage - 1 + images.length) % images.length
                    )
                  }
                  className="btn btn-circle btn-sm absolute left-6 top-1/2 -translate-y-1/2"
                  aria-label="Previous image"
                >
                  <ChevronLeftIcon className="size-4" />
                </button>

                <button
                  onClick={() =>
                    setCurrentImage(
                      (currentImage + 1) % images.length
                    )
                  }
                  className="btn btn-circle btn-sm absolute right-6 top-1/2 -translate-y-1/2"
                  aria-label="Next image"
                >
                  <ChevronRightIcon className="size-4" />
                </button>
              </>
            )}

          </figure>

          <div className="px-4 pb-4 flex items-center justify-between">

            <span className="text-xs text-base-content/60">
              {images.length > 0
                ? `Image ${currentImage + 1} of ${images.length}`
                : 'No images'}
            </span>

            <button
              onClick={handleCopyUrl}
              className="btn btn-ghost btn-sm gap-1"
            >
              <CopyIcon className="size-4" />
              {copied ? "Copied!" : "Copy URL"}
            </button>

          </div>
        </div>


        {/* Title and original publisher */}
        <div className="card bg-base-300">
          <div className="card-body">

            <h1 className="card-title text-2xl">
              {record.title}
            </h1>

            {record.hhw && (
              <p className="text-base text-base-content/80 leading-relaxed">
                {record.hhw}
              </p>
            )}

            <div className="flex flex-wrap gap-4 text-sm text-base-content/60 my-2">

              {record.createdAt && (
                <div className="flex items-center gap-1">
                  <CalendarIcon className="size-4" />

                  {new Date(record.createdAt).toLocaleDateString()}
                </div>
              )}

              {record.user?.name && (
                <div className="flex items-center gap-1">
                  <UserIcon className="size-4" />
                  {record.user.name}
                </div>
              )}

            </div>

            <div className="divider my-1"></div>

            {record.description && (
              <p className="text-base-content/80 leading-relaxed">
                {record.description}
              </p>
            )}

            {/* Original publisher */}
            {record.user && (
              <>
                <div className="divider my-2"></div>

                <div className="flex items-center gap-3">

                  <div className="avatar">
                    <div className="w-12 rounded-full ring ring-primary ring-offset-base-100 ring-offset-2">

                      {record.user.imageUrl ? (
                        <img
                          src={record.user.imageUrl}
                          alt={record.user.name || "Publisher"}
                        />
                      ) : (
                        <div className="bg-base-200 w-full h-full" />
                      )}

                    </div>
                  </div>

                  <div>
                    <p className="font-semibold">
                      {record.user.name}
                    </p>

                    <p className="text-xs text-base-content/50">
                      Original Publisher
                    </p>
                  </div>

                </div>
              </>
            )}

          </div>
        </div>

      </div>


      {/* Identification and collection */}
      <Section title="Identification">
        <Detail label="Classification" value={record.classification} />
        <Detail label="Object Type" value={record.objectType?.name} />
        <Detail label="Department" value={record.department} />
        <Detail label="Credit" value={record.credit} />
        <Detail label="Collection" value={record.collection} />
      </Section>


      {/* Date and production */}
      <Section title="Date and Production">
        <Detail label="Date" value={record.date} />
        <Detail label="Date Published" value={record.publicationDate} />
        <Detail label="Basis for Date" value={record.dateBasis} />
        <Detail label="Place of Production" value={record.productionLocation} />
      </Section>


      {/* Museum information */}
      <Section title="Museum Information">
        <Detail label="Museum" value={record.museumName} />
        <Detail label="Museum ID" value={record.museumId} />
      </Section>


      {/* Materials and dimensions */}
      <Section title="Physical Characteristics">
        <Detail label="Material" value={record.material} />
        <Detail label="Dimensions" value={record.dimensions} />
        <Detail label="Technique" value={record.technique} />
      </Section>


      {/* Inscription */}
      {record.inscription && (
        <Section title="Inscription">
          <Detail label="Inscription" value={record.inscription} />
        </Section>
      )}


      {/* Scientific testing */}
      {record.scientificTesting && (
        <Section title="Scientific Testing">
          <Detail
            label="Testing Information"
            value={record.scientificTesting}
          />
        </Section>
      )}


      {/* Bibliography */}
      {record.bibliography && (
        <Section title="Bibliography">
          <Detail
            label="Sources and References"
            value={record.bibliography}
          />
        </Section>
      )}


      {/* Contributors */}
      {Array.isArray(record.contributors) &&
        record.contributors.length > 0 && (
          <div className="card bg-base-300">
            <div className="card-body">

              <div className="flex items-center gap-2">
                <UsersIcon className="size-5 text-primary" />

                <h2 className="card-title text-xl">
                  Contributors
                </h2>
              </div>

              <p className="text-sm text-base-content/60">
                People who have contributed approved modifications
                to this record.
              </p>

              <div className="divider my-0"></div>

              <div className="space-y-3">

                {record.contributors.map((contributor, index) => (
                  <div
                    key={contributor.id || index}
                    className="flex items-center gap-3"
                  >

                    <div className="avatar placeholder">
                      <div className="w-10 rounded-full bg-primary/10 text-primary">
                        <UserIcon className="size-5" />
                      </div>
                    </div>

                    <div>
                      <p className="font-medium text-sm">
                        {contributor.user?.name ||
                          contributor.name ||
                          "Contributor"}
                      </p>

                      {contributor.createdAt && (
                        <p className="text-xs text-base-content/50">
                          Contributed{" "}
                          {new Date(
                            contributor.createdAt
                          ).toLocaleDateString()}
                        </p>
                      )}
                    </div>

                  </div>
                ))}

              </div>
            </div>
          </div>
        )}


      {/* Modification history */}
      {Array.isArray(record.modificationHistory) &&
        record.modificationHistory.length > 0 && (
          <div className="card bg-base-300">
            <div className="card-body">

              <h2 className="card-title text-xl">
                Version History
              </h2>

              <p className="text-sm text-base-content/60">
                A history of approved changes made to this record.
              </p>

              <div className="divider my-0"></div>

              <div className="space-y-4">

                {record.modificationHistory.map((revision, index) => (
                  <div
                    key={revision.id || index}
                    className="border-l-2 border-primary pl-4"
                  >

                    <p className="font-medium text-sm">
                      {revision.description || "Record updated"}
                    </p>

                    <p className="text-xs text-base-content/60">
                      {revision.user?.name || "Contributor"}

                      {revision.createdAt &&
                        ` • ${new Date(
                          revision.createdAt
                        ).toLocaleDateString()}`}
                    </p>

                  </div>
                ))}

              </div>
            </div>
          </div>
        )}

    </div>
  );
}

export default RecordPage;
