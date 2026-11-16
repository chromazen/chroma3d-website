import { catalogState } from "./catalog";
import { business } from "./content";

export const origin = "https://www.chroma3d.in";
type Page = {
  path: string;
  title: string;
  description: string;
  label: string;
  image: string;
  imageAlt: string;
  indexable: boolean;
  service?: string;
};

const corePages: Page[] = [
  {
    path: "/", label: "Home", indexable: true,
    title: "Chroma3D | 3D Printing, Sculptures & Prototyping in Chennai",
    description: "Explore Chroma3D’s Chennai studio. Browse sculptures and STL models, bring a design for 3D printing, or develop a prototype from a sketch.",
    image: "/workshop-poster.jpg", imageAlt: "Sri Mahalakshmi Devi on the Chroma3D workbench",
  },
  {
    path: "/shop", label: "Store", indexable: true,
    title: "3D Printed Sculptures & STL Models | Chroma3D",
    description: "Explore the Chroma3D sculpture collection. View the digital sculpts and compare physical printed pieces with digital STL editions.",
    image: "/sculpture.webp", imageAlt: "Physical print of Sri Mahalakshmi Devi on a lotus pedestal",
  },
  {
    path: "/print", label: "Print Your Design", indexable: true,
    title: "Custom 3D Printing Service in Chennai | Chroma3D",
    description: "Inspect your STL or 3MF file locally, choose material and finish preferences, or contact the Chennai studio for a bulk or custom printing quote.",
    service: "Custom 3D printing", image: "/lattice-study.webp", imageAlt: "Digital lattice model",
  },
  {
    path: "/studio", label: "Start a Project", indexable: true,
    title: "Custom 3D Prototyping Studio in Chennai | Chroma3D",
    description: "Bring Chroma3D a sketch, reference or idea. Prepare a project brief and discuss design, prototyping and 3D printing with the Chennai studio.",
    service: "Design and prototyping", image: "/bracket-study.webp", imageAlt: "Design study of a ribbed mounting bracket",
  },
];
export const getPages = ():Page[] => [...corePages, ...catalogState().items.map(item => ({
    path: "/shop/" + item.id, label: item.name, indexable: !item.sample,
    title: item.seoTitle || (item.name + " | Chroma3D"),
    description: item.seoDescription || item.description,
    image: item.cover, imageAlt: item.gallery[0]?.label || item.name,
  })),
];

function graph(page: Page) {
  const url = origin + page.path;
  const studio = { "@id": origin + "/#studio" };
  const website = { "@id": origin + "/#website" };
  const graph: Record<string, unknown>[] = [
    { ...studio, "@type": "LocalBusiness", name: business.name, url: origin + "/",
      image: origin + "/workshop-poster.jpg", logo: origin + "/chroma3d-logo.png",
      address: { "@type": "PostalAddress", addressLocality: "Chennai", addressRegion: "Tamil Nadu", addressCountry: "IN" },
      sameAs: [business.instagram, business.youtube.split("?")[0]] },
    { ...website, "@type": "WebSite", name: business.name, url: origin + "/", publisher: studio },
  ];
  const webpage: Record<string, unknown> = {
    "@type": page.path === "/shop" ? "CollectionPage" : "WebPage",
    "@id": url + "#page", url, name: page.title, description: page.description,
    isPartOf: website, publisher: studio, inLanguage: "en-IN",
  };
  if (page.service) {
    const service = { "@id": url + "#service" };
    webpage.mainEntity = service;
    graph.push({ ...service, "@type": "Service", name: page.service, provider: studio, url, description: page.description });
  }
  if (page.indexable && page.path.startsWith("/shop/")) {
    const product = { "@id": url + "#product" };
    webpage.mainEntity = product;
    graph.push({ ...product, "@type":"Product", name:page.label, description:page.description,
      image:new URL(page.image,origin).href, url, brand:{"@type":"Brand",name:"Chroma3D"} });
  }
  if (page.path !== "/") {
    const trail = [corePages[0], ...(page.path.startsWith("/shop/") ? [corePages[1]] : []), page];
    webpage.breadcrumb = { "@id": url + "#breadcrumb" };
    graph.push({ "@type": "BreadcrumbList", "@id": url + "#breadcrumb", itemListElement: trail.map((p, i) => ({
      "@type": "ListItem", position: i + 1, name: p.label, item: origin + p.path,
    })) });
  }
  return { "@context": "https://schema.org", "@graph": [...graph, webpage] };
}

type Tag = { tag: "title" | "link" | "meta" | "script"; attrs?: Record<string, string>; text?: string };

export function headTags(path: string, official: boolean): Tag[] {
  const page = getPages().find(p => p.path === path);
  const title = page?.title ?? (({ "/bag": "Shopping bag", "/checkout": "Checkout", "/account":"My account", "/admin":"Studio desk", "/requests":"Your studio records" }[path] ?? "Page unavailable") + " | Chroma3D");
  const tags: Tag[] = [{ tag: "title", text: title }];
  if (!official || !page?.indexable) tags.push({ tag: "meta", attrs: { name: "robots", content: "noindex, follow" } });
  if (!page) return tags;
  const url = origin + path;
  tags.push({ tag: "link", attrs: { rel: "canonical", href: url } });
  for (const [key, content] of Object.entries({
    description: page.description, "og:title": title, "og:description": page.description, "og:url": url,
    "og:type": "website", "og:site_name": business.name, "og:locale": "en_IN",
    "og:image": new URL(page.image,origin).href, "og:image:alt": page.imageAlt,
    "twitter:card": "summary_large_image", "twitter:title": title, "twitter:description": page.description,
    "twitter:image": new URL(page.image,origin).href, "twitter:image:alt": page.imageAlt,
  })) tags.push({ tag: "meta", attrs: { [key.startsWith("og:") ? "property" : "name"]: key, content } });
  tags.push({ tag: "script", attrs: { type: "application/ld+json" }, text: JSON.stringify(graph(page)).replaceAll("<", "\\u003c") });
  return tags;
}

export function updateHead(path: string) {
  const fragment = document.createDocumentFragment();
  for (const { tag, attrs, text } of headTags(path, location.origin === origin)) {
    const el = document.createElement(tag);
    el.setAttribute("data-seo", "");
    for (const [key, value] of Object.entries(attrs ?? {})) el.setAttribute(key, value);
    if (text) el.textContent = text;
    fragment.append(el);
  }
  document.head.querySelectorAll("[data-seo]").forEach(el => el.remove());
  document.head.append(fragment);
}
