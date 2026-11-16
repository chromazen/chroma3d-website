import SculptureViewer from "./components/SculptureViewer";
import type { useProductMediaPreview } from "./useProductMediaPreview";

export function ProductMediaPreview({
  preview,
  colour,
  name,
  neutralLighting,
}: {
  preview: ReturnType<typeof useProductMediaPreview>;
  colour: string;
  name: string;
  neutralLighting: boolean;
}) {
  const { rendered, files, error } = preview;
  return (
    <section
      className="desk-media-preview desk-span"
      aria-label="Product media preview"
    >
      {error ? (
        <div role="alert">
          {error}{" "}
          <button type="button" onClick={preview.retry}>
            Retry preview
          </button>
        </div>
      ) : (
        <>
          <span
            role="status"
            className={files ? "sr-only" : "desk-render-status"}
          >
            {files
              ? "Product previews ready."
              : rendered
                ? "Updating product images…"
                : "Preparing product previews…"}
          </span>
          {rendered && (
            <div className="desk-proof-grid">
              <SculptureViewer
                key={rendered.model}
                colour={colour}
                sculpture={{
                  name,
                  modelUrl: rendered.model,
                  cover: rendered.front,
                  neutralLighting,
                }}
              />
              <figure>
                <img src={rendered.front} alt={name + ", front view"} />
                <figcaption>Front · Cover</figcaption>
              </figure>
              <figure>
                <img
                  src={rendered.threeQuarter}
                  alt={name + ", three-quarter view"}
                />
                <figcaption>Three-quarter · Gallery</figcaption>
              </figure>
            </div>
          )}
        </>
      )}
    </section>
  );
}
