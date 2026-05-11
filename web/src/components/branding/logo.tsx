import { cn } from "@/lib/utils";

type LogoProps = {
  className?: string;
  alt?: string;
};

export function Logo({ className, alt = "drime-s3 logo" }: LogoProps) {
  return (
    <img
      src={`${import.meta.env.BASE_URL}logo.png`}
      alt={alt}
      width={512}
      height={512}
      className={cn("inline-block", className)}
      draggable={false}
    />
  );
}
