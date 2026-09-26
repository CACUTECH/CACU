
'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

interface BusinessContextType {
  business: any | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

const BusinessContext = createContext<BusinessContextType | undefined>(undefined);

export function BusinessProvider({ children }: { children: React.ReactNode }) {
  const [business, setBusiness] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  const fetchBusiness = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setBusiness(null);
      setLoading(false);
      return;
    }

    const { data: member } = await supabase
      .from('memberships')
      .select('role, businesses (*)')
      .eq('user_id', user.id)
      .maybeSingle();

    if (member) {
      const business = Array.isArray(member.businesses) ? member.businesses[0] : member.businesses;
      setBusiness({
        ...business,
        userRole: member.role
      });
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchBusiness();
  }, []);

  return (
    <BusinessContext.Provider value={{ business, loading, refresh: fetchBusiness }}>
      {children}
    </BusinessContext.Provider>
  );
}

export function useBusiness() {
  const context = useContext(BusinessContext);
  if (context === undefined) {
    throw new Error('useBusiness must be used within a BusinessProvider');
  }
  return context;
}
