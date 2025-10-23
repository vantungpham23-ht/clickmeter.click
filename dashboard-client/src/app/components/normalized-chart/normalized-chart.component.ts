import { Component, Input, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ChartConfiguration, ChartDataset, ChartOptions, ChartType, registerables } from 'chart.js';
import { Chart } from 'chart.js';

// Đăng ký tất cả phần mở rộng Chart.js
Chart.register(...registerables);

@Component({
  selector: 'app-normalized-chart',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="rounded-2xl bg-white shadow-md p-4 md:p-6 h-full">
      <div class="flex items-center justify-between mb-3">
        <div>
          <h3 class="text-base font-semibold text-slate-800">Normalized Clicks Trend</h3>
          <p class="text-xs text-slate-500">7 ngày gần nhất</p>
        </div>
      </div>
      
      <div *ngIf="labels().length === 0" class="h-48 grid place-items-center text-slate-400">
        Chưa có dữ liệu lịch sử
      </div>
      
      <div *ngIf="labels().length > 0" class="min-h-[12rem]">
        <canvas baseChart
          [data]="chartData()"
          [labels]="labels()"
          [type]="chartType"
          [options]="options">
        </canvas>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
    }
  `]
})
export class NormalizedChartComponent {
  @Input() set history(value: any[] | null | undefined) {
    this._history.set(Array.isArray(value) ? value : []);
  }

  // Signals
  private _history = signal<any[]>([]);
  
  // Colors
  normalizedColor = 'rgba(168, 85, 247, 0.9)'; // purple-500
  normalizedFill = 'rgba(168, 85, 247, 0.15)';
  
  chartType: ChartType = 'line' as const;

  // Labels tính từ history.click_date
  labels = computed(() => {
    const h = this._history();
    // Sort theo ngày để line đi đúng hướng
    const sorted = [...h].sort((a, b) => new Date(a.click_date).getTime() - new Date(b.click_date).getTime());
    return sorted.map(item => this.formatDate(item.click_date));
  });

  chartData = computed<ChartConfiguration['data']>(() => {
    const h = this._history();
    const sorted = [...h].sort((a, b) => new Date(a.click_date).getTime() - new Date(b.click_date).getTime());
    const clicks = sorted.map(x => x.clicks_24h ?? 0);

    const datasets: ChartDataset<'line'>[] = [
      {
        label: 'Normalized Clicks',
        data: clicks,
        tension: 0.35,
        borderColor: this.normalizedColor,
        backgroundColor: this.normalizedFill,
        pointRadius: 3,
        pointHoverRadius: 5,
        fill: true,
        borderWidth: 2
      }
    ];

    return { datasets, labels: this.labels() };
  });

  options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false
      },
      tooltip: {
        mode: 'index',
        intersect: false,
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        titleColor: 'white',
        bodyColor: 'white',
        borderColor: 'rgba(255, 255, 255, 0.1)',
        borderWidth: 1
      }
    },
    interaction: {
      mode: 'index',
      intersect: false
    },
    scales: {
      x: {
        ticks: {
          maxTicksLimit: 7,
          color: '#64748b'
        },
        grid: {
          color: 'rgba(0, 0, 0, 0.05)'
        }
      },
      y: {
        beginAtZero: true,
        ticks: {
          precision: 0,
          color: '#64748b'
        },
        grid: {
          color: 'rgba(0, 0, 0, 0.05)'
        }
      }
    }
  };

  private formatDate(dateStr: string): string {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    
    // Format as DD/MM
    const day = d.getDate().toString().padStart(2, '0');
    const month = (d.getMonth() + 1).toString().padStart(2, '0');
    return `${day}/${month}`;
  }
}
