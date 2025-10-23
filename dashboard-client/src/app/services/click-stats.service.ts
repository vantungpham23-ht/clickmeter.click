import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';

@Injectable({ providedIn: 'root' })
export class ClickStatsService {
  private fnUrl = 'https://tkzeotjknumllqvkgkzk.functions.supabase.co/click-stats';
  constructor(private http: HttpClient) {}
  get(site_id: string, path: string) {
    return this.http.post<any>(this.fnUrl, { site_id, path });
  }
}
