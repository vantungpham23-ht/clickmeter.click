import { Component, OnInit, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AnalyticsService } from '../analytics.service';
import { AuthService } from '../auth.service';
import Chart from 'chart.js/auto';

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
  rows?: Array<{
    label: string;
    total: number;
    cached: number;
    bytes: number;
  }>;
  raw?: any;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss']
})
export class DashboardComponent implements OnInit, AfterViewInit {
  @ViewChild('trafficChart', { static: false }) chartRef!: ElementRef<HTMLCanvasElement>;
  
  sites: Site[] = [];
  selectedSiteId: number | null = null;
  dateFrom: string = '';
  analyticsData: AnalyticsData | null = null;
  isLoading: boolean = false;
  errorMessage: string = '';
  chart: Chart | null = null;

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

  ngAfterViewInit() {
    this.initializeChart();
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
      this.updateChart();
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
    if (!this.analyticsData?.rows) return 0;
    return this.analyticsData.rows.reduce((total, row) => total + row.total, 0);
  }

  getTotalBytes(): string {
    if (!this.analyticsData?.rows) return '0 MB';
    const totalBytes = this.analyticsData.rows.reduce((total, row) => total + row.bytes, 0);
    return this.formatBytes(totalBytes);
  }

  getCachedRequests(): number {
    if (!this.analyticsData?.rows) return 0;
    return this.analyticsData.rows.reduce((total, row) => total + row.cached, 0);
  }

  getCacheHitRatio(): number {
    const total = this.getTotalRequests();
    const cached = this.getCachedRequests();
    if (total === 0) return 0;
    return Math.round((cached / total) * 100);
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 MB';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  private initializeChart() {
    if (this.chartRef) {
      this.chart = new Chart(this.chartRef.nativeElement, {
        type: 'line',
        data: {
          labels: [],
          datasets: [{
            label: 'Requests',
            data: [],
            borderColor: '#3B82F6',
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
            borderWidth: 2,
            fill: true,
            tension: 0.4,
            pointBackgroundColor: '#3B82F6',
            pointBorderColor: '#ffffff',
            pointBorderWidth: 2,
            pointRadius: 4,
            pointHoverRadius: 6
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              display: false
            }
          },
          scales: {
            x: {
              grid: {
                display: false
              },
              ticks: {
                color: '#64748b',
                font: {
                  family: 'Inter, sans-serif'
                }
              }
            },
            y: {
              grid: {
                color: '#f1f5f9'
              },
              ticks: {
                color: '#64748b',
                font: {
                  family: 'Inter, sans-serif'
                }
              }
            }
          },
          animation: {
            duration: 1000,
            easing: 'easeInOutQuart'
          }
        }
      });
    }
  }

  private updateChart() {
    if (this.chart && this.analyticsData?.rows) {
      const labels = this.analyticsData.rows.map(row => {
        // Format date for display
        const date = new Date(row.label);
        return date.toLocaleDateString('vi-VN', { month: 'short', day: 'numeric' });
      });
      
      const data = this.analyticsData.rows.map(row => row.total);
      
      this.chart.data.labels = labels;
      this.chart.data.datasets[0].data = data;
      this.chart.update('active');
    }
  }
}