
'use client';

import { 
  getFirestore, 
  collection, 
  getDocs, 
  query, 
  collectionGroup 
} from 'firebase/firestore';
import { createClient } from '@/lib/supabase/client';

export type MigrationStats = {
  entity: string;
  sourceCount: number;
  destCount: number;
  success: boolean;
  errors: string[];
  totalFinancials?: {
    source: number;
    dest: number;
  };
};

/**
 * @fileOverview Migration engine for CACU transition.
 * Maps Firestore documents to Supabase relational tables.
 */
export class MigrationEngine {
  private db = getFirestore();
  private supabase = createClient();

  async runMigration(): Promise<MigrationStats[]> {
    const report: MigrationStats[] = [];

    // 1. Migrate Businesses
    const bizStats = await this.migrateBusinesses();
    report.push(bizStats);

    // 2. Migrate Customers
    const custStats = await this.migrateCustomers();
    report.push(custStats);

    // 3. Migrate Catalog/Inventory
    const catalogStats = await this.migrateCatalog();
    report.push(catalogStats);

    // 4. Migrate Financial Ledger
    const ledgerStats = await this.migrateLedger();
    report.push(ledgerStats);

    // 5. Migrate Employees
    const hrStats = await this.migrateEmployees();
    report.push(hrStats);

    return report;
  }

  private async migrateBusinesses(): Promise<MigrationStats> {
    const stats: MigrationStats = { entity: 'Businesses', sourceCount: 0, destCount: 0, success: false, errors: [] };
    try {
      const snap = await getDocs(collection(this.db, 'businesses'));
      stats.sourceCount = snap.size;

      for (const doc of snap.docs) {
        const data = doc.data();
        const { error } = await this.supabase.from('businesses').upsert({
          id: doc.id,
          name: data.name,
          business_type: data.businessType || 'HYBRID',
          sector: data.sector || 'General',
          owner_uid: data.ownerUid,
          created_at: data.createdAt?.toDate?.()?.toISOString() || new Date().toISOString()
        });
        if (error) stats.errors.push(`Biz ${doc.id}: ${error.message}`);
        
        // Ensure membership is created
        if (data.ownerUid) {
          await this.supabase.from('business_members').upsert({
            business_id: doc.id,
            user_id: data.ownerUid,
            role: 'Owner'
          });
        }
      }
      stats.success = stats.errors.length === 0;
      const { count } = await this.supabase.from('businesses').select('*', { count: 'exact', head: true });
      stats.destCount = count || 0;
    } catch (e: any) {
      stats.errors.push(e.message);
    }
    return stats;
  }

  private async migrateCustomers(): Promise<MigrationStats> {
    const stats: MigrationStats = { entity: 'Customers', sourceCount: 0, destCount: 0, success: false, errors: [] };
    try {
      // Assuming customers were sub-collections of businesses in Firestore
      const snap = await getDocs(collectionGroup(this.db, 'customers'));
      stats.sourceCount = snap.size;

      for (const doc of snap.docs) {
        const data = doc.data();
        const bizId = doc.ref.parent.parent?.id;
        if (!bizId) continue;

        const { error } = await this.supabase.from('customers').upsert({
          id: doc.id,
          business_id: bizId,
          name: data.name,
          email: data.email,
          phone: data.phone,
          lifetime_spend: data.lifetimeSpend || 0
        });
        if (error) stats.errors.push(`Cust ${doc.id}: ${error.message}`);
      }
      stats.success = stats.errors.length === 0;
      const { count } = await this.supabase.from('customers').select('*', { count: 'exact', head: true });
      stats.destCount = count || 0;
    } catch (e: any) {
      stats.errors.push(e.message);
    }
    return stats;
  }

  private async migrateCatalog(): Promise<MigrationStats> {
    const stats: MigrationStats = { entity: 'Catalog Items', sourceCount: 0, destCount: 0, success: false, errors: [] };
    try {
      const snap = await getDocs(collectionGroup(this.db, 'catalog'));
      stats.sourceCount = snap.size;

      for (const doc of snap.docs) {
        const data = doc.data();
        const bizId = doc.ref.parent.parent?.id;
        if (!bizId) continue;

        const { error } = await this.supabase.from('catalog_items').upsert({
          id: doc.id,
          business_id: bizId,
          name: data.name,
          sku: data.sku,
          price: data.price || 0,
          quantity: data.quantity || 0,
          type: data.type || 'Product',
          reorder_level: data.reorderLevel || 5
        });
        if (error) stats.errors.push(`Item ${doc.id}: ${error.message}`);
      }
      stats.success = stats.errors.length === 0;
      const { count } = await this.supabase.from('catalog_items').select('*', { count: 'exact', head: true });
      stats.destCount = count || 0;
    } catch (e: any) {
      stats.errors.push(e.message);
    }
    return stats;
  }

  private async migrateLedger(): Promise<MigrationStats> {
    const stats: MigrationStats = { 
      entity: 'Ledger (Transactions)', 
      sourceCount: 0, 
      destCount: 0, 
      success: false, 
      errors: [],
      totalFinancials: { source: 0, dest: 0 }
    };
    try {
      const snap = await getDocs(collection(this.db, 'transactions'));
      stats.sourceCount = snap.size;

      for (const doc of snap.docs) {
        const data = doc.data();
        stats.totalFinancials!.source += Number(data.amount) || 0;

        const { error } = await this.supabase.from('financial_transactions').upsert({
          id: doc.id,
          business_id: data.businessId,
          description: data.description,
          amount: data.amount,
          type: data.type || 'Income',
          category: data.category || 'General',
          date: data.date || new Date().toISOString()
        });
        if (error) stats.errors.push(`Tx ${doc.id}: ${error.message}`);
      }

      const { data: destSum } = await this.supabase.from('financial_transactions').select('amount');
      stats.totalFinancials!.dest = destSum?.reduce((acc, curr) => acc + Number(curr.amount), 0) || 0;
      
      stats.success = stats.errors.length === 0 && Math.abs(stats.totalFinancials!.source - stats.totalFinancials!.dest) < 0.01;
      const { count } = await this.supabase.from('financial_transactions').select('*', { count: 'exact', head: true });
      stats.destCount = count || 0;
    } catch (e: any) {
      stats.errors.push(e.message);
    }
    return stats;
  }

  private async migrateEmployees(): Promise<MigrationStats> {
    const stats: MigrationStats = { entity: 'Employees', sourceCount: 0, destCount: 0, success: false, errors: [] };
    try {
      const snap = await getDocs(collection(this.db, 'employees'));
      stats.sourceCount = snap.size;

      for (const doc of snap.docs) {
        const data = doc.data();
        const { error } = await this.supabase.from('employees').upsert({
          id: doc.id,
          business_id: data.businessId,
          name: data.name,
          role: data.role,
          base_salary: data.baseSalary || 0,
          status: data.status || 'Active'
        });
        if (error) stats.errors.push(`Emp ${doc.id}: ${error.message}`);
      }
      stats.success = stats.errors.length === 0;
      const { count } = await this.supabase.from('employees').select('*', { count: 'exact', head: true });
      stats.destCount = count || 0;
    } catch (e: any) {
      stats.errors.push(e.message);
    }
    return stats;
  }
}
