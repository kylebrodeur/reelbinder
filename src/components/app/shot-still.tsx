import type { SketchData } from "@/lib/types";

export function ShotStill({
  sketch,
  frameUrl,
  alt,
}: {
  sketch: SketchData;
  frameUrl: string | null;
  alt: string;
}) {
  if (frameUrl) {
    return <img src={frameUrl} alt={alt} className="h-full w-full object-cover" />;
  }
  return (
    <svg viewBox="0 0 160 90" className="h-full w-full bg-paper text-paper-ink" aria-label={alt}>
      <rect width="160" height="90" fill="currentColor" className="text-paper" />
      {sketch.stamps.map((s) => {
        const x = s.x * 160;
        const y = s.y * 90;
        const sc = 10 * s.scale;
        if (s.kind === "box") {
          return (
            <rect
              key={s.id}
              x={x - sc}
              y={y - sc * 0.7}
              width={sc * 2}
              height={sc * 1.4}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
            />
          );
        }
        return (
          <g key={s.id} stroke="currentColor" fill="none" strokeWidth="1.2" strokeLinecap="round">
            <circle cx={x} cy={y - sc * 0.72} r={sc * 0.22} />
            <path
              d={`M ${x} ${y - sc * 0.5} L ${x} ${y + sc * 0.15} M ${x - sc * 0.38} ${y - sc * 0.22} L ${x + sc * 0.38} ${y - sc * 0.22} M ${x} ${y + sc * 0.15} L ${x - sc * 0.32} ${y + sc * 0.7} M ${x} ${y + sc * 0.15} L ${x + sc * 0.32} ${y + sc * 0.7}`}
            />
            {s.label ? (
              <text
                x={x}
                y={y + sc * 1.05}
                textAnchor="middle"
                fill="currentColor"
                stroke="none"
                fontSize="6"
              >
                {s.label}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
