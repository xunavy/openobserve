// Copyright 2023 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

/**
 * Incremental Aggregation Service for log query results
 * Handles incremental aggregation of log data from multiple pages
 */

// Aggregation result interface
export interface AggregationResult {
  // Log level statistics
  logLevelStats: {
    [level: string]: {
      count: number;
      percentage: number;
    };
  };
  // Service name time distribution
  serviceTimeDistribution: {
    [serviceName: string]: {
      [timeBucket: number]: number;
    };
  };
  // Trace ID relationships
  traceRelationships: {
    [traceId: string]: {
      serviceNames: Set<string>;
      logCount: number;
      // Parent trace ID (if any)
      parentTraceId?: string;
      // Child trace IDs
      childTraceIds: Set<string>;
    };
  };
  // Total logs processed
  totalLogs: number;
  // Last updated timestamp
  lastUpdated: number;
}

// Time bucket configuration
const TIME_BUCKET_INTERVAL = 5 * 60 * 1000; // 5 minutes in milliseconds

/**
 * Calculate time bucket for a given timestamp
 * @param timestamp Timestamp in milliseconds
 * @returns Time bucket in milliseconds (rounded to TIME_BUCKET_INTERVAL)
 */
const calculateTimeBucket = (timestamp: number): number => {
  return Math.floor(timestamp / TIME_BUCKET_INTERVAL) * TIME_BUCKET_INTERVAL;
};

/**
 * Update log level statistics incrementally
 * @param currentStats Current log level statistics
 * @param logLevel Log level from the log entry
 * @returns Updated log level statistics
 */
const updateLogLevelStats = (
  currentStats: AggregationResult['logLevelStats'],
  logLevel: string
): AggregationResult['logLevelStats'] => {
  const updatedStats = { ...currentStats };
  
  if (!updatedStats[logLevel]) {
    updatedStats[logLevel] = { count: 0, percentage: 0 };
  }
  
  updatedStats[logLevel].count += 1;
  
  return updatedStats;
};

/**
 * Update service time distribution incrementally
 * @param currentDistribution Current service time distribution
 * @param serviceName Service name from the log entry
 * @param timestamp Timestamp from the log entry
 * @returns Updated service time distribution
 */
const updateServiceTimeDistribution = (
  currentDistribution: AggregationResult['serviceTimeDistribution'],
  serviceName: string,
  timestamp: number
): AggregationResult['serviceTimeDistribution'] => {
  const updatedDistribution = { ...currentDistribution };
  const timeBucket = calculateTimeBucket(timestamp);
  
  if (!updatedDistribution[serviceName]) {
    updatedDistribution[serviceName] = {};
  }
  
  if (!updatedDistribution[serviceName][timeBucket]) {
    updatedDistribution[serviceName][timeBucket] = 0;
  }
  
  updatedDistribution[serviceName][timeBucket] += 1;
  
  return updatedDistribution;
};

/**
 * Update trace relationships incrementally
 * @param currentRelationships Current trace relationships
 * @param traceId Trace ID from the log entry
 * @param serviceName Service name from the log entry
 * @param parentTraceId Parent trace ID (if any)
 * @returns Updated trace relationships
 */
const updateTraceRelationships = (
  currentRelationships: AggregationResult['traceRelationships'],
  traceId: string,
  serviceName: string,
  parentTraceId?: string
): AggregationResult['traceRelationships'] => {
  const updatedRelationships = { ...currentRelationships };
  
  // Create trace entry if it doesn't exist
  if (!updatedRelationships[traceId]) {
    updatedRelationships[traceId] = {
      serviceNames: new Set(),
      logCount: 0,
      childTraceIds: new Set()
    };
  }
  
  // Update trace information
  updatedRelationships[traceId].serviceNames.add(serviceName);
  updatedRelationships[traceId].logCount += 1;
  
  // Handle parent trace relationship
  if (parentTraceId && parentTraceId !== traceId) {
    // Create parent trace entry if it doesn't exist
    if (!updatedRelationships[parentTraceId]) {
      updatedRelationships[parentTraceId] = {
        serviceNames: new Set(),
        logCount: 0,
        childTraceIds: new Set()
      };
    }
    
    // Add child trace ID to parent
    updatedRelationships[parentTraceId].childTraceIds.add(traceId);
    
    // Set parent trace ID for child
    updatedRelationships[traceId].parentTraceId = parentTraceId;
  }
  
  return updatedRelationships;
};

/**
 * Calculate percentages for log level statistics
 * @param logLevelStats Log level statistics with counts
 * @param totalLogs Total number of logs processed
 * @returns Log level statistics with percentages
 */
const calculateLogLevelPercentages = (
  logLevelStats: AggregationResult['logLevelStats'],
  totalLogs: number
): AggregationResult['logLevelStats'] => {
  const updatedStats = { ...logLevelStats };
  
  for (const level in updatedStats) {
    updatedStats[level].percentage = totalLogs > 0 
      ? Math.round((updatedStats[level].count / totalLogs) * 100) 
      : 0;
  }
  
  return updatedStats;
};

/**
 * Initialize a new aggregation result
 * @returns Empty aggregation result
 */
export const initializeAggregation = (): AggregationResult => {
  return {
    logLevelStats: {},
    serviceTimeDistribution: {},
    traceRelationships: {},
    totalLogs: 0,
    lastUpdated: Date.now()
  };
};

/**
 * Aggregate a single log entry
 * @param currentResult Current aggregation result
 * @param logEntry Log entry to aggregate
 * @returns Updated aggregation result
 */
export const aggregateLogEntry = (
  currentResult: AggregationResult,
  logEntry: any
): AggregationResult => {
  // Extract required fields from log entry
  const logLevel = logEntry.level || logEntry.log_level || 'unknown';
  const serviceName = logEntry.service_name || logEntry.service || 'unknown';
  const timestamp = logEntry._timestamp || logEntry.timestamp || Date.now();
  const traceId = logEntry.trace_id || logEntry.traceId || '';
  const parentTraceId = logEntry.parent_trace_id || logEntry.parentTraceId || '';
  
  // Update log level stats
  const updatedLogLevelStats = updateLogLevelStats(currentResult.logLevelStats, logLevel);
  
  // Update service time distribution
  const updatedServiceTimeDistribution = updateServiceTimeDistribution(
    currentResult.serviceTimeDistribution,
    serviceName,
    timestamp
  );
  
  // Update trace relationships (only if traceId is present)
  let updatedTraceRelationships = currentResult.traceRelationships;
  if (traceId) {
    updatedTraceRelationships = updateTraceRelationships(
      currentResult.traceRelationships,
      traceId,
      serviceName,
      parentTraceId
    );
  }
  
  // Calculate total logs
  const totalLogs = currentResult.totalLogs + 1;
  
  // Calculate log level percentages
  const finalLogLevelStats = calculateLogLevelPercentages(updatedLogLevelStats, totalLogs);
  
  return {
    logLevelStats: finalLogLevelStats,
    serviceTimeDistribution: updatedServiceTimeDistribution,
    traceRelationships: updatedTraceRelationships,
    totalLogs,
    lastUpdated: Date.now()
  };
};

/**
 * Aggregate multiple log entries
 * @param currentResult Current aggregation result
 * @param logEntries Array of log entries to aggregate
 * @returns Updated aggregation result
 */
export const aggregateLogEntries = (
  currentResult: AggregationResult,
  logEntries: any[]
): AggregationResult => {
  let updatedResult = { ...currentResult };
  
  for (const logEntry of logEntries) {
    updatedResult = aggregateLogEntry(updatedResult, logEntry);
  }
  
  return updatedResult;
};

/**
 * Aggregate a page of log results
 * @param currentResult Current aggregation result
 * @param pageResult Page result from search API
 * @returns Updated aggregation result
 */
export const aggregatePageResult = (
  currentResult: AggregationResult,
  pageResult: any
): AggregationResult => {
  if (!pageResult?.hits || !Array.isArray(pageResult.hits)) {
    return currentResult;
  }
  
  return aggregateLogEntries(currentResult, pageResult.hits);
};

/**
 * Clear aggregation result
 * @returns Empty aggregation result
 */
export const clearAggregation = (): AggregationResult => {
  return initializeAggregation();
};

/**
 * Serialize aggregation result for storage
 * @param result Aggregation result to serialize
 * @returns Serialized aggregation result
 */
export const serializeAggregationResult = (result: AggregationResult): string => {
  // Convert Sets to arrays for serialization
  const serialized = JSON.stringify(result, (key, value) => {
    if (value instanceof Set) {
      return Array.from(value);
    }
    return value;
  });
  
  return serialized;
};

/**
 * Deserialize aggregation result from storage
 * @param serialized Serialized aggregation result
 * @returns Aggregation result
 */
export const deserializeAggregationResult = (serialized: string): AggregationResult => {
  // Convert arrays back to Sets during deserialization
  const deserialized = JSON.parse(serialized, (key, value) => {
    if (Array.isArray(value) && (key === 'serviceNames' || key === 'childTraceIds')) {
      return new Set(value);
    }
    return value;
  });
  
  return deserialized;
};

/**
 * Update time bucket interval
 * @param interval Interval in milliseconds
 */
export const updateTimeBucketInterval = (interval: number): void => {
  TIME_BUCKET_INTERVAL = interval;
};

/**
 * Get current time bucket interval
 * @returns Time bucket interval in milliseconds
 */
export const getTimeBucketInterval = (): number => {
  return TIME_BUCKET_INTERVAL;
};