<!-- Copyright 2023 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
 the Free Software Foundation, either version 3 of the License, or
 (at your option) any later version.

This program is distributed in the hope that it will be useful,
 but WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
 along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
  <div class="log-aggregation-dashboard">
    <!-- Log Level Distribution Pie Chart -->
    <div class="dashboard-section">
      <h3 class="section-title">Log Level Distribution</h3>
      <div class="pie-chart-container">
        <canvas ref="logLevelPieChart"></canvas>
      </div>
    </div>

    <!-- Service Time Density Heatmap -->
    <div class="dashboard-section">
      <h3 class="section-title">Service Time Density</h3>
      <div class="heatmap-container">
        <div class="heatmap-scroll-wrapper">
          <canvas ref="serviceTimeHeatmap"></canvas>
        </div>
      </div>
    </div>

    <!-- Trace Relationship Tree -->
    <div class="dashboard-section">
      <h3 class="section-title">Trace Relationships</h3>
      <div class="trace-tree-container">
        <div ref="traceTree"></div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed } from 'vue';
import { AggregationResult, initializeAggregation } from '@/services/incrementalAggregation';
import Chart from 'chart.js/auto';

// Props
const props = defineProps<{
  aggregationResult: AggregationResult;
  darkMode: boolean;
}>();

// Refs
const logLevelPieChart = ref<HTMLCanvasElement | null>(null);
const serviceTimeHeatmap = ref<HTMLCanvasElement | null>(null);
const traceTree = ref<HTMLDivElement | null>(null);

// Chart instances
let pieChartInstance: Chart | null = null;
let heatmapChartInstance: Chart | null = null;

// Initialize aggregation result if not provided
const currentAggregation = computed(() => props.aggregationResult || initializeAggregation());

// Watch for changes in aggregation result
watch(
  () => props.aggregationResult,
  (newResult) => {
    updateLogLevelPieChart(newResult);
    updateServiceTimeHeatmap(newResult);
    updateTraceTree(newResult);
  },
  { deep: true }
);

// Update log level pie chart
const updateLogLevelPieChart = (result: AggregationResult) => {
  if (!logLevelPieChart.value) return;

  const logLevelStats = result.logLevelStats;
  const labels = Object.keys(logLevelStats);
  const data = Object.values(logLevelStats).map(stat => stat.count);

  // Destroy existing chart if it exists
  if (pieChartInstance) {
    pieChartInstance.destroy();
  }

  // Create new chart
  pieChartInstance = new Chart(logLevelPieChart.value, {
    type: 'pie',
    data: {
      labels,
      datasets: [
        {
          data,
          backgroundColor: [
            '#dc2626', // error - red
            '#f59e0b', // warn - orange
            '#10b981', // info - green
            '#3b82f6', // debug - blue
            '#6b7280'  // unknown - gray
          ],
          borderWidth: 1
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        duration: 500, // Smooth transition animation
        easing: 'easeInOutQuart'
      },
      plugins: {
        legend: {
          position: 'bottom'
        },
        tooltip: {
          callbacks: {
            label: function(context: any) {
              const label = context.label || '';
              const value = context.parsed || 0;
              const total = result.totalLogs;
              const percentage = total > 0 ? Math.round((value / total) * 100) : 0;
              return `${label}: ${value} (${percentage}%)`;
            }
          }
        }
      }
    }
  });
};

// Update service time heatmap
const updateServiceTimeHeatmap = (result: AggregationResult) => {
  if (!serviceTimeHeatmap.value) return;

  const serviceTimeDistribution = result.serviceTimeDistribution;
  const serviceNames = Object.keys(serviceTimeDistribution);
  const timeBuckets = new Set<number>();

  // Collect all time buckets
  for (const serviceName in serviceTimeDistribution) {
    const buckets = Object.keys(serviceTimeDistribution[serviceName]).map(Number);
    buckets.forEach(bucket => timeBuckets.add(bucket));
  }

  // Sort service names and time buckets
  const sortedServiceNames = serviceNames.sort();
  const sortedTimeBuckets = Array.from(timeBuckets).sort((a, b) => a - b);

  // Prepare heatmap data
  const heatmapData = sortedServiceNames.map(serviceName => {
    const serviceData = serviceTimeDistribution[serviceName] || {};
    return sortedTimeBuckets.map(bucket => serviceData[bucket] || 0);
  });

  // Destroy existing chart if it exists
  if (heatmapChartInstance) {
    heatmapChartInstance.destroy();
  }

  // Create new heatmap chart
  heatmapChartInstance = new Chart(serviceTimeHeatmap.value, {
    type: 'heatmap',
    data: {
      labels: sortedServiceNames,
      datasets: [
        {
          label: 'Log Density',
          data: heatmapData.flat(),
          backgroundColor: (context: any) => {
            const value = context.parsed;
            // Create color gradient based on value
            const alpha = value > 0 ? Math.min(0.8, value / 100) : 0;
            return `rgba(59, 130, 246, ${alpha})`; // Blue color with alpha based on density
          },
          borderWidth: 1
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          type: 'category',
          labels: sortedTimeBuckets.map(bucket => new Date(bucket).toLocaleTimeString()),
          title: {
            display: true,
            text: 'Time'
          },
          ticks: {
            autoSkip: true,
            maxRotation: 90,
            minRotation: 90
          }
        },
        y: {
          type: 'category',
          labels: sortedServiceNames,
          title: {
            display: true,
            text: 'Service Name'
          }
        }
      },
      plugins: {
        tooltip: {
          callbacks: {
            label: function(context: any) {
              const serviceIndex = Math.floor(context.dataIndex / sortedTimeBuckets.length);
              const bucketIndex = context.dataIndex % sortedTimeBuckets.length;
              const serviceName = sortedServiceNames[serviceIndex];
              const timeBucket = sortedTimeBuckets[bucketIndex];
              const count = context.parsed;
              return `${serviceName} - ${new Date(timeBucket).toLocaleString()}: ${count} logs`;
            }
          }
        }
      }
    }
  });
};

// Update trace tree
const updateTraceTree = (result: AggregationResult) => {
  if (!traceTree.value) return;

  const traceRelationships = result.traceRelationships;
  const traceIds = Object.keys(traceRelationships);

  // Clear existing trace tree
  traceTree.value.innerHTML = '';

  // Create root traces (traces without parent)
  const rootTraces = traceIds.filter(traceId => !traceRelationships[traceId].parentTraceId);

  // Render each root trace
  rootTraces.forEach(traceId => {
    const traceNode = createTraceNode(traceId, traceRelationships, 0);
    traceTree.value?.appendChild(traceNode);
  });
};

// Create trace node element
const createTraceNode = (traceId: string, traceRelationships: AggregationResult['traceRelationships'], depth: number): HTMLElement => {
  const trace = traceRelationships[traceId];
  const node = document.createElement('div');
  node.className = 'trace-node';
  node.style.marginLeft = `${depth * 20}px`;

  // Create node content
  const nodeContent = document.createElement('div');
  nodeContent.className = 'trace-node-content';
  nodeContent.innerHTML = `
    <div class="trace-id">${traceId.substring(0, 8)}...</div>
    <div class="trace-info">
      <span class="service-names">${Array.from(trace.serviceNames).join(', ')}</span>
      <span class="log-count">${trace.logCount} logs</span>
    </div>
  `;

  // Add click event to toggle children
  nodeContent.addEventListener('click', () => {
    const childrenContainer = node.querySelector('.trace-children');
    if (childrenContainer) {
      childrenContainer.classList.toggle('hidden');
    }
  });

  node.appendChild(nodeContent);

  // Create children container
  const childrenContainer = document.createElement('div');
  childrenContainer.className = 'trace-children';

  // Render child traces
  const childTraceIds = Array.from(trace.childTraceIds);
  childTraceIds.forEach(childTraceId => {
    const childNode = createTraceNode(childTraceId, traceRelationships, depth + 1);
    childrenContainer.appendChild(childNode);
  });

  node.appendChild(childrenContainer);

  return node;
};

// Initialize charts on mount
onMounted(() => {
  updateLogLevelPieChart(currentAggregation.value);
  updateServiceTimeHeatmap(currentAggregation.value);
  updateTraceTree(currentAggregation.value);
});

// Cleanup charts on unmount
onUnmounted(() => {
  if (pieChartInstance) {
    pieChartInstance.destroy();
  }
  if (heatmapChartInstance) {
    heatmapChartInstance.destroy();
  }
});
</script>

<style scoped>
.log-aggregation-dashboard {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 20px;
}

.dashboard-section {
  background-color: var(--q-color-surface);
  border-radius: 8px;
  padding: 20px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.section-title {
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 15px;
  color: var(--q-color-text-primary);
}

.pie-chart-container {
  height: 300px;
}

.heatmap-container {
  height: 400px;
  overflow: hidden;
}

.heatmap-scroll-wrapper {
  overflow-x: auto;
  overflow-y: hidden;
  height: 100%;
}

.trace-tree-container {
  height: 400px;
  overflow-y: auto;
  border: 1px solid var(--q-color-border);
  border-radius: 4px;
  padding: 10px;
}

.trace-node {
  margin-bottom: 10px;
}

.trace-node-content {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background-color: var(--q-color-secondary);
  border-radius: 4px;
  cursor: pointer;
  transition: background-color 0.2s ease;
}

.trace-node-content:hover {
  background-color: var(--q-color-secondary-hover);
}

.trace-id {
  font-family: monospace;
  font-weight: 600;
  color: var(--q-color-primary);
}

.trace-info {
  display: flex;
  flex-direction: column;
  font-size: 12px;
  color: var(--q-color-text-secondary);
}

.service-names {
  font-weight: 500;
}

.log-count {
  font-size: 11px;
  opacity: 0.8;
}

.trace-children {
  margin-top: 8px;
}

.hidden {
  display: none;
}

/* Dark mode specific styles */
:deep(.dark) {
  --q-color-surface: #1e1e1e;
  --q-color-border: #3a3a3a;
  --q-color-text-primary: #ffffff;
  --q-color-text-secondary: #a0a0a0;
  --q-color-secondary: #2d2d2d;
  --q-color-secondary-hover: #3a3a3a;
}
</style>