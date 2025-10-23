import { Component, Input, computed, signal, ViewChild, ElementRef, AfterViewInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import Chart from 'chart.js/auto';

@Component({
  selector: 'app-traffic-overview',
  standalone: true,
  imports: [CommonModule],
  template: `
  <div class="rounded-2xl bg-white shadow-md p-4 md:p-6 h-full">
    <div class="flex items-center justify-between mb-3">
      <div>
        <h3 class="text-base font-semibold text-slate-800">Traffic Overview</h3>
        <p class="text-xs text-slate-500">{{subtitle}}</p>
      </div>
      <div class="flex items-center gap-2 text-xs text-slate-500">
        <span class="inline-flex items-center gap-1">
          <span class="w-3 h-3 inline-block rounded-sm" [style.background]="requestsColor"></span>
          Requests
        </span>
        <span class="inline-flex items-center gap-1">
          <span class="w-3 h-3 inline-block rounded-sm" [style.background]="cachedColor"></span>
          Cached
        </span>
      </div>
    </div>

    <div *ngIf="labels().length === 0" class="h-56 grid place-items-center text-slate-400">
      No data for selected range
    </div>

    <div *ngIf="labels().length > 0" class="min-h-[14rem]">
      <canvas #trafficChart></canvas>
    </div>
  </div>
  `
})
export class TrafficOverviewComponent implements AfterViewInit, OnDestroy {
  @ViewChild('trafficChart', { static: false }) chartRef!: ElementRef<HTMLCanvasElement>;
  
  /** rows: [{label, total, cached, bytes}] */
  @Input() set rows(value: any[] | null | undefined) {
    this._rows.set(Array.isArray(value) ? value : []);
  }
  @Input() siteName = '';
  @Input() fromISO = ''; // ISO string
  @Input() toISO = '';   // ISO string

  // Signals
  private _rows = signal<any[]>([]);
  private chart: Chart | null = null;

  // Colors (giữ đồng bộ brand)
  requestsColor = 'rgba(59,130,246,0.9)';    // blue-500
  requestsFill  = 'rgba(59,130,246,0.15)';
  cachedColor   = 'rgba(16,185,129,0.9)';    // emerald-500
  cachedFill    = 'rgba(16,185,129,0.12)';

  // Labels tính từ rows.label (tự nhận dạng day vs datetime)
  labels = computed(() => {
    const r = this._rows();
    // sort theo thời gian để line đi đúng hướng
    const sorted = [...r].sort((a,b) => new Date(a.label).getTime() - new Date(b.label).getTime());
    return sorted.map(item => this.prettyLabel(item.label));
  });

  chartData = computed(() => {
    const r = this._rows();
    const sorted = [...r].sort((a,b) => new Date(a.label).getTime() - new Date(b.label).getTime());
    const totals = sorted.map(x => x.total ?? 0);
    const cached = sorted.map(x => x.cached ?? 0);

    return {
      labels: this.labels(),
      datasets: [
        {
          label: 'Requests',
          data: totals,
          tension: 0.35,
          borderColor: this.requestsColor,
          backgroundColor: this.requestsFill,
          pointRadius: 2,
          pointHoverRadius: 4,
          fill: true,
          borderWidth: 2
        },
        {
          label: 'Cached',
          data: cached,
          tension: 0.35,
          borderColor: this.cachedColor,
          backgroundColor: this.cachedFill,
          pointRadius: 2,
          pointHoverRadius: 4,
          fill: true,
          borderWidth: 2
        }
      ]
    };
  });

  ngAfterViewInit() {
    this.initializeChart();
  }

  ngOnDestroy() {
    if (this.chart) {
      this.chart.destroy();
    }
  }

  private initializeChart() {
    if (this.chartRef) {
      this.chart = new Chart(this.chartRef.nativeElement, {
        type: 'line',
        data: this.chartData(),
        options: {
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
              borderColor: 'rgba(255, 255, 255, 0.2)',
              borderWidth: 1
            }
          },
          interaction: { 
            mode: 'index', 
            intersect: false 
          },
          scales: {
            x: {
              grid: {
                display: false
              },
              ticks: { 
                maxTicksLimit: 8,
                color: '#64748b',
                font: {
                  family: 'Inter, sans-serif',
                  size: 12
                }
              }
            },
            y: {
              beginAtZero: true,
              grid: {
                color: '#f1f5f9'
              },
              ticks: { 
                precision: 0,
                color: '#64748b',
                font: {
                  family: 'Inter, sans-serif',
                  size: 12
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

      // Update chart when data changes
      this.updateChart();
    }
  }

  private updateChart() {
    if (this.chart) {
      this.chart.data = this.chartData();
      this.chart.update('active');
    }
  }

  get subtitle(): string {
    const from = this.fromISO ? this.humanDate(this.fromISO) : '';
    const to   = this.toISO   ? this.humanDate(this.toISO)   : '';
    const n = this.siteName ? `${this.siteName} • ` : '';
    return `${n}${from} - ${to}`.trim();
  }

  private humanDate(iso: string) {
    // Hiển thị theo local, fallback
    const d = new Date(iso);
    return isNaN(d.getTime()) ? iso : d.toLocaleDateString();
  }

  private prettyLabel(label: string) {
    // Nếu có 'T' → datetime; nếu không → YYYY-MM-DD
    if (label.includes('T')) {
      const d = new Date(label);
      if (!isNaN(d.getTime())) {
        // HH:mm (dd/MM)
        const hh = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const dd = d.toLocaleDateString();
        return `${hh}\n${dd}`;
      }
    }
    return label;
  }
}
