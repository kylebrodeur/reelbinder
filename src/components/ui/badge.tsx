import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium tracking-wide",
  {
    variants: {
      variant: {
        default: "border-transparent bg-secondary text-foreground",
        outline: "border-border text-muted-foreground",
        warn: "border-transparent bg-warn/15 text-warn",
        error: "border-transparent bg-destructive/15 text-destructive",
        ok: "border-transparent bg-ok/15 text-ok",
        steel: "border-transparent bg-steel/15 text-steel",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: HTMLAttributes<HTMLDivElement> & VariantProps<typeof badgeVariants>) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
