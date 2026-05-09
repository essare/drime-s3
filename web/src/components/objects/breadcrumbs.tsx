import { Package } from "lucide-react";
import { Fragment } from "react";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

export type ObjectsBreadcrumbsProps = {
  bucket: string;
  /** e.g. "" or "photos/2024/" */
  prefix: string;
  onNavigate: (newPrefix: string) => void;
};

export function ObjectsBreadcrumbs({
  bucket,
  prefix,
  onNavigate,
}: ObjectsBreadcrumbsProps) {
  const segments = prefix.replace(/\/$/, "").split("/").filter(Boolean);

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem className="gap-2">
          <Package className="size-4 shrink-0" aria-hidden />
          {segments.length === 0 ? (
            <BreadcrumbPage>{bucket}</BreadcrumbPage>
          ) : (
            <BreadcrumbLink asChild>
              <button
                type="button"
                className="cursor-pointer"
                onClick={() => onNavigate("")}
              >
                {bucket}
              </button>
            </BreadcrumbLink>
          )}
        </BreadcrumbItem>

        {segments.map((segment, idx) => {
          const isLast = idx === segments.length - 1;
          const prefixForCrumb = `${segments.slice(0, idx + 1).join("/")}/`;

          return (
            <Fragment key={prefixForCrumb}>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                {isLast ? (
                  <BreadcrumbPage>{segment}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <button
                      type="button"
                      className="cursor-pointer"
                      onClick={() => onNavigate(prefixForCrumb)}
                    >
                      {segment}
                    </button>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
