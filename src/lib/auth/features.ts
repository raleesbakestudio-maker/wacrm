export interface FeatureDefinition {
  id: string;
  label: string;
  description: string;
  defaultForAgent: boolean;
}

export const APP_FEATURES: readonly FeatureDefinition[] = [
  {
    id: "inbox",
    label: "Inbox & Chats",
    description: "Send & receive WhatsApp messages and view customer chats",
    defaultForAgent: true,
  },
  {
    id: "contacts",
    label: "Contacts & Tags",
    description: "Manage customers, filter by tags, and export/import contacts",
    defaultForAgent: true,
  },
  {
    id: "dashboard",
    label: "Dashboard",
    description: "View overview metrics, analytics, and recent activity",
    defaultForAgent: true,
  },
  {
    id: "broadcasts",
    label: "Broadcasts",
    description: "Create and send bulk WhatsApp messaging campaigns",
    defaultForAgent: false,
  },
  {
    id: "automations",
    label: "Automations",
    description: "Set up keywords and automated message triggers",
    defaultForAgent: false,
  },
  {
    id: "flows",
    label: "Flows (Chatbot)",
    description: "Build visual chatbot conversation flows",
    defaultForAgent: false,
  },
  {
    id: "settings",
    label: "Settings",
    description: "Account settings, team members, and WhatsApp config",
    defaultForAgent: false,
  },
] as const;

export const DEFAULT_AGENT_FEATURES = APP_FEATURES.filter(
  (f) => f.defaultForAgent
).map((f) => f.id);
