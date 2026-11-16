import { useEffect, useRef, useState } from "react";
import { operation } from "./backend";
import type { PreviewFiles } from "./productModelUpload";

type Source = File | string;
type WorkerResult =
  | (Pick<PreviewFiles, "colour" | "front" | "threeQuarter"> & {
      buffer?: ArrayBuffer;
      sha256?: string;
    })
  | { error: string };
type Rendered = {
  source: Source;
  files?: PreviewFiles;
  colour: string;
  model: string;
  front: string;
  threeQuarter: string;
};

async function readSource(
  source: Source,
  signal: AbortSignal,
  storefront: boolean,
) {
  if (typeof source !== "string") return source;
  let url = source;
  if (!storefront) {
    url = (
      await operation<{ signedUrl: string }>({
        action: "preview-media",
        id: source,
      })
    ).signedUrl;
  }
  const response = await fetch(url, { signal });
  if (!response.ok) throw Error("Could not open the saved 3D preview.");
  return new File([await response.blob()], "preview.glb");
}

function previewWorker() {
  return new Worker(new URL("./productPreview.worker.ts", import.meta.url), {
    type: "module",
  });
}
function mediaFiles(
  data: Exclude<WorkerResult, { error: string }>,
): PreviewFiles | undefined {
  if (!data.buffer) return;
  return {
    colour: data.colour,
    front: data.front,
    threeQuarter: data.threeQuarter,
    sha256: data.sha256 ?? "",
    file: new File([data.buffer], "preview.glb", { type: "model/gltf-binary" }),
  };
}
export function renderPart(file: File, colour: string): Promise<PreviewFiles> {
  return new Promise((resolve, reject) => {
    const worker = previewWorker();
    worker.onmessage = ({ data }: MessageEvent<WorkerResult>) => {
      worker.terminate();
      const files = "error" in data ? undefined : mediaFiles(data);
      if (files) resolve(files);
      else
        reject(
          Error("error" in data ? data.error : "Could not render this part."),
        );
    };
    worker.onerror = worker.onmessageerror = () => {
      worker.terminate();
      reject(Error("Could not render this part."));
    };
    worker.postMessage({ file, colour });
  });
}
export function useProductMediaPreview(
  source: Source | null,
  colour: string,
  storefront = false,
) {
  const [rendered, setRendered] = useState<Rendered>();
  const [failure, setFailure] = useState<{ source: Source; message: string }>();
  const [attempt, retry] = useState(0);
  const requestColour = useRef<((value: string) => void) | null>(null);

  useEffect(() => {
    setRendered(undefined);
    setFailure(undefined);
    if (!source) return;
    const controller = new AbortController();
    const worker = previewWorker();
    let input: File | undefined;
    let sentSource = false;
    let working = false;
    let wanted = "",
      finished = "",
      model = "";
    let photos: string[] = [];
    let timer: ReturnType<typeof setTimeout>;

    function render() {
      if (working || !input || !wanted || wanted === finished) return;
      working = true;
      worker.postMessage({
        file: sentSource ? undefined : input,
        savedPreview: typeof source === "string",
        photosOnly: storefront,
        colour: wanted,
      });
      sentSource = true;
    }
    function fail(message: string) {
      if (!controller.signal.aborted) setFailure({ source: source!, message });
      worker.terminate();
    }
    worker.onmessage = ({ data }: MessageEvent<WorkerResult>) => {
      if (controller.signal.aborted) return;
      if ("error" in data) return fail(data.error);
      working = false;
      finished = data.colour;
      const files = mediaFiles(data);
      // The mesh stays mounted so orbit and zoom survive material changes.
      if (!model && files) model = URL.createObjectURL(files.file);
      if (!photos.length || finished === wanted) {
        photos.forEach((url) => URL.revokeObjectURL(url));
        photos = [
          URL.createObjectURL(data.front),
          URL.createObjectURL(data.threeQuarter),
        ];
        setRendered({
          source,
          files,
          colour: data.colour,
          model,
          front: photos[0],
          threeQuarter: photos[1],
        });
      }
      render();
    };
    worker.onerror = worker.onmessageerror = () =>
      fail("The browser could not render this model.");
    requestColour.current = (value) => {
      wanted = value;
      clearTimeout(timer);
      timer = setTimeout(render, 75);
    };
    void readSource(source, controller.signal, storefront)
      .then((file) => {
        if (controller.signal.aborted) return;
        input = file;
        render();
      })
      .catch((error) =>
        fail(
          error instanceof Error ? error.message : "Could not open the model.",
        ),
      );
    return () => {
      controller.abort();
      clearTimeout(timer);
      worker.terminate();
      requestColour.current = null;
      photos.forEach((url) => URL.revokeObjectURL(url));
      if (model) URL.revokeObjectURL(model);
    };
  }, [source, attempt, storefront]);

  useEffect(() => {
    requestColour.current?.(colour);
  }, [colour, source, attempt, storefront]);
  const current = rendered?.source === source ? rendered : undefined;
  const error = failure?.source === source ? failure?.message : undefined;
  return {
    rendered: current,
    files: !error && current?.colour === colour ? current.files : undefined,
    error,
    retry: () => retry((n) => n + 1),
  };
}
