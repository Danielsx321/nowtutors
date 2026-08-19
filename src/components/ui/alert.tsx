import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Info, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

const alertVariants = cva(
  "flex gap-3 rounded-md border p-4 text-body",
  {
    variants: {
      variant: {
        info: "border-purple-100 bg-purple-100 text-purple-700",
        success: "border-success/30 bg-success/10 text-gray-700",
        warning: "border-warning/30 bg-warning/10 text-gray-700",
        danger: "border-danger/30 bg-danger/10 text-gray-700",
      },
    },
    defaultVariants: { variant: "info" },
  },
);

const icons = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
} as const;

const iconColor = {
  info: "text-purple-500",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
} as const;

export interface AlertProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title">,
    VariantProps<typeof alertVariants> {
  title?: React.ReactNode;
}

export function Alert({
  className,
  variant = "info",
  title,
  children,
  ...props
}: AlertProps) {
  const key = variant ?? "info";
  const Icon = icons[key];
  return (
    <div
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    >
      <Icon className={cn("mt-0.5 size-5 shrink-0", iconColor[key])} aria-hidden />
      <div className="min-w-0">
        {title && <p className="font-bold text-gray-700">{title}</p>}
        {children && <div className="text-gray-700">{children}</div>}
      </div>
    </div>
  );
}
