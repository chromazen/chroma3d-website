import { ArrowUpRightIcon } from "@phosphor-icons/react";

const selectedWork = [
  {
    title: "Sri Mahalakshmi Devi",
    layout: "feature",
    medium: "Physical print",
    href: "/shop/mahalakshmi",
    image: "/workshop-poster.jpg",
    alt: "A hand steadies the printed sculpture on a gridded cutting mat, with loose pieces beside its lotus base.",
    width: 1280,
    height: 720,
  },
  {
    title: "Adiyogi",
    layout: "study",
    medium: "Digital sculpt",
    href: "/shop/adiyogi",
    image: "/adiyogi-store-720.webp",
    srcSet: "/adiyogi-store-720.webp 720w, /adiyogi-store-1440.webp 1440w",
    alt: "Three-quarter render of the ash-grey bust, with a crescent moon above the brow.",
    width: 720,
    height: 508,
  },
];

export default function SelectedWork() {
  return (
    <section className="selected-work" aria-labelledby="work-heading">
      <h2 id="work-heading">Selected Work</h2>
      <div className="work-gallery">
        {selectedWork.map((work) => (
          <a className={`work-entry work-entry--${work.layout}`} href={work.href} key={work.href}>
            <div className="work-image">
              <img
                src={work.image}
                srcSet={work.srcSet}
                sizes={work.srcSet ? "(max-width: 620px) 42vw, 34vw" : undefined}
                width={work.width}
                height={work.height}
                loading="lazy"
                decoding="async"
                alt={work.alt}
              />
            </div>
            <div className="work-caption">
              <p>{work.medium}</p>
              <h3>{work.title}</h3>
              <ArrowUpRightIcon aria-hidden="true" />
            </div>
          </a>
        ))}
      </div>
    </section>
  );
}
