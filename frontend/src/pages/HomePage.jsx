import { useCatalogLocation, useResearchRecords } from '../../hooks/useResearchCatalog'
import { PackageIcon, SparklesIcon } from 'lucide-react';
import { Link } from 'react-router';
import LoadingSpinner from '../components/LoadingSpinner';
import RecordCard from '../components/RecordCard';
import { CatalogPagination, CatalogSort, QueryError } from '../components/research/CatalogFeedback';
import RecordMetadata from '../components/research/RecordMetadata';

function HomePage() {
  const location = useCatalogLocation();
  const query = useResearchRecords(location.params);
  const records = query.data?.items || [];

  return (
    <div className='space-y-10'>
      {/* HERO */}
      <div className='hero bg-linear-to-br from-base-300 via-base-200 to-base-300 rounded-box overflow-hidden'>
        <div className='hero-content flex-col lg:flex-row-reverse gap-10 py-10 px-10'>
          <div className='relative'>
            <div className=''/>
            <img
              src="./temporaryRomanCoin.png"
              alt="Contributor Stock Image"
              className='relative h-64 w-125 lg:h-72 rounded-2xl shadow-2xl'
            />
          </div>
          <div className='text-center lg:text-left'>
            <h1 className='text-4xl lg:text-5xl font-bold leading-tight'>
              Contribute to the collection. Share your <span className='text-primary'>Artifacts</span>
            </h1>
            <p className='py-4 text-base-content/60'>
              Upload, Discover, and Connect with other contributors
            </p>
            <Link to="/create" className='btn btn-primary'>
            <SparklesIcon className='size-4' />
              Start Here
            </Link>
          </div>
        </div>
      </div>

      {/* RECORDS */}
      <div>
        <h2 className='text-xl font-bold flex items-center gap-2 mb-4'>
          <PackageIcon className='size-5 text-primary' />
          All Artifacts
        </h2>

        <div className="flex flex-wrap items-center justify-between gap-3 mb-4"><Link to="/search" className="link text-sm">Search and filter artifacts</Link><CatalogSort params={location.params} update={location.update} /></div>
        {location.dateError ? <div role="alert" className="alert alert-error">{location.dateError}<button className="btn btn-sm" onClick={location.clear}>Clear filters</button></div> : query.isPending ? <LoadingSpinner /> : query.isError ? <QueryError error={query.error} retry={() => query.refetch()} /> : records.length === 0 ? (
          <div className='card bg-base-300'>
            <div className='card-body items-center text-center py-16'>
              <PackageIcon className='size-16 text-base-content/20' />
              <h3 className='card-title text-base-content/50'>{query.data.total > 0 ? "No artifacts on this page" : "No artifact records available"}</h3>
              <p className='text-base-content/40 text-sm'>{query.data.total > 0 ? "Use Previous below to return to the catalog." : "Be the first to contribute!"}</p>
              <Link to="/create" className='btn btn-primary btn-sm mt-2'>
                Create A New Artifact Record
              </Link>
            </div>
          </div>
        ) : (
          <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4'>
            {records.map((record) => (
              <div key={record.id} className="space-y-2"><RecordCard record={record} /><RecordMetadata record={record} /></div>
            ))}
          </div>
        )}
        {!location.dateError && !query.isError ? <CatalogPagination data={query.data} params={location.params} update={location.update} /> : null}
      </div>
    </div>
  )
}

export default HomePage
