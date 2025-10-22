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
  // Define the structure based on your Cloudflare analytics response
  [key: string]: any;
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
}