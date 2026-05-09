import { CircleCheck } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type StepStatus = "active" | "complete" | "blocked" | "error";

type StepCardProps = {
  index: number;
  title: string;
  status: StepStatus;
  description: string;
  children?: ReactNode;
};

function statusBadgeVariant(
  status: StepStatus,
): "default" | "secondary" | "destructive" {
  if (status === "complete") return "default";
  if (status === "error") return "destructive";
  return "secondary";
}

function statusLabel(status: StepStatus): string {
  switch (status) {
    case "active":
      return "Pending";
    case "complete":
      return "Done";
    case "blocked":
      return "Blocked";
    case "error":
      return "Failed";
    default:
      return "Pending";
  }
}

export function StepCard({
  index,
  title,
  status,
  description,
  children,
}: StepCardProps) {
  const isActive = status === "active";

  return (
    <Card
      aria-current={isActive ? "step" : undefined}
      className={cn("gap-0 py-0", isActive && "border-l-4 border-l-primary")}
    >
      <CardHeader className="gap-2 pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground text-sm font-medium">
            Step {index}
          </span>
          <CardTitle className="text-lg">{title}</CardTitle>
          <Badge variant={statusBadgeVariant(status)}>
            {status === "complete" && (
              <CircleCheck className="size-3.5" aria-hidden />
            )}
            <span>{statusLabel(status)}</span>
          </Badge>
        </div>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      {children ? (
        <CardContent className="border-t pt-4 pb-6">{children}</CardContent>
      ) : null}
    </Card>
  );
}
