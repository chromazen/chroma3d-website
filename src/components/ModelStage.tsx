import { lazy, Suspense, useState } from "react";
import type { MotionValue } from "motion/react";
import { ArrowUpRightIcon } from "@phosphor-icons/react";
const MachineScene = lazy(() => import("./MachineScene"));
function Poster({ onExplore }: { onExplore?: () => void }) {
  return (
    <div className="model-poster">
      <img
        src="/form-study.jpg"
        width={1000}
        height={1000}
        alt="An original helical gear assembly study in orange, graphite and white."
        fetchPriority="high"
      />
      <div className="scene-bottom">
        <span>ORIGINAL DIGITAL ASSEMBLY STUDY</span>
        {onExplore && (
          <button type="button" onClick={onExplore}>
            Inspect in 3D <ArrowUpRightIcon size={17} />
          </button>
        )}
      </div>
    </div>
  );
}
export default function ModelStage({
  progress,
}: {
  progress: MotionValue<number>;
}) {
  const [interactive, setInteractive] = useState(
    () => matchMedia("(min-width: 761px)").matches,
  );
  const [manual, setManual] = useState(false);
  return interactive ? (
    <Suspense fallback={<Poster />}>
      <MachineScene progress={progress} focusOnReady={manual} />
    </Suspense>
  ) : (
    <Poster
      onExplore={() => {
        setManual(true);
        setInteractive(true);
      }}
    />
  );
}
