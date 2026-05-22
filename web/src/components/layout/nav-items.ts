import { LayoutDashboard, Package } from "lucide-react";
import type { ComponentType, SVGProps } from "react";

export type NavItem = {
  to: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
};

export const NAV_ITEMS: readonly NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/buckets", label: "Buckets", icon: Package },
];
