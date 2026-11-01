
import { Link } from "react-router";
import {
  BookOpenIcon,
  LandmarkIcon,
  DatabaseIcon,
  SearchIcon,
  UsersIcon,
  ImageIcon,
  GraduationCapIcon,
  ArrowRightIcon,
  SparklesIcon,
  ShieldCheckIcon,
} from "lucide-react";

export default function AboutPage() {
  return (
    <main className="max-w-7xl mx-auto px-4 py-10 sm:py-14 space-y-16">

      {/* Hero Section */}
      <section className="relative overflow-hidden rounded-2xl bg-purple-950 text-secondary">
        <div className="absolute -right-20 -top-20 size-80 rounded-full bg-primary/20 blur-3xl" />
        <div className="absolute -left-20 -bottom-32 size-80 rounded-full bg-purple-800/40 blur-3xl" />

        <div className="relative grid grid-cols-1 md:grid-cols-2 gap-10 items-center p-7 sm:p-12">

          <div className="space-y-6">
            <span className="badge badge-outline border-primary text-primary gap-2">
              <SparklesIcon className="size-4" />
              About Handheld Words
            </span>

            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold font-serif leading-tight text-white">
              Preserving the stories written in history.
            </h1>

            <p className="text-base sm:text-lg text-secondary/80 leading-relaxed max-w-xl">
              Handheld Words is a digital platform dedicated to
              documenting, organizing, and exploring artifacts
              containing written inscriptions. We aim to make
              historical information more accessible through
              collaborative cataloging and technology.
            </p>

            <div className="flex flex-wrap gap-3">
              <Link to="/search" className="btn btn-primary gap-2">
                Explore the Collection
                <ArrowRightIcon className="size-4" />
              </Link>

              <Link
                to="/create"
                className="btn btn-outline border-white/30 text-white hover:bg-white/10"
              >
                Contribute an Artifact
              </Link>
            </div>
          </div>

          <div className="relative">
            <div className="rounded-2xl overflow-hidden border border-white/10 shadow-2xl bg-purple-900/50 p-3">
              <img
                src="/temporaryRomanCoin.png"
                alt="Historical coin representing the artifacts documented by Handheld Words"
                className="w-full aspect-square object-cover rounded-xl"
              />

              <div className="p-4">
                <p className="text-xs uppercase tracking-widest text-primary">
                  History in Every Detail
                </p>
                <p className="font-serif text-xl text-white mt-1">
                  Every artifact has a story worth preserving.
                </p>
              </div>
            </div>
          </div>

        </div>
      </section>

      {/* Mission */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-10 items-center">

        <div className="space-y-4">
          <span className="text-primary font-semibold uppercase tracking-widest text-sm">
            Our Mission
          </span>

          <h2 className="text-3xl sm:text-4xl font-bold font-serif">
            Connecting objects, inscriptions, and history.
          </h2>

          <p className="text-base-content/70 leading-relaxed">
            Historical artifacts can contain valuable written
            information that helps researchers understand the
            people, places, and cultures that produced them.
            However, documenting and organizing these objects
            can be challenging.
          </p>

          <p className="text-base-content/70 leading-relaxed">
            Handheld Words seeks to provide a centralized place
            where artifact images, inscription details, historical
            information, and classification records can be
            documented and explored.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">

          <div className="card bg-base-200 shadow-sm">
            <div className="card-body items-center text-center p-5">
              <ImageIcon className="size-9 text-primary" />
              <h3 className="font-bold">Document</h3>
              <p className="text-sm text-base-content/60">
                Preserve artifact images and details.
              </p>
            </div>
          </div>

          <div className="card bg-base-200 shadow-sm mt-8">
            <div className="card-body items-center text-center p-5">
              <DatabaseIcon className="size-9 text-primary" />
              <h3 className="font-bold">Organize</h3>
              <p className="text-sm text-base-content/60">
                Structure historical information.
              </p>
            </div>
          </div>

          <div className="card bg-base-200 shadow-sm">
            <div className="card-body items-center text-center p-5">
              <SearchIcon className="size-9 text-primary" />
              <h3 className="font-bold">Discover</h3>
              <p className="text-sm text-base-content/60">
                Search and explore cataloged objects.
              </p>
            </div>
          </div>

          <div className="card bg-base-200 shadow-sm mt-8">
            <div className="card-body items-center text-center p-5">
              <UsersIcon className="size-9 text-primary" />
              <h3 className="font-bold">Collaborate</h3>
              <p className="text-sm text-base-content/60">
                Share knowledge through contributions.
              </p>
            </div>
          </div>

        </div>
      </section>

      {/* What We Catalog */}
      <section className="space-y-7">

        <div className="text-center max-w-2xl mx-auto space-y-3">
          <span className="text-primary font-semibold uppercase tracking-widest text-sm">
            The Collection
          </span>

          <h2 className="text-3xl sm:text-4xl font-bold font-serif">
            What We Document
          </h2>

          <p className="text-base-content/70">
            Our platform focuses on coins and other handheld
            objects that contain written inscriptions.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">

          <div className="card bg-base-200 overflow-hidden shadow-sm">
            <figure className="h-52 bg-base-300">
              <img
                src="/temporaryRomanCoin.png"
                alt="Example of an ancient coin"
                className="w-full h-full object-cover"
              />
            </figure>

            <div className="card-body">
              <h3 className="card-title font-serif">
                Coins
              </h3>

              <p className="text-sm text-base-content/70">
                Document inscriptions, imagery, identifying
                features, and historical context associated
                with coins.
              </p>
            </div>
          </div>

          <div className="card bg-base-200 overflow-hidden shadow-sm">
            <figure className="h-52 bg-base-300 flex items-center justify-center">
              <BookOpenIcon className="size-20 text-primary/60" />
            </figure>

            <div className="card-body">
              <h3 className="card-title font-serif">
                Inscribed Objects
              </h3>

              <p className="text-sm text-base-content/70">
                Catalog other handheld objects that contain
                written inscriptions and meaningful markings.
              </p>
            </div>
          </div>

          <div className="card bg-base-200 overflow-hidden shadow-sm">
            <figure className="h-52 bg-base-300 flex items-center justify-center">
              <LandmarkIcon className="size-20 text-primary/60" />
            </figure>

            <div className="card-body">
              <h3 className="card-title font-serif">
                Historical Information
              </h3>

              <p className="text-sm text-base-content/70">
                Organize information about an object's origin,
                dating, materials, production, and inscriptions.
              </p>
            </div>
          </div>

        </div>
      </section>

      {/* How It Works */}
      <section className="rounded-2xl bg-base-200 p-6 sm:p-10 space-y-8">

        <div className="text-center max-w-2xl mx-auto space-y-3">
          <span className="text-primary font-semibold uppercase tracking-widest text-sm">
            The Process
          </span>

          <h2 className="text-3xl sm:text-4xl font-bold font-serif">
            How Handheld Words Works
          </h2>

          <p className="text-base-content/70">
            A structured approach to documenting and exploring
            historical artifacts.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">

          <div className="text-center space-y-3">
            <div className="size-14 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto">
              <ImageIcon className="size-7" />
            </div>

            <h3 className="font-bold text-lg">
              01. Contribute
            </h3>

            <p className="text-sm text-base-content/70 leading-relaxed">
              Contributors submit artifact information,
              including images, inscriptions, and relevant
              historical details.
            </p>
          </div>

          <div className="text-center space-y-3">
            <div className="size-14 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto">
              <DatabaseIcon className="size-7" />
            </div>

            <h3 className="font-bold text-lg">
              02. Organize
            </h3>

            <p className="text-sm text-base-content/70 leading-relaxed">
              Information is stored in a centralized database
              and organized into searchable artifact records.
            </p>
          </div>

          <div className="text-center space-y-3">
            <div className="size-14 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto">
              <SearchIcon className="size-7" />
            </div>

            <h3 className="font-bold text-lg">
              03. Explore
            </h3>

            <p className="text-sm text-base-content/70 leading-relaxed">
              Visitors can discover records, examine artifact
              information, and learn from the collection.
            </p>
          </div>

        </div>
      </section>

      {/* Technology */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-10 items-center">

        <div className="space-y-4">
          <span className="text-primary font-semibold uppercase tracking-widest text-sm">
            Technology and Research
          </span>

          <h2 className="text-3xl sm:text-4xl font-bold font-serif">
            Combining historical research with modern technology.
          </h2>

          <p className="text-base-content/70 leading-relaxed">
            Handheld Words brings together web development,
            database management, and machine learning to support
            artifact documentation and classification.
          </p>

          <p className="text-base-content/70 leading-relaxed">
            Our machine learning component is designed to assist
            with recognizing relevant features in artifact images
            and supporting the classification process. Its
            effectiveness depends on available training data
            and image quality.
          </p>
        </div>

        <div className="space-y-4">

          <div className="flex items-start gap-4 rounded-xl bg-base-200 p-5">
            <DatabaseIcon className="size-7 text-primary shrink-0" />

            <div>
              <h3 className="font-bold">Centralized Database</h3>
              <p className="text-sm text-base-content/70 mt-1">
                Stores artifact images, inscription details,
                historical information, and classification records.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-4 rounded-xl bg-base-200 p-5">
            <SearchIcon className="size-7 text-primary shrink-0" />

            <div>
              <h3 className="font-bold">Searchable Catalog</h3>
              <p className="text-sm text-base-content/70 mt-1">
                Makes artifact records easier to access,
                explore, and manage.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-4 rounded-xl bg-base-200 p-5">
            <GraduationCapIcon className="size-7 text-primary shrink-0" />

            <div>
              <h3 className="font-bold">Machine Learning Assistance</h3>
              <p className="text-sm text-base-content/70 mt-1">
                Supports artifact recognition and classification
                using image data.
              </p>
            </div>
          </div>

        </div>
      </section>

      {/* Community */}
      <section className="rounded-2xl bg-purple-950 text-secondary p-7 sm:p-12 text-center space-y-5">

        <div className="flex justify-center">
          <ShieldCheckIcon className="size-10 text-primary" />
        </div>

        <h2 className="text-3xl sm:text-4xl font-bold font-serif text-white">
          Help Preserve Historical Knowledge
        </h2>

        <p className="max-w-2xl mx-auto text-secondary/80 leading-relaxed">
          Every documented artifact adds another piece to
          our understanding of history. Explore the collection
          or contribute your own knowledge to help expand it.
        </p>

        <div className="flex flex-wrap justify-center gap-3 pt-2">
          <Link to="/search" className="btn btn-primary gap-2">
            Explore Collection
            <ArrowRightIcon className="size-4" />
          </Link>

          <Link
            to="/create"
            className="btn btn-outline border-white/30 text-white hover:bg-white/10"
          >
            Contribute an Artifact
          </Link>
        </div>

      </section>

    </main>
  );
}
