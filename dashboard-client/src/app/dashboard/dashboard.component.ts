import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AnalyticsService } from '../analytics.service';
import { AuthService } from '../auth.service';

interface Site {
  id: number;
  site_name: string;
  filter_path: string;
}

interface AnalyticsData {
  site_id: string;
  filter_path: string;
  from: string;
  to: string;
  cloudflare: {
    data?: {
      viewer?: {
        zones?: Array<{
          httpRequestsAdaptiveGroups?: Array<{
            dimensions: { datetime: string; clientRequestPath?: string };
            sum: { 
              count: number; 
              bytes: number; 
              cachedCount: number; 
              uncachedCount: number;
              edgeResponseBytes: number;
            };
          }>;
        }>;
      };
    };
  };
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss']
})
export class DashboardComponent implements OnInit {
  sites: Site[] = [];
  selectedSiteId: number | null = null;
  dateFrom: string = '';
  analyticsData: AnalyticsData | null = null;
  isLoading: boolean = false;
  errorMessage: string = '';

  constructor(
    private analyticsService: AnalyticsService,
    public authService: AuthService
  ) {}

  async ngOnInit() {
    await this.loadSites();
    // Set default date to 7 days ago
    const date = new Date();
    date.setDate(date.getDate() - 7);
    this.dateFrom = date.toISOString().split('T')[0];
  }

  async loadSites() {
    try {
      this.sites = await this.analyticsService.getMySites();
      if (this.sites.length > 0) {
        this.selectedSiteId = this.sites[0].id;
      }
    } catch (error) {
      console.error('Error loading sites:', error);
      this.errorMessage = 'Không thể tải danh sách site';
    }
  }

  async loadAnalytics() {
    if (!this.selectedSiteId || !this.dateFrom) {
      this.errorMessage = 'Vui lòng chọn site và ngày bắt đầu';
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';

    try {
      this.analyticsData = await this.analyticsService.getAnalyticsData(
        this.selectedSiteId, 
        this.dateFrom
      );
    } catch (error) {
      console.error('Error loading analytics:', error);
      this.errorMessage = 'Không thể tải dữ liệu analytics';
    } finally {
      this.isLoading = false;
    }
  }

  onSiteChange() {
    this.analyticsData = null;
  }

  onDateChange() {
    this.analyticsData = null;
  }

  getSelectedSiteName(): string {
    const site = this.sites.find(s => s.id === this.selectedSiteId);
    return site ? site.site_name : 'Chưa chọn site';
  }

  getTotalRequests(): number {
    if (!this.analyticsData?.['cloudflare']?.['data']?.['viewer']?.['zones']?.[0]?.['httpRequestsAdaptiveGroups']) {
      return 0;
    }
    return this.analyticsData['cloudflare']['data']['viewer']['zones'][0]['httpRequestsAdaptiveGroups']
      .reduce((total: number, group: any) => total + (group.sum?.count || 0), 0);
  }

  getTotalBytes(): string {
    if (!this.analyticsData?.['cloudflare']?.['data']?.['viewer']?.['zones']?.[0]?.['httpRequestsAdaptiveGroups']) {
      return '0 B';
    }
    const totalBytes = this.analyticsData['cloudflare']['data']['viewer']['zones'][0]['httpRequestsAdaptiveGroups']
      .reduce((total: number, group: any) => total + (group.sum?.bytes || 0), 0);
    return this.formatBytes(totalBytes);
  }

  getCachedRequests(): number {
    if (!this.analyticsData?.['cloudflare']?.['data']?.['viewer']?.['zones']?.[0]?.['httpRequestsAdaptiveGroups']) {
      return 0;
    }
    return this.analyticsData['cloudflare']['data']['viewer']['zones'][0]['httpRequestsAdaptiveGroups']
      .reduce((total: number, group: any) => total + (group.sum?.cachedCount || 0), 0);
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}