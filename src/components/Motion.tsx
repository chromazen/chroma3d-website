import { useRef } from "react";
import type { ReactNode, MouseEvent } from "react";
import {
  motion,
  useMotionValue,
  useSpring,
  useReducedMotion,
} from "motion/react";

export function Reveal({
  children,
  className = "",
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.12 }}
      transition={{ duration: 0.65, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
export function MagneticButton({
  children,
  onClick,
  className = "",
}: {
  children: ReactNode;
  onClick: () => void;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const target = useRef<HTMLButtonElement>(null);
  const tx = useMotionValue(0);
  const ty = useMotionValue(0);
  const x = useSpring(tx, { stiffness: 220, damping: 20 });
  const y = useSpring(ty, { stiffness: 220, damping: 20 });
  function move(event: MouseEvent<HTMLButtonElement>) {
    if (reduce || !matchMedia("(pointer:fine)").matches) return;
    const rect = event.currentTarget.getBoundingClientRect();
    tx.set((event.clientX - rect.left - rect.width / 2) * 0.07);
    ty.set((event.clientY - rect.top - rect.height / 2) * 0.12);
  }
  function reset() {
    tx.set(0);
    ty.set(0);
  }
  return (
    <motion.button
      ref={target}
      type="button"
      className={`button ${className}`}
      style={{ x, y }}
      onMouseMove={move}
      onMouseLeave={reset}
      onBlur={reset}
      onClick={onClick}
    >
      {children}
    </motion.button>
  );
}
