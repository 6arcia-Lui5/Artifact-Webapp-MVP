import React from 'react'
import { ArrowLeftIcon, EditIcon, Trash2Icon, CalendarIcon, UserIcon } from 'lucide-react'
import LoadingSpinner from '../components/LoadingSpinner'
import { useAuth } from '@clerk/react'
import { useRecord, useDeleteRecord } from '../../hooks/useRecords'
import { useParams, Link, useNavigate } from 'react-router'
import { recordFields } from '../components/recordFields'
import ArtifactImage from '../components/ArtifactImage'
import { sourceUrl } from '../../lib/artifactImages'
import InscriptionDetails from '../components/InscriptionDetails'


function RecordPage() {
  const { id } = useParams();
  const { userId } = useAuth();
  const navigate = useNavigate();

  const { data: record, isLoading, error } = useRecord(id);
  const deleteMutation = useDeleteRecord(id);

  const handleDelete = (id) => {
    if (confirm("Deletes this record permanently?")){
        deleteMutation.mutate(id, {
        onSuccess: () => navigate("/")
      });
    }
  };

  if (isLoading) return <LoadingSpinner />

  if (error || !record) {
    return (
      <div className='card bg-base-300 max-w-md mx-auto'>
        <div className='card-body items-center text-center'>
          <h2 className='card-title text-error'>Records not found</h2>
          <Link to="/" className='btn btn-primary btn-sm'>
          Go Home
          </Link>
        </div>
      </div>
    );
  }

  const isOwner = userId === record.userId;


  return (
  <div className='max-w-4xl mx-auto space-y-6'>
    <div className='flex items-center justify-between'>
      <Link to="/" className='btn btn-ghost btn-sm gap-1'>
        <ArrowLeftIcon className='size-4' /> Back
      </Link>
      {isOwner && (
        <div className='flex gap-2'>
          <Link to={`/edit/${record.id}`} className='btn btn-ghost btn-sm gap-1'>
            <EditIcon className='size-4' /> Edit
          </Link>
          <button
            onClick={() => handleDelete(record.id)}
            className='btn btn-error btn-sm gap-1'
            disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? (
                <span className='loading loading-spinner loading-xs' />
              ) : (
                <Trash2Icon className='size-4'/>
              )}
              Delete
            </button>
        </div>
      )}
    </div>

    <div className='grid lg:grid-cols-2 gap-6'>
      {/* IMAGE */}
      <div className='card bg-base-300'>
        <figure className='p-4'>
          <ArtifactImage source={record.imageSourceUrl} name={record.itemName}
            className='rounded-xl w-full h-80 object-cover' />
        </figure>
        {sourceUrl(record.imageSourceUrl) && <a href={sourceUrl(record.imageSourceUrl)}
          target='_blank' rel='noreferrer' className='link px-4 pb-4'>View image source</a>}
      </div>

      <div className='card bg-base-300'>
        <div className='card-body'>
          <h1 className='card-title text-2xl'>{record.itemName}</h1>

          <div className='flex flex-wrap gap-4 text-sm text-base-content/60 my-2'>
            <div className='flex items-center gap-1'>
              <CalendarIcon className='size-4' />
              {new Date(record.createdAt).toLocaleDateString()}
            </div>
            <div className='flex flex-wrap'>
              <UserIcon className='size-4' />
              {record.user?.name}
            </div>
          </div>

          <div className='divider my-2'></div>

          <p className='text-base-content/80 leading-relaxed'>{record.museumDescription}</p>

          {record.user && (
            <>
              <div className='divider my-2'></div>
              <div className='flex items-center gap-3'>
                <div className='avatar'>
                  <div className='w-12 rounded-full ring ring-primary ring-offset-base-100 ring-offset-2'>
                    <img
                      src={record.user.imageUrl}
                      alt={record.user.name}
                    />
                  </div>
                </div>
                <div>
                  <p className='font-semibold'>{record.user.name}</p>
                  <p className='text-xs text-base-content/50'>Creator</p>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>

    <InscriptionDetails entries={record.inscriptions} />

    {/* Relevant Details */}
    <div className='card bg-base-300'>
      <div className='card-body'>
        <h1 className='card-title text-2xl font-bold'>Overview</h1>
        <div className='divider my-2'></div>
          <dl className='grid gap-3'>
            {recordFields.filter(field => !field.condition || record[field.condition.field] === field.condition.value).map(({ key, label, type }) => {
              const value = type === 'object-type' ? record.objectType?.name : record[key];
              if (value === null || value === undefined || value === '') return null;
              return <div key={key}>
                <dt className='font-semibold'>{label}</dt>
                <dd className='text-base-content/80 whitespace-pre-wrap break-words'>{typeof value === 'boolean' ? (value ? 'Yes' : 'No') : value}</dd>
              </div>;
            })}
            <div><dt className='font-semibold'>Collection</dt><dd>{record.collection?.title ?? "None"}</dd></div>
          </dl>
      </div>
    </div>
  </div>
  );
}

export default RecordPage
