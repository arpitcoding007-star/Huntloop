export { cn } from "./utils/cn";
export { Anchor } from "./utils/link";
export type { LinkComponent, LinkComponentProps } from "./utils/link";

export { Badge, StatusDot } from "./components/Badge";
export type { BadgeProps, BadgeVariant } from "./components/Badge";

export { Button } from "./components/Button";
export type { ButtonProps, ButtonSize, ButtonVariant } from "./components/Button";

export { Card, CardBody, CardHeader, SectionLabel } from "./components/Card";
export type { CardProps } from "./components/Card";

export { StatCard, StatGrid } from "./components/StatCard";
export type { StatCardProps, StatTone } from "./components/StatCard";

export { SCORE_DIMENSIONS, ScorePill } from "./components/ScorePill";
export type {
  ScoreDimension,
  ScoreDimensionLabel,
  ScoreFactor,
  ScorePillProps,
} from "./components/ScorePill";

/* ── Intelligence primitives (master context §7, §15, §52, §81) ─────────── */

export { PriorityBadge } from "./components/PriorityBadge";
export type { Priority, PriorityBadgeProps } from "./components/PriorityBadge";

export { ClaimBadge } from "./components/ClaimBadge";
export type { ClaimBadgeProps, ClaimKind, Confidence } from "./components/ClaimBadge";

export { EvidenceList } from "./components/EvidenceList";
export type { EvidenceItem, EvidenceListProps } from "./components/EvidenceList";

export { Freshness, elapsedLabel, freshnessBand } from "./components/Freshness";
export type { FreshnessBand, FreshnessProps } from "./components/Freshness";

export { HoverPanel } from "./components/HoverPanel";
export type { HoverPanelProps } from "./components/HoverPanel";

/* ── Every UI state (spec Part 25) ──────────────────────────────────────── */

export {
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  PermissionDenied,
  RateLimited,
} from "./components/States";
export type {
  EmptyStateProps,
  ErrorStateProps,
  LoadingSkeletonProps,
  PermissionDeniedProps,
  RateLimitedProps,
} from "./components/States";

export { DataTable } from "./components/DataTable";
export type { Column, DataTableProps } from "./components/DataTable";

export { FilterBar } from "./components/FilterBar";
export type { FilterBarProps, FilterScope } from "./components/FilterBar";

export { QuotaBar, QuotaBarGroup } from "./components/QuotaBar";
export type { QuotaBarProps } from "./components/QuotaBar";

export { BreakdownList } from "./components/BreakdownList";
export type { BreakdownItem, BreakdownListProps } from "./components/BreakdownList";

export { ActionRail, ActionRailItem } from "./components/ActionRail";
export type { ActionRailItemProps, ActionRailProps } from "./components/ActionRail";

export { Sidebar } from "./components/Sidebar";
export type { NavGroup, NavItem, SidebarProps } from "./components/Sidebar";

export { Avatar, TopBar } from "./components/TopBar";
export type { BreadcrumbSwitcher, TopBarProps } from "./components/TopBar";

/* ── Form primitives ────────────────────────────────────────────────────── */

export {
  Field,
  FormMessage,
  Input,
  ListInput,
  Select,
  Textarea,
  joinList,
  splitList,
} from "./components/Form";
export type { FieldProps } from "./components/Form";
