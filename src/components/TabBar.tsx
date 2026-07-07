import { Camera, Calendar, Search } from 'lucide-react';
import { cn } from '@/src/lib/utils';

interface TabBarProps {
  activeTab: 'capture' | 'today' | 'search' | 'settings';
  onTabChange: (tab: 'capture' | 'today' | 'search' | 'settings') => void;
}

export default function TabBar({ activeTab, onTabChange }: TabBarProps) {
  const tabs = [
    { id: 'capture', label: 'Chụp ảnh', icon: Camera },
    { id: 'today', label: 'Xe Hôm Nay', icon: Calendar },
    { id: 'search', label: 'Tìm phiên', icon: Search },
    { id: 'settings', label: 'Cài đặt', icon: () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.72V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.17a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg> },
  ] as const;

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-toyota-navy text-white px-2 pb-safe pt-2 z-50 shadow-2xl">
      <div className="max-w-md mx-auto flex justify-around items-center">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id as any)}
              className={cn(
                "flex flex-col items-center py-2 px-4 transition-all duration-300 relative",
                isActive ? "opacity-100" : "opacity-40 hover:opacity-70"
              )}
            >
              <div className={cn(
                "w-10 h-1 bg-toyota-red rounded-full mb-1 transition-all",
                isActive ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-2"
              )} />
              <div className="mb-0.5">
                <Icon size={22} strokeWidth={2.5} />
              </div>
              <span className="text-[10px] font-black uppercase tracking-tight">
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
