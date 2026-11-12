// Test-only import transport: never included in proposed runtime inputs.
import { vi } from "vitest";
import type { NotificationPanelProps } from "~/components/notifications/NotificationPanel";
import type { ComponentType } from "react";
export const loadTestPanel =
  vi.fn<() => Promise<{ default: ComponentType<NotificationPanelProps> }>>();
