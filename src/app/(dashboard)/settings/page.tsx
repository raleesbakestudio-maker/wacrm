'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useEffect } from 'react';
import {
  Settings,
  MessageSquare,
  Tag,
  User,
  Palette,
  UsersRound,
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { WhatsAppConfig } from '@/components/settings/whatsapp-config';
import { TemplateManager } from '@/components/settings/template-manager';
import { TagManager } from '@/components/settings/tag-manager';
import { ProfileForm } from '@/components/settings/profile-form';
import { PasswordForm } from '@/components/settings/password-form';
import { SessionsCard } from '@/components/settings/sessions-card';
import { AppearancePanel } from '@/components/settings/appearance-panel';
import { MembersTab } from '@/components/settings/members-tab';

const TAB_VALUES = [
  'profile',
  'members',
  'whatsapp',
  'templates',
  'tags',
  'appearance',
] as const;
type TabValue = (typeof TAB_VALUES)[number];

function isTabValue(v: string | null): v is TabValue {
  return !!v && (TAB_VALUES as readonly string[]).includes(v);
}

export default function SettingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const queryTab = searchParams.get('tab');
  const [tab, setTab] = useState<TabValue>(() =>
    isTabValue(queryTab) ? queryTab : 'profile'
  );

  // Sync if URL query changes externally (e.g. from sidebar menu navigation)
  useEffect(() => {
    if (isTabValue(queryTab) && queryTab !== tab) {
      setTab(queryTab);
    }
  }, [queryTab, tab]);

  // Keep active tab visible in horizontal scroll on mobile
  useEffect(() => {
    const el = document.querySelector(`[data-slot="tabs-trigger"][data-value="${tab}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }, [tab]);

  const onChange = (next: TabValue) => {
    setTab(next);
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', next);
    router.replace(`/settings?${params.toString()}`, { scroll: false });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="text-sm text-slate-400 mt-1">
          Manage your profile, team & staff members, WhatsApp® integration, message templates, and tags.
        </p>
      </div>

      <Tabs value={tab} onValueChange={(v) => onChange(v as TabValue)} className="w-full">
        <div className="w-full overflow-x-auto pb-1.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <TabsList className="bg-slate-900 border border-slate-700 inline-flex w-max min-w-full justify-start">
            <TabsTrigger
              value="profile"
              className="data-active:bg-slate-800 data-active:text-primary text-slate-400"
            >
              <User className="size-4" />
              Profile
            </TabsTrigger>
            <TabsTrigger
              value="members"
              className="data-active:bg-slate-800 data-active:text-primary text-slate-400"
            >
              <UsersRound className="size-4" />
              Members
            </TabsTrigger>
            <TabsTrigger
              value="whatsapp"
              className="data-active:bg-slate-800 data-active:text-primary text-slate-400"
            >
              <Settings className="size-4" />
              WhatsApp Config
            </TabsTrigger>
            <TabsTrigger
              value="templates"
              className="data-active:bg-slate-800 data-active:text-primary text-slate-400"
            >
              <MessageSquare className="size-4" />
              Templates
            </TabsTrigger>
            <TabsTrigger
              value="tags"
              className="data-active:bg-slate-800 data-active:text-primary text-slate-400"
            >
              <Tag className="size-4" />
              Tags
            </TabsTrigger>
            <TabsTrigger
              value="appearance"
              className="data-active:bg-slate-800 data-active:text-primary text-slate-400"
            >
              <Palette className="size-4" />
              Appearance
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="profile" className="space-y-6">
          <ProfileForm />
          <PasswordForm />
          <SessionsCard />
        </TabsContent>

        <TabsContent value="members">
          <MembersTab />
        </TabsContent>

        <TabsContent value="whatsapp">
          <WhatsAppConfig />
        </TabsContent>

        <TabsContent value="templates">
          <TemplateManager />
        </TabsContent>

        <TabsContent value="tags">
          <TagManager />
        </TabsContent>

        <TabsContent value="appearance">
          <AppearancePanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
