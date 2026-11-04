export type Format = "Printed piece" | "STL file";
export type CartLine = {
  key: string;
  title: string;
  detail: string;
  price: number;
  quantity: number;
  physical: boolean;
  image?: string;
  file?: File;
};
export const collection = [
  {
    id: "mahalakshmi",
    name: "Sri Mahalakshmi Devi",
    image: "/sculpture.webp",
    number: "01",
    cover: "/mahalakshmi-front.webp",
    gallery: [
      { src: "/mahalakshmi-front.webp", label: "Studio render" },
      { src: "/sculpture.webp", label: "Print photo" },
    ],
    modelUrl: "/mahalakshmi.glb",
    caption: "Printed study",
    description:
      "Sri Mahalakshmi Devi seated on a lotus pedestal. Compare the physical print with the digital sculpt, from the folds at its base to the detail in the crown.",
    printed: 1800,
    digital: 350,
  },
  {
    id: "bhuvaneshwari",
    name: "Devi Bhuvaneshwari",
    image: "/bhuvaneshwari-front.webp",
    number: "02",
    cover: "/bhuvaneshwari-front.webp",
    gallery: [
      { src: "/bhuvaneshwari-front.webp", label: "Front view" },
      { src: "/bhuvaneshwari-profile.webp", label: "Three-quarter view" },
    ],
    modelUrl: "/bhuvaneshwari.glb",
    caption: "Digital study",
    description:
      "Devi Bhuvaneshwari seated on a tiered throne. Turn the sculpt to follow the folds of her sari and the carved details in the crown and pedestal.",
    printed: 1500,
    digital: 300,
  },
  {
    id: "adiyogi",
    name: "Adiyogi",
    image: "/adiyogi-front.webp",
    number: "03",
    cover: "/adiyogi-front.webp",
    gallery: [
      { src: "/adiyogi-front.webp", label: "Front view" },
      { src: "/adiyogi-profile.webp", label: "Three-quarter view" },
    ],
    modelUrl: "/adiyogi.glb",
    neutralLighting: true,
    caption: "Digital study",
    description:
      "An ash-grey bust of Shiva as Adiyogi. Turn the sculpt to see the crescent moon above the brow and the locks of hair falling across the shoulders.",
    printed: 1500,
    digital: 300,
  },
];
export const rupees = (amount: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
export const printMaterials = [
  { name: "PLA", price: 350, note: "For form studies and display pieces." },
  { name: "PETG", price: 450, note: "For practical parts and housings." },
  {
    name: "ABS",
    price: 550,
    note: "Discuss temperature exposure and intended use.",
  },
  {
    name: "Other material",
    price: 0,
    note: "Tell the studio which filament you need. Availability is reviewed with your quote.",
  },
];
export function navigate(path: string) {
  if (location.pathname + location.search !== path)
    history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
