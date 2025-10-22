import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class AnalyticsService {
  private supabase: SupabaseClient | null = null;

  constructor(@Inject(PLATFORM_ID) private platformId: Object) {
    if (isPlatformBrowser(this.platformId)) {
      this.supabase = createClient(environment.supabase.url, environment.supabase.anonKey);
    }
  }

  // Đây là hàm gọi Edge Function
  async getAnalyticsData(siteId: number, dateFrom: string) {
    if (!this.supabase) return null;
    
    const { data, error } = await this.supabase.functions.invoke('get-cloudflare-analytics', {
      method: 'POST',
      body: {
        site_id: siteId,
        date_from: dateFrom // Format: "YYYY-MM-DD"
      }
    });

    if (error) {
      console.error('Error invoking function:', error);
      return null;
    }
    return data;
  }
  
  // Hàm lấy danh sách site của user
  async getMySites() {
    if (!this.supabase) return [];
    
    const { data: { session } } = await this.supabase.auth.getSession();
    if (!session) return [];

    const { data, error } = await this.supabase
      .from('sites')
      .select('id, site_name, filter_path');
      // RLS tự động lọc theo user_id
    
    if (error) {
      console.error('Error fetching sites:', error);
      return [];
    }
    return data;
  }
}