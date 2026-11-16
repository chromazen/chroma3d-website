import { useId, useState } from "react";
import { previewColours, studioNeutral } from "./previewColour";

export default function PreviewColourField({
  colour,
  change,
  storefront = false,
  hasDefaultColour = false,
}: {
  colour: string;
  change: (value: string) => void;
  storefront?: boolean;
  hasDefaultColour?: boolean;
}) {
  const id = useId();
  const [custom, setCustom] = useState(false);
  const usePicker =
    custom ||
    (!!colour && !previewColours.some(([, value]) => value === colour));
  return (
    <div className={storefront ? "shop-preview-colour" : "desk-preview-colour"}>
      <label htmlFor={id}>Preview colour</label>
      <div>
        <span
          aria-hidden="true"
          style={{ backgroundColor: colour || "transparent" }}
        />
        <select
          id={id}
          aria-describedby={id + "-hint"}
          value={usePicker ? "custom" : colour}
          onChange={(e) => {
            setCustom(e.target.value === "custom");
            if (e.target.value !== "custom") change(e.target.value);
            else if (!colour) change(studioNeutral);
          }}
        >
          {storefront && !hasDefaultColour && <option value="">Studio finish</option>}
          {previewColours.map(([name, value]) => (
            <option key={value} value={value}>
              {name}
            </option>
          ))}
          <option value="custom">Custom colour…</option>
        </select>
        {usePicker && (
          <input
            type="color"
            aria-label="Custom preview colour"
            value={colour}
            onChange={(e) => change(e.target.value)}
          />
        )}
      </div>
      <small id={id + "-hint"}>
        Applies to the 3D preview, front view and three-quarter view.
      </small>
    </div>
  );
}
