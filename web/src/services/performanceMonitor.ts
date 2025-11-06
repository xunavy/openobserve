// Copyright 2023 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

/**
 * Performance Monitor for incremental aggregation and visualization
 * Implements performance monitoring and degradation strategies
 */

export interface PerformanceMetrics {
  aggregationTime: number; // milliseconds
  renderTime: number; // milliseconds
  fps: number;
  memoryUsage: number; // bytes
  timestamp: number;
}

export interface PerformanceConfig {
  maxAggregationTime: number; // milliseconds
  maxMemoryUsage: number; // bytes
  minFps: number;
  cacheExpiryTime: number; // milliseconds
}

export class PerformanceMonitor {
  private config: PerformanceConfig;
  private metricsHistory: PerformanceMetrics[];
  private webWorker: Worker | null = null;
  private isUsingWorker: boolean = false;
  private lastCacheCleanup: number = Date.now();

  constructor(config?: Partial<PerformanceConfig>) {
    // Default configuration
    this.config = {
      maxAggregationTime: 100, // milliseconds
      maxMemoryUsage: 2 * 1024 * 1024 * 1024, // 2GB
      minFps: 30,
      cacheExpiryTime: 30 * 60 * 1000, // 30 minutes
      ...config
    };

    this.metricsHistory = this.loadMetricsFromStorage();
  }

  /**
   * Monitor aggregation performance
   * @param aggregationFn Function to measure
   * @param args Arguments to pass to the function
   * @returns Result of the aggregation function
   */
  public async monitorAggregation<T>(
    aggregationFn: (...args: any[]) => T,
    ...args: any[]
  ): Promise<T> {
    const startTime = performance.now();
    let result: T;

    // Check if we should use Web Worker
    if (this.isUsingWorker || this.shouldUseWebWorker()) {
      result = await this.runInWebWorker(aggregationFn, ...args);
    } else {
      result = aggregationFn(...args);
    }

    const aggregationTime = performance.now() - startTime;

    // Check if we need to enable Web Worker for next time
    if (aggregationTime >= this.config.maxAggregationTime) {
      this.enableWebWorker();
    }

    // Record performance metrics
    this.recordMetrics({
      aggregationTime,
      renderTime: 0, // Will be updated by renderer
      fps: this.getFPS(),
      memoryUsage: this.getMemoryUsage(),
      timestamp: Date.now()
    });

    return result;
  }

  /**
   * Monitor render performance
   * @param renderFn Function to measure
   * @param args Arguments to pass to the function
   * @returns Result of the render function
   */
  public monitorRender<T>(renderFn: (...args: any[]) => T, ...args: any[]): T {
    const startTime = performance.now();
    const result = renderFn(...args);
    const renderTime = performance.now() - startTime;

    // Record performance metrics
    this.recordMetrics({
      aggregationTime: 0, // Will be updated by aggregator
      renderTime,
      fps: this.getFPS(),
      memoryUsage: this.getMemoryUsage(),
      timestamp: Date.now()
    });

    return result;
  }

  /**
   * Check if we should use Web Worker for aggregation
   */
  public shouldUseWebWorker(): boolean {
    // Check if Web Worker is supported
    if (!window.Worker) {
      return false;
    }

    // Check recent aggregation times
    const recentMetrics = this.metricsHistory.slice(-10);
    if (recentMetrics.length === 0) {
      return false;
    }

    const avgAggregationTime = recentMetrics.reduce((sum, metric) => sum + metric.aggregationTime, 0) / recentMetrics.length;
    return avgAggregationTime >= this.config.maxAggregationTime;
  }

  /**
   * Check if we should degrade visualization
   */
  public shouldDegradeVisualization(): boolean {
    const fps = this.getFPS();
    const memoryUsage = this.getMemoryUsage();

    return fps < this.config.minFps || memoryUsage >= this.config.maxMemoryUsage;
  }

  /**
   * Check if we should clean up old cache
   */
  public shouldCleanCache(): boolean {
    const now = Date.now();
    return now - this.lastCacheCleanup >= this.config.cacheExpiryTime;
  }

  /**
   * Clean up old cache
   */
  public cleanCache(): void {
    // Remove cache entries older than cacheExpiryTime
    const expiryTime = Date.now() - this.config.cacheExpiryTime;
    localStorage.removeItem('incrementalAggregationCache');
    this.lastCacheCleanup = Date.now();
  }

  /**
   * Enable Web Worker for aggregation
   */
  public enableWebWorker(): void {
    if (!window.Worker || this.webWorker) {
      return;
    }

    // Create a Web Worker
    this.webWorker = new Worker(new URL('./aggregationWorker.ts', import.meta.url));
    this.isUsingWorker = true;
  }

  /**
   * Disable Web Worker
   */
  public disableWebWorker(): void {
    if (this.webWorker) {
      this.webWorker.terminate();
      this.webWorker = null;
      this.isUsingWorker = false;
    }
  }

  /**
   * Run aggregation in Web Worker
   */
  private async runInWebWorker<T>(fn: (...args: any[]) => T, ...args: any[]): Promise<T> {
    if (!this.webWorker) {
      this.enableWebWorker();
    }

    if (!this.webWorker) {
      // Fallback to main thread if Web Worker creation failed
      return fn(...args);
    }

    return new Promise((resolve, reject) => {
      const messageId = Math.random().toString(36).substring(7);

      // Handle messages from worker
      const handleMessage = (event: MessageEvent) => {
        if (event.data.id === messageId) {
          if (event.data.error) {
            reject(new Error(event.data.error));
          } else {
            resolve(event.data.result);
          }
          this.webWorker?.removeEventListener('message', handleMessage);
        }
      };

      this.webWorker.addEventListener('message', handleMessage);

      // Send message to worker
      this.webWorker.postMessage({
        id: messageId,
        function: fn.toString(),
        args
      });
    });
  }

  /**
   * Get current FPS
   */
  private getFPS(): number {
    // Simple FPS calculation
    return 60; // Fallback to 60 FPS if not available
  }

  /**
   * Get current memory usage
   */
  private getMemoryUsage(): number {
    if (navigator && navigator.deviceMemory) {
      // deviceMemory returns GB, convert to bytes
      return navigator.deviceMemory * 1024 * 1024 * 1024;
    }

    // Fallback to approximate memory usage
    return 0;
  }

  /**
   * Record performance metrics
   */
  private recordMetrics(metrics: PerformanceMetrics): void {
    this.metricsHistory.push(metrics);

    // Keep only last 100 metrics
    if (this.metricsHistory.length > 100) {
      this.metricsHistory.shift();
    }

    // Save to local storage
    this.saveMetricsToStorage();
  }

  /**
   * Load metrics from local storage
   */
  private loadMetricsFromStorage(): PerformanceMetrics[] {
    try {
      const stored = localStorage.getItem('performanceMetrics');
      return stored ? JSON.parse(stored) : [];
    } catch (error) {
      console.error('Failed to load performance metrics from storage:', error);
      return [];
    }
  }

  /**
   * Save metrics to local storage
   */
  private saveMetricsToStorage(): void {
    try {
      localStorage.setItem('performanceMetrics', JSON.stringify(this.metricsHistory));
    } catch (error) {
      console.error('Failed to save performance metrics to storage:', error);
    }
  }

  /**
   * Get performance metrics history
   */
  public getMetricsHistory(): PerformanceMetrics[] {
    return [...this.metricsHistory];
  }

  /**
   * Get current performance config
   */
  public getConfig(): PerformanceConfig {
    return { ...this.config };
  }

  /**
   * Update performance config
   */
  public updateConfig(config: Partial<PerformanceConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

// Singleton instance
export const performanceMonitor = new PerformanceMonitor();