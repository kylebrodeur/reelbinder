import { PanelRightClose } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface SidebarDockTab<T extends string = string> {
  /** Unique tab identifier */
  id: T;
  /** Visible tab text */
  label: string;
  /** Optional icon component or rendered icon */
  icon?: React.ComponentType<{ className?: string }> | React.ReactNode;
  /** Optional count indicator */
  count?: number | null;
  /** Optional badge indicator */
  badge?: React.ReactNode;
  /** Optional title attribute */
  title?: string;
  /** Optional accessible aria-label */
  ariaLabel?: string;
  /** Optional panel content to render when active (alternative to passing children) */
  panel?: React.ReactNode;
}

export interface SidebarDockProps<T extends string = string> {
  /** HTML id for the <aside> element */
  id?: string;
  /** Accessible label for the sidebar container */
  ariaLabel?: string;
  /** Accessible label for the tablist container */
  tablistAriaLabel?: string;
  /** List of tabs displayed in the dock header */
  tabs: readonly SidebarDockTab<T>[] | SidebarDockTab<T>[];
  /** Currently active tab ID, or null if collapsed/no tab active */
  activeTab: T | null;
  /** Callback fired when a tab pill is clicked */
  onTabChange: (tabId: T) => void;
  /** Callback fired when the collapse/close button is clicked */
  onClose?: () => void;
  /** Custom collapse icon (defaults to PanelRightClose) */
  collapseIcon?: React.ReactNode;
  /** Accessible label for the collapse/close button */
  closeAriaLabel?: string;
  /** Optional leading title or element in the header */
  title?: React.ReactNode;
  /** Optional trailing action buttons in the header (before collapse button) */
  headerActions?: React.ReactNode;
  /** Tab panel children (rendered inside the scrollable/contained panel) */
  children?: React.ReactNode;
  /** Root class overrides */
  className?: string;
  /** Header class overrides */
  headerClassName?: string;
  /** Content wrapper class overrides */
  contentClassName?: string;
}

export function SidebarDock<T extends string = string>({
  id,
  ariaLabel = "Sidebar dock",
  tablistAriaLabel = "Sidebar tabs",
  tabs,
  activeTab,
  onTabChange,
  onClose,
  collapseIcon,
  closeAriaLabel = "Collapse panel",
  title,
  headerActions,
  children,
  className,
  headerClassName,
  contentClassName,
}: SidebarDockProps<T>) {
  const activeTabObj = tabs.find((t) => t.id === activeTab);

  return (
    <aside
      id={id}
      aria-label={ariaLabel}
      className={cn(
        "flex h-80 max-h-[50%] min-h-0 w-full shrink-0 flex-col border-t border-border bg-card overflow-hidden md:h-full md:max-h-none md:w-80 md:border-l md:border-t-0 xl:w-96",
        className,
      )}
    >
      {/* Dock Header */}
      <div
        className={cn(
          "flex shrink-0 items-center justify-between gap-2 border-b border-border bg-background px-3 py-1.5",
          headerClassName,
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          {title && <div className="truncate text-xs font-semibold text-foreground">{title}</div>}
          <div
            className="flex items-center gap-1 rounded-md bg-secondary/80 p-0.5 overflow-x-auto no-scrollbar"
            role="tablist"
            aria-label={tablistAriaLabel}
          >
            {tabs.map((tab) => {
              const isActive = activeTab === tab.id;
              const renderIcon = () => {
                if (!tab.icon) return null;
                if (React.isValidElement(tab.icon)) {
                  return tab.icon;
                }
                const IconComponent = tab.icon as React.ComponentType<{ className?: string }>;
                return <IconComponent className="size-3.5 shrink-0" />;
              };

              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-label={tab.ariaLabel ?? tab.label}
                  title={tab.title ?? tab.label}
                  onClick={() => onTabChange(tab.id)}
                  className={cn(
                    "inline-flex h-7 items-center gap-1.5 rounded-sm px-2.5 text-xs font-medium transition-all shrink-0 select-none",
                    isActive
                      ? "bg-card text-foreground shadow-xs font-semibold"
                      : "text-muted-foreground hover:text-foreground hover:bg-card/40",
                  )}
                >
                  {renderIcon()}
                  <span>{tab.label}</span>
                  {tab.count !== undefined && tab.count !== null && (
                    <span className="ml-0.5 rounded-full bg-muted px-1.5 py-0.2 text-[10px] font-mono text-muted-foreground">
                      {tab.count}
                    </span>
                  )}
                  {tab.badge !== undefined && tab.badge !== null && (
                    typeof tab.badge === "string" || typeof tab.badge === "number" ? (
                      <span className="ml-0.5 rounded-full bg-muted px-1.5 py-0.2 text-[10px] font-mono text-muted-foreground">
                        {tab.badge}
                      </span>
                    ) : (
                      tab.badge
                    )
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-1">
          {headerActions}
          {onClose && (
            <Button
              size="icon-sm"
              variant="ghost"
              className="size-7 text-muted-foreground hover:text-foreground shrink-0"
              onClick={onClose}
              aria-label={closeAriaLabel}
              title={closeAriaLabel}
            >
              {collapseIcon ?? <PanelRightClose className="size-3.5" />}
            </Button>
          )}
        </div>
      </div>

      {/* Dock Content Panel */}
      <div
        className={cn(
          "min-h-0 flex-1 overflow-hidden [&>aside]:border-0 [&>aside]:w-full [&>aside]:h-full [&>aside]:shadow-none [&>aside]:overflow-y-auto",
          contentClassName,
        )}
      >
        {children}
        {activeTabObj?.panel}
      </div>
    </aside>
  );
}
