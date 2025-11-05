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
 * Web Worker for incremental aggregation
 * Handles aggregation tasks off the main thread to improve performance
 */

// Import aggregation functions
importScripts('./incrementalAggregation.ts');

// Listen for messages from main thread
self.addEventListener('message', (event) => {
  const { id, function: fnStr, args } = event.data;

  try {
    // Create a function from the string
    const aggregationFn = new Function(`return ${fnStr}`)();

    // Execute the aggregation function
    const result = aggregationFn(...args);

    // Send the result back to main thread
    self.postMessage({
      id,
      result
    });
  } catch (error) {
    // Send error back to main thread
    self.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error)
    });
  }
});