import { Loader2, RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type RetryButtonProps = {
  onClick: () => void;
  retrying: boolean;
  size?: "default" | "sm";
  className?: string;
};

export function RetryButton({
  onClick,
  retrying,
  size = "default",
  className,
}: RetryButtonProps) {
  return (
    <Button
      type="button"
      variant="outline"
      size={size}
      className={cn(className)}
      onClick={onClick}
      disabled={retrying}
      aria-busy={retrying}
    >
      {retrying ? (
        <>
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Retrying…
        </>
      ) : (
        <>
          <RotateCw className="size-4" aria-hidden />
          Retry
        </>
      )}
    </Button>
  );
}
