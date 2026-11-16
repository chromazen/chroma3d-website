export const studioNeutral = "#bfb8ac";
export const previewColours = [
  ["Studio neutral", studioNeutral],
  ["Antique gold", "#c18737"],
  ["Copper", "#b97149"],
  ["Ash grey", "#909294"],
  ["Ivory", "#e9dfc8"],
  ["Graphite", "#474b50"],
  ["Terracotta", "#b75c40"],
  ["Deep blue", "#345e9c"],
  ["Forest green", "#447358"],
] as const;

const colourSuffix = /(?<=\))(#[0-9a-f]{6})$/;
export const previewColour = (label: string) =>
  label.match(colourSuffix)?.[1] ?? studioNeutral;
export const basePreviewLabel = (label: string) =>
  label.replace(colourSuffix, "");
export const modelPartName = (label: string) =>
  basePreviewLabel(label).replace(/ · 3D preview \(v\d+\)$/, "");
export type PartSelection = {
  preview_media?: string;
  preview_parts?: string[];
  group_preview?: string;
};
export function partLabels(selection?: PartSelection) {
  return [
    ...new Set(
      [selection?.preview_media, ...(Array.isArray(selection?.preview_parts) ? selection.preview_parts : [])].filter(
        (label): label is string => typeof label === "string" && !!label,
      ),
    ),
  ];
}
export const isColouredMedia = (label: string) =>
  / · (?:3D preview|Front render|Three-quarter render) \(v\d+\)#[0-9a-f]{6}$/.test(
    label,
  );
