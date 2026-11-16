import { SlideUpLines, UnderlineLink } from "./components/EditorialMotion";
import { useEffect, useRef, useSyncExternalStore } from "react";
import type { MouseEvent } from "react";
import { ArrowUpRightIcon, HandbagIcon, UserCircleIcon } from "@phosphor-icons/react";
import SculptureViewer from "./components/SculptureViewer";
import SelectedWork from "./components/SelectedWork";
import { Bag, Checkout } from "./Shop";
import Store from "./Store";
import Product from "./Product";
import Printing from "./Printing";
import Studio, { useStudioProject } from "./Studio";
import { business } from "./content";
import { navigate } from "./collection";
import {lazy,Suspense} from "react";
import {connected, refreshCatalog, useCatalog} from "./catalog";
import { updateHead } from "./seo";
import { useCustomerSession } from "./customerSession";
import { useShoppingBag } from "./useShoppingBag";

const Admin=lazy(()=>import("./Admin"));
const Account=lazy(()=>import("./Account"));
const Workspace=lazy(()=>import("./Workspace"));
const entrances = [
  {
    path: "/shop",
    treatment: "store",
    short: "Store",
    number: "01",
    title: "Objects worth owning.",
    description: "Studio sculptures, printed pieces and digital editions.",
    image: "/bhuvaneshwari-profile.webp",
  },
  {
    path: "/print",
    treatment: "print",
    short: "Print your Design",
    number: "02",
    title: "Your file, in print.",
    description: "Inspect your model and choose how it gets made.",
    image: "/lattice-study.webp",
  },
  {
    path: "/studio",
    treatment: "studio",
    short: "Start a Project",
    number: "03",
    title: "Start with an idea.",
    description: "Work with us from the first sketch to the finished project.",
    image: "/impeller-study.webp",
  },
];
const subscribe = (notify: () => void) => {
  window.addEventListener("popstate", notify);
  return () => window.removeEventListener("popstate", notify);
};
function Wordmark() {
  return (
    <span className="wordmark">
      <img src="/chroma3d-logo.png" alt="" width="46" height="46" />
      <span>
        Chroma<b>3D</b>
      </span>
    </span>
  );
}
function Home() {
  return (
    <main id="main" className="home">
      <section className="home-hero" aria-labelledby="home-title">
        <div className="home-intro">
          <p className="kicker">
            Chennai, India <i /> 3D printing studio
          </p>
          <h1 id="home-title" aria-label="WHERE IDEAS TAKE FORM. WHERE FEELINGS TAKE SHAPE.">
            <SlideUpLines
              lines={[
                <>
                  <em>WHERE IDEAS</em> TAKE FORM.
                </>,
                <>
                  WHERE FEELINGS <em>TAKE SHAPE.</em>
                </>,
              ]}
            />
          </h1>
          <p className="hero-deck">
            Choose a sculpture to keep, print your own design, or bring us a
            sketch to develop together.
          </p>
          <div className="hero-actions">
            <a href="/shop" className="primary">
              <span>
                <span className="wide-copy">Explore the </span>Store
              </span>{" "}
              <ArrowUpRightIcon />
            </a>
            <a href="/print" className="secondary">
              Print Your Design <ArrowUpRightIcon />
            </a>
            <a href="/studio" className="secondary">
              Start a Project <ArrowUpRightIcon />
            </a>
          </div>
        </div>
        <SculptureViewer
          portrait
          makingOfUrl="https://www.instagram.com/reel/DSopJFmCWjn/?utm_source=ig_web_button_share_sheet"
        />
      </section>
      <nav className="pathways" aria-label="Choose a Chroma3D service">
        {entrances.map((e) => (
          <a key={e.path} href={e.path} className={`pathway pathway--${e.treatment}`}>
            <img src={e.image} alt="" />
            <div>
              <span className="kicker">
                {e.number} / {e.short}
              </span>
              <h2>{e.title}</h2>
              <p>{e.description}</p>
            </div>
            <ArrowUpRightIcon aria-hidden="true" />
          </a>
        ))}
      </nav>
      <SelectedWork />
    </main>
  );
}
export default function App({ initialPath = "/" }: { initialPath?: string }) {
  const project = useStudioProject();
  const catalog=useCatalog();
  useEffect(()=>{void refreshCatalog()},[]);
  const url = useSyncExternalStore(
    subscribe,
    () => location.pathname + location.search,
    () => initialPath,
  );
  const path = url.split("?")[0].replace(/\/$/, "") || "/";
  const session = useCustomerSession();
  const bag = useShoppingBag(session === undefined ? undefined : session?.user.id ?? null);
  const { lines, add, change } = bag;
  const prev = useRef(url);
  useEffect(() => {
    updateHead(path);
    if (prev.current !== url) {
      prev.current = url;
      window.scrollTo({ top: 0, behavior: "instant" });
      const main = document.getElementById("main");
      main?.setAttribute("tabindex", "-1");
      main?.focus({ preventScroll: true });
    }
  }, [url, path, catalog.items]);
  function links(event: MouseEvent<HTMLDivElement>) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    const link = (event.target as Element).closest<HTMLAnchorElement>(
      "a[href]",
    );
    if (
      !link ||
      link.target ||
      link.download ||
      link.origin !== location.origin ||
      link.hash
    )
      return;
    event.preventDefault();
    navigate(link.pathname + link.search);
  }
  const count = lines.reduce((s, l) => s + l.quantity, 0);
  return (
    <div className="site" onClick={links}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="mast">
        <a href="/" aria-label="Chroma3D home">
          <Wordmark />
        </a>

        <nav aria-label="Main navigation">
          {entrances.map((e) => (
            <UnderlineLink
              key={e.path}
              href={e.path}
              aria-current={path.startsWith(e.path) ? "page" : undefined}
            >
              {e.short}
            </UnderlineLink>
          ))}
        </nav>
        <div className="mast-utilities">
        <a className="account-link" href="/account" aria-label="My account" aria-current={path === "/account" ? "page" : undefined}>
          <UserCircleIcon aria-hidden="true" size={21} /><span>My account</span>
        </a>
        <a
          href="/bag"
          className="bag-link"
          aria-label={"Shopping bag, " + count + " items"}
        >
          <HandbagIcon size={19} />
          <span>Bag</span>{" "}
          <b className="bag-count" key={count}>
            {count}
          </b>
        </a>
        </div>
      </header>
      {bag.error && <p role="alert" className="wrap">{bag.error}</p>}
      {path === "/" ? (
        <Home />
      ) : path === "/shop" ? (
        <Store />
      ) : path.startsWith("/shop/") ? (
        <Product key={url} id={path.slice(6)} digital={new URLSearchParams(url.split("?")[1]).get("format") === "stl"} add={add} />
      ) : path === "/print" ? (
        <Printing add={add} />
      ) : path === "/studio" ? (
        <Studio project={project} />
      ) : path === "/admin" ? (
        <Suspense fallback={<main id="main">Loading studio desk…</main>}><Admin/></Suspense>
      ) : path === "/account" ? (
        <Suspense fallback={<main id="main" className="page wrap">Opening your account…</main>}><Account session={session} /></Suspense>
      ) : path === "/requests" ? (
        <main id="main" className="page wrap narrow"><h1>Studio records</h1><Suspense fallback={<p>Loading records…</p>}><Workspace key={session?.user.id ?? "guest"}/></Suspense></main>
      ) : (path === "/bag" || path === "/checkout") && bag.loading ? (
        <main id="main" className="page wrap" role="status">Opening your bag…</main>
      ) : path === "/bag" ? (
        <Bag lines={lines} change={change} />
      ) : path === "/checkout" ? (
        <Checkout lines={lines} complete={bag.clear} sessionEmail={session?.user.email} />
      ) : (
        <main id="main" className="page wrap">
          <h1>Page unavailable</h1>
          <a href="/">Back to Chroma3D</a>
        </main>
      )}
      <footer className="colophon">
        <div>
          <Wordmark />
          <span>Chennai, Tamil Nadu</span>
        </div>
        <div>
          <a
            href={"https://wa.me/" + business.whatsapp}
            target="_blank"
            rel="noopener noreferrer"
          >
            WhatsApp <ArrowUpRightIcon />
          </a>
          <a
            href={business.instagram}
            target="_blank"
            rel="noopener noreferrer"
          >
            Instagram <ArrowUpRightIcon />
          </a>
          {connected && <a href={session ? "/account" : "/requests"}>{session ? "My account" : "Your requests"}</a>}
          <a href={business.youtube} target="_blank" rel="noopener noreferrer">
            YouTube <ArrowUpRightIcon />
          </a>
        </div>
      </footer>
    </div>
  );
}
