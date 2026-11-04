import type { AnchorHTMLAttributes, ReactNode } from "react";

// Adapted from Balick's Underline Link and Satori UI's Slide Up Reveal, via 21st.dev.
// The site uses native links and CSS line masks so reduced motion also works before hydration.
export function UnderlineLink({
  children,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a {...props}>
      <span className="ink-underline">{children}</span>
    </a>
  );
}

export function SlideUpLines({ lines }: { lines: ReactNode[] }) {
  return (
    <>
      {lines.map((line, i) => (
        <span className="line-mask" key={i}>
          <span className="line-rise">{line}</span>
        </span>
      ))}
    </>
  );
}
