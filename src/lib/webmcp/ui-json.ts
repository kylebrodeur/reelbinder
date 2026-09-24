export const UI_JSON_VERSION = 1 as const;

export type UiPatchAction = "click" | "fill" | "select" | "check" | "uncheck" | "focus";

export interface UiOption {
  label: string;
  value: string;
}

export interface UiControl {
  ref: string;
  role: string;
  name: string;
  tag: string;
  type?: string;
  panel?: string;
  value?: string;
  checked?: boolean;
  pressed?: boolean;
  expanded?: boolean;
  disabled: boolean;
  sensitive?: boolean;
  options?: UiOption[];
}

export interface UiSnapshot {
  version: typeof UI_JSON_VERSION;
  revision: number;
  controls: UiControl[];
  panels: string[];
  truncated: boolean;
}

export interface UiPatchOperation {
  ref: string;
  action: UiPatchAction;
  value?: string;
}

export interface UiPatchOutcome {
  ref: string;
  action: UiPatchAction;
  ok: boolean;
  error?: string;
  control?: UiControl | null;
}

export interface UiPatchResult {
  version: typeof UI_JSON_VERSION;
  revision: number;
  outcomes: UiPatchOutcome[];
  stoppedAt?: string;
}

type ControlElement = HTMLElement & {
  disabled?: boolean;
  value?: string;
  checked?: boolean;
  options?: HTMLOptionsCollection;
};

let latestRevision = 0;
let latestRefs = new Map<string, ControlElement>();

function text(value: string | null | undefined, max = 180): string {
  const clean = (value ?? "").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

function isVisible(element: HTMLElement): boolean {
  if (element.closest('[aria-hidden="true"]')) return false;
  const style = typeof window === "undefined" ? null : window.getComputedStyle(element);
  if (style && (style.display === "none" || style.visibility === "hidden")) return false;
  return element.getClientRects().length > 0 || element === document.activeElement;
}

function accessibleName(element: HTMLElement): string {
  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) {
    const label = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ");
    if (text(label)) return text(label);
  }
  for (const attribute of ["aria-label", "title", "placeholder"]) {
    const value = text(element.getAttribute(attribute));
    if (value) return value;
  }
  const id = element.getAttribute("id");
  if (id) {
    const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (label && text(label.textContent)) return text(label.textContent);
  }
  const parentLabel = element.closest("label");
  if (parentLabel && text(parentLabel.textContent)) return text(parentLabel.textContent);
  return text(element.textContent) || element.tagName.toLowerCase();
}

function roleOf(element: HTMLElement): string {
  const explicit = element.getAttribute("role");
  if (explicit) return explicit;
  if (element instanceof HTMLButtonElement) return "button";
  if (element instanceof HTMLSelectElement) return "combobox";
  if (element instanceof HTMLTextAreaElement) return "textbox";
  if (element instanceof HTMLInputElement) {
    if (element.type === "checkbox") return "checkbox";
    if (element.type === "radio") return "radio";
    if (element.type === "range") return "slider";
    return "textbox";
  }
  if (element.isContentEditable) return "textbox";
  return element.tagName.toLowerCase();
}

function sensitiveControl(element: HTMLElement, name: string): boolean {
  const type = element.getAttribute("type")?.toLowerCase();
  if (type === "password" || type === "file") return true;
  return /token|secret|password|api[ _-]?key|private[ _-]?key/i.test(
    `${name} ${element.id} ${element.getAttribute("name") ?? ""}`,
  );
}

function panelName(element: HTMLElement): string | undefined {
  const panel = element.closest('[role="dialog"], [role="tabpanel"], [role="region"], form, section, aside');
  if (!(panel instanceof HTMLElement)) return undefined;
  const labelledBy = panel.getAttribute("aria-labelledby");
  if (labelledBy) {
    const labelled = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ");
    if (text(labelled)) return text(labelled);
  }
  const explicit = text(panel.getAttribute("aria-label") ?? panel.getAttribute("title"));
  if (explicit) return explicit;
  const heading = panel.querySelector("h1, h2, h3, h4, [data-panel-title]");
  return heading instanceof HTMLElement && text(heading.textContent) ? text(heading.textContent) : undefined;
}

function controlValue(element: ControlElement, sensitive: boolean): string | undefined {
  if (sensitive) return undefined;
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return element.value;
  if (element instanceof HTMLSelectElement) return element.value;
  if (element.isContentEditable) return element.textContent ?? "";
  return undefined;
}

function controlSnapshot(element: ControlElement, ref: string): UiControl {
  const name = accessibleName(element);
  const sensitive = sensitiveControl(element, name);
  const control: UiControl = {
    ref,
    role: roleOf(element),
    name,
    tag: element.tagName.toLowerCase(),
    disabled: Boolean(element.disabled || element.getAttribute("aria-disabled") === "true"),
  };
  const type = element.getAttribute("type");
  if (type) control.type = type;
  const panel = panelName(element);
  if (panel) control.panel = panel;
  const value = controlValue(element, sensitive);
  if (value !== undefined) control.value = text(value, 1000);
  if (element.hasAttribute("checked") || element instanceof HTMLInputElement) {
    if (element instanceof HTMLInputElement && (element.type === "checkbox" || element.type === "radio")) {
      control.checked = element.checked;
    }
  }
  const ariaChecked = element.getAttribute("aria-checked");
  if (ariaChecked !== null) control.checked = ariaChecked === "true";
  const ariaPressed = element.getAttribute("aria-pressed");
  if (ariaPressed !== null) control.pressed = ariaPressed === "true";
  const ariaExpanded = element.getAttribute("aria-expanded");
  if (ariaExpanded !== null) control.expanded = ariaExpanded === "true";
  if (element instanceof HTMLSelectElement) {
    control.options = [...element.options].slice(0, 100).map((option) => ({
      label: text(option.textContent, 180),
      value: option.value,
    }));
  }
  if (sensitive) control.sensitive = true;
  return control;
}

function candidates(): ControlElement[] {
  const selector =
    'button,input,textarea,select,[contenteditable="true"],[role="button"],[role="checkbox"],[role="combobox"],[role="radio"],[role="slider"],[role="switch"],[role="tab"],[role="option"]';
  const elements = [...document.querySelectorAll<HTMLElement>(selector)];
  return elements.filter(isVisible) as ControlElement[];
}

export function inspectUiControls(limit = 250): { ok: true; snapshot: UiSnapshot } | { ok: false; error: string } {
  if (typeof document === "undefined") return { ok: false, error: "UI JSON is available only in a browser page." };
  const bounded = Number.isInteger(limit) ? Math.max(1, Math.min(500, limit)) : 250;
  latestRevision += 1;
  latestRefs = new Map();
  const controls: UiControl[] = [];
  const panels = new Set<string>();
  const visible = candidates();
  for (const [index, element] of visible.slice(0, bounded).entries()) {
    const ref = `c${index + 1}`;
    latestRefs.set(ref, element);
    const control = controlSnapshot(element, ref);
    controls.push(control);
    if (control.panel) panels.add(control.panel);
  }
  return {
    ok: true,
    snapshot: {
      version: UI_JSON_VERSION,
      revision: latestRevision,
      controls,
      panels: [...panels],
      truncated: visible.length > bounded,
    },
  };
}

function operationError(operation: UiPatchOperation, error: string): UiPatchOutcome {
  return { ref: operation.ref, action: operation.action, ok: false, error };
}

function isTextControl(element: ControlElement): boolean {
  return element instanceof HTMLInputElement && !["checkbox", "radio", "file", "password"].includes(element.type)
    || element instanceof HTMLTextAreaElement
    || element.isContentEditable;
}

function findOption(value: string): HTMLElement | null {
  const normalized = value.trim().toLocaleLowerCase();
  return (
    candidates().find((element) => {
      if (element.getAttribute("role") !== "option") return false;
      const label = accessibleName(element).toLocaleLowerCase();
      return label === normalized || element.getAttribute("data-value")?.toLocaleLowerCase() === normalized;
    }) ?? null
  );
}

function setNativeText(element: ControlElement, value: string): void {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (setter) setter.call(element, value);
    else element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }
  element.textContent = value;
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

async function applyOperation(operation: UiPatchOperation, element: ControlElement): Promise<UiPatchOutcome> {
  const name = accessibleName(element);
  if (element.disabled || element.getAttribute("aria-disabled") === "true") {
    return operationError(operation, `Control "${name}" is disabled.`);
  }
  const sensitive = sensitiveControl(element, name);
  if ((operation.action === "fill" || operation.action === "select") && sensitive) {
    return operationError(operation, "Secret and file controls must be completed in the browser by the user.");
  }
  if (["fill", "select"].includes(operation.action) && operation.value === undefined) {
    return operationError(operation, `${operation.action} requires a string value.`);
  }
  if (operation.action === "fill") {
    if (!isTextControl(element)) return operationError(operation, `Control "${name}" does not accept text.`);
    setNativeText(element, operation.value!);
  } else if (operation.action === "select") {
    if (element instanceof HTMLSelectElement) {
      const option = [...element.options].find(
        (candidate) => candidate.value === operation.value || text(candidate.textContent) === operation.value,
      );
      if (!option) return operationError(operation, `No option "${operation.value}" is available for "${name}".`);
      element.value = option.value;
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (element.getAttribute("role") === "combobox") {
      element.click();
      await Promise.resolve();
      const option = findOption(operation.value!);
      if (!option) {
        element.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        return operationError(operation, `No visible option "${operation.value}" is available for "${name}".`);
      }
      option.click();
    } else {
      return operationError(operation, `Control "${name}" is not a selectable control.`);
    }
  } else if (operation.action === "check" || operation.action === "uncheck") {
    const desired = operation.action === "check";
    const current = element instanceof HTMLInputElement && ["checkbox", "radio"].includes(element.type)
      ? element.checked
      : element.getAttribute("aria-checked") === "true" || element.getAttribute("aria-pressed") === "true";
    if (current !== desired) element.click();
  } else if (operation.action === "click") {
    if (element instanceof HTMLInputElement && element.type === "file") {
      return operationError(operation, "File controls cannot be driven by a JSON path.");
    }
    element.click();
  } else if (operation.action === "focus") {
    element.focus();
  }
  return { ref: operation.ref, action: operation.action, ok: true, control: element.isConnected ? controlSnapshot(element, operation.ref) : null };
}

export async function applyUiPatch(
  args: Record<string, unknown>,
): Promise<{ ok: true; result: UiPatchResult } | { ok: false; error: string }> {
  if (typeof document === "undefined") return { ok: false, error: "UI JSON is available only in a browser page." };
  if (!Number.isInteger(args.revision) || args.revision !== latestRevision) {
    return { ok: false, error: "The UI snapshot is stale. Call get_ui_snapshot again before applying a patch." };
  }
  if (!Array.isArray(args.operations) || args.operations.length < 1 || args.operations.length > 50) {
    return { ok: false, error: "operations must contain between 1 and 50 JSON operations." };
  }
  const operations: UiPatchOperation[] = [];
  for (const raw of args.operations) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "Each operation must be a JSON object." };
    const operation = raw as Record<string, unknown>;
    if (typeof operation.ref !== "string" || typeof operation.action !== "string") {
      return { ok: false, error: "Each operation requires a string ref and action." };
    }
    if (!["click", "fill", "select", "check", "uncheck", "focus"].includes(operation.action)) {
      return { ok: false, error: `Unsupported UI action "${operation.action}".` };
    }
    if (operation.value !== undefined && typeof operation.value !== "string") {
      return { ok: false, error: "Operation value must be a string when provided." };
    }
    operations.push(operation as unknown as UiPatchOperation);
  }
  const outcomes: UiPatchOutcome[] = [];
  for (const operation of operations) {
    const element = latestRefs.get(operation.ref);
    if (!element || !element.isConnected || !isVisible(element)) {
      const outcome = operationError(operation, `Unknown or stale control ref "${operation.ref}".`);
      outcomes.push(outcome);
      return { ok: true, result: { version: UI_JSON_VERSION, revision: latestRevision, outcomes, stoppedAt: operation.ref } };
    }
    const outcome = await applyOperation(operation, element);
    outcomes.push(outcome);
    if (!outcome.ok) {
      return { ok: true, result: { version: UI_JSON_VERSION, revision: latestRevision, outcomes, stoppedAt: operation.ref } };
    }
  }
  return { ok: true, result: { version: UI_JSON_VERSION, revision: latestRevision, outcomes } };
}
