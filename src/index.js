/**
* @fileoverview Autonomous message buffer system with intelligent batching and self-monitoring capabilities
* @version 1.0.0
*/

/**
* @typedef {Object} BufferConfig Configuration object for MessageBuffer
* @property {number} [maxSize=1000] Maximum size of the buffer
* @property {number} [targetBatchSize=50] Target number of messages per batch
* @property {number} [minBatchSize=10] Minimum batch size to trigger processing
* @property {number} [maxBatchDelay=1000] Maximum delay before processing an incomplete batch (ms)
* @property {boolean} [preserveOrder=true] Whether to preserve message order
* @property {number} [maxRetries=3] Maximum number of retries for failed batches
* @property {number} [baseRetryDelay=1000] Base delay for exponential backoff (ms)
* @property {number} [maxConcurrentFlush=1] Maximum number of concurrent flush operations
*/

/**
* @typedef {Object} BufferEntry
* @property {string} id Unique identifier
* @property {*} content Message content
* @property {number} timestamp Creation timestamp
* @property {number} priority Message priority (higher = more priority)
* @property {Object} [metadata] Additional metadata
* @property {number} attempts Number of processing attempts
*/

/**
* @typedef {Object} BufferStats
* @property {number} size Current buffer size
* @property {number} totalProcessed Total processed messages
* @property {number} totalDropped Total dropped messages
* @property {number} totalErrors Total errors encountered
* @property {number} avgProcessingTime Average processing time
* @property {number} avgBatchSize Average batch size
* @property {number} avgWaitTime Average message wait time
*/

/**
* @typedef {Object} BufferMetrics
* @property {number} incomingRate Messages per second incoming rate
* @property {number} processingRate Messages per second processing rate
* @property {number} errorRate Errors per second
* @property {number} currentLoad Current load percentage
*/

class MessageBuffer {
    /**
    * Creates a new MessageBuffer instance
    * @param {function(Array<*>): Promise<void>} executor Batch execution function
    * @param {BufferConfig} [config={}] Buffer configuration
    */
    constructor(executor, config = {}) {
        // Core configuration
        this.config = {
            maxSize: config.maxSize ?? 1000,
            targetBatchSize: config.targetBatchSize ?? 50,
            minBatchSize: config.minBatchSize ?? 10,
            maxBatchDelay: config.maxBatchDelay ?? 1000,
            preserveOrder: config.preserveOrder ?? true,
            maxRetries: config.maxRetries ?? 3,
            baseRetryDelay: config.baseRetryDelay ?? 1000,
            maxConcurrentFlush: config.maxConcurrentFlush ?? 1
        };
        
        // Add residual handling state
        this._residualState = {
            lastBatchTime: 0,
            lastBatchSize: 0,
            wasHighTraffic: false
        };
        
        // Refined traffic pattern detection
        this._trafficPattern = {
            lastProcessingTimes: [],
            averageMessageGap: 0,
            lastMessageTime: Date.now(),
            messageCountLastMinute: 0,
            isLowTraffic: false,
            trafficTrend: 'stable' // 'increasing', 'decreasing', 'stable'
        };
        
        // Validate executor
        if (typeof executor !== 'function') {
            throw new Error('Executor must be a function');
        }
        this.executor = executor;
        
        // Internal state
        this._queue = new Map();  // id -> BufferEntry
        this._activeFlushes = new Set();
        this._isProcessing = false;
        this._lastFlushTime = 0;
        
        // Statistics and metrics
        this._stats = {
            size: 0,
            totalProcessed: 0,
            totalDropped: 0,
            totalErrors: 0,
            avgProcessingTime: 0,
            avgBatchSize: 0,
            avgWaitTime: 0
        };
        
        this._metrics = {
            incomingRate: 0,
            processingRate: 0,
            errorRate: 0,
            currentLoad: 0
        };
        
        // Event handlers
        this._eventHandlers = new Map();
        
        // Initialize the buffer's self-monitoring system
        this._initializeMonitoring();

        // Start residual checker
        this._initializeResidualChecker();
    }
    
    
    
    
    /**
    * Initializes the residual message checker
    * @private
    */
    _initializeResidualChecker() {
        const checkResidual = async () => {
            try {
                if (this._queue.size > 0) {
                    const now = Date.now();
                    const timeSinceLastBatch = now - this._residualState.lastBatchTime;
                    const wasHighTraffic = this._residualState.wasHighTraffic;
                    const currentlyLowTraffic = this._trafficPattern.isLowTraffic;
                    
                    // Handle residual messages in these cases:
                    // 1. We were in high traffic and now we're not
                    // 2. We haven't processed anything in a while and have messages
                    if ((wasHighTraffic && currentlyLowTraffic) || 
                    (timeSinceLastBatch > this.config.maxBatchDelay && this._queue.size > 0)) {
                        await this._processResidualMessages();
                    }
                }
            } catch (error) {
                this._emit('error', { error, context: 'residual-check' });
            } finally {
                // Adaptive checking interval based on traffic pattern
                const nextCheck = this._calculateResidualCheckInterval();
                setTimeout(checkResidual, nextCheck);
            }
        };
        
        // Start the checker
        checkResidual();
    }
    
    /**
    * Calculates the interval for residual checks based on current conditions
    * @private
    * @returns {number} Check interval in ms
    */
    _calculateResidualCheckInterval() {
        const baseInterval = this.config.maxBatchDelay / 2;
        
        if (this._trafficPattern.trafficTrend === 'decreasing') {
            return baseInterval / 2; // Check more frequently when traffic is decreasing
        }
        
        return baseInterval;
    }
    
    /**
    * Processes residual messages with special handling
    * @private
    */
    async _processResidualMessages() {
        if (this._isProcessing) return;
        
        const queueSnapshot = Array.from(this._queue.values());
        if (queueSnapshot.length === 0) return;
        
        this._isProcessing = true;
        
        try {
            // Process all remaining messages in the current queue
            await this._processQueue(true); // true indicates residual processing
        } finally {
            this._isProcessing = false;
        }
    }
    
    /**
    * Analyzes traffic pattern with improved trend detection
    * @private
    */
    _analyzeTrafficPattern() {
        const now = Date.now();
        const messageGap = now - this._trafficPattern.lastMessageTime;
        this._trafficPattern.lastMessageTime = now;
        
        // Update average message gap with exponential moving average
        const alpha = 0.2;
        this._trafficPattern.averageMessageGap = 
        (1 - alpha) * this._trafficPattern.averageMessageGap + 
        alpha * messageGap;
        
        // Update message count for the last minute
        this._trafficPattern.messageCountLastMinute++;
        setTimeout(() => {
            this._trafficPattern.messageCountLastMinute--;
        }, 60000);
        
        // Determine traffic trend
        const prevCount = this._trafficPattern.messageCountLastMinute;
        if (prevCount < 10) {
            this._trafficPattern.trafficTrend = 'low';
        } else if (this._trafficPattern.messageCountLastMinute > prevCount * 1.5) {
            this._trafficPattern.trafficTrend = 'increasing';
        } else if (this._trafficPattern.messageCountLastMinute < prevCount * 0.5) {
            this._trafficPattern.trafficTrend = 'decreasing';
        } else {
            this._trafficPattern.trafficTrend = 'stable';
        }
        
        // Update traffic pattern state
        this._trafficPattern.isLowTraffic = 
        this._trafficPattern.averageMessageGap > (this.config.maxBatchDelay * 2);
        
        // Save state for residual handling
        if (!this._trafficPattern.isLowTraffic) {
            this._residualState.wasHighTraffic = true;
        }
        
        this._emit('trafficPattern', {
            isLowTraffic: this._trafficPattern.isLowTraffic,
            averageGap: this._trafficPattern.averageMessageGap,
            trend: this._trafficPattern.trafficTrend,
            messageCount: this._trafficPattern.messageCountLastMinute
        });
    }
    
    /**
    * Initializes the buffer's self-monitoring system
    * @private
    */
    _initializeMonitoring() {
        // Setup monitoring loop
        const monitoringLoop = async () => {
            try {
                await this._checkState();
            } catch (error) {
                this._emit('error', { error, context: 'monitoring' });
            } finally {
                // Schedule next check using dynamic interval based on load
                const nextInterval = this._calculateNextMonitoringInterval();
                setTimeout(monitoringLoop, nextInterval);
            }
        };
        
        // Start monitoring loop
        monitoringLoop();
        
        // Setup metrics calculation
        setInterval(() => this._updateMetrics(), 1000);
    }
    
    /**
    * Calculates the next monitoring interval based on current load
    * @private
    * @returns {number} Next monitoring interval in ms
    */
    _calculateNextMonitoringInterval() {
        const baseInterval = 100; // Base interval 100ms
        const load = this._metrics.currentLoad;
        
        if (load > 0.8) return baseInterval / 2;  // High load: check more frequently
        if (load < 0.2) return baseInterval * 2;  // Low load: check less frequently
        return baseInterval;
    }
    
    /**
    * Updates buffer metrics
    * @private
    */
    _updateMetrics() {
        const now = Date.now();
        const queueValues = Array.from(this._queue.values());
        
        // Calculate rates
        this._metrics.incomingRate = queueValues.filter(entry => 
            entry.timestamp > now - 1000
        ).length;
        
        this._metrics.currentLoad = this._queue.size / this.config.maxSize;
        
        // Emit metrics update event
        this._emit('metrics', { ...this._metrics });
    }
    
    /**
    * Checks buffer state and triggers processing if needed
    * @private
    * @returns {Promise<void>}
    */
    async _checkState() {
        if (this._queue.size === 0 || this._isProcessing) return;
        
        const now = Date.now();
        const oldestEntry = Math.min(...Array.from(this._queue.values()).map(e => e.timestamp));
        const timeWaiting = now - oldestEntry;
        
        // Smart processing decision based on traffic pattern
        const shouldProcess = 
        // Normal traffic conditions
        (this._queue.size >= this.config.targetBatchSize) ||
        // Low traffic conditions: process even single messages after delay
        (this._trafficPattern.isLowTraffic && timeWaiting >= this.config.maxBatchDelay) ||
        // Mixed conditions: smaller batches but still some batching
        (!this._trafficPattern.isLowTraffic && this._queue.size >= this.config.minBatchSize &&   timeWaiting >= this.config.maxBatchDelay);
        
        if (shouldProcess) {
            await this._processQueue();
        }
    }
    
    
    /**
    * Processes the queue with enhanced handling for residual messages
    * @private
    * @param {boolean} [isResidual=false] Whether this is residual processing
    */
    async _processQueue(isResidual = false) {
        if (this._isProcessing && !isResidual) return;
        this._isProcessing = true;
        
        try {
            let batch = this._prepareBatch(isResidual);
            if (batch.length === 0) {
                this._isProcessing = false;
                return;
            }
            
            const startTime = Date.now();
            await this.executor(batch.map(entry => entry.content));
            const processingTime = Date.now() - startTime;
            
            // Update statistics and state
            this._updateStats(batch.length, processingTime);
            batch.forEach(entry => this._queue.delete(entry.id));
            
            this._residualState.lastBatchTime = Date.now();
            this._residualState.lastBatchSize = batch.length;
            
            // Reset high traffic flag if queue is empty
            if (this._queue.size === 0) {
                this._residualState.wasHighTraffic = false;
            }
            
            this._emit('flush', { 
                batchSize: batch.length, 
                processingTime,
                isResidual
            });
            
        } catch (error) {
            this._handleProcessingError(error);
        } finally {
            this._isProcessing = false;
            
            // Check for more work
            if (this._queue.size > 0) {
                this._checkState();
            }
        }
    }
    
    /**
    * Prepares the next batch with consideration for residual messages
    * @private
    * @param {boolean} [isResidual=false] Whether this is residual processing
    * @returns {Array<BufferEntry>}
    */
    _prepareBatch(isResidual = false) {
        const entries = Array.from(this._queue.values());
        
        if (this.config.preserveOrder) {
            entries.sort((a, b) => {
                if (a.priority !== b.priority) return b.priority - a.priority;
                return a.timestamp - b.timestamp;
            });
        }
        
        // For residual processing, we're more aggressive about batch size
        const batchSize = isResidual 
        ? Math.max(1, Math.min(entries.length, this.config.targetBatchSize))
        : Math.min(entries.length, this.config.targetBatchSize);
        
        return entries.slice(0, batchSize);
    }
    
    /**
    * Updates buffer statistics
    * @private
    * @param {number} batchSize Size of processed batch
    * @param {number} processingTime Time taken to process batch
    */
    _updateStats(batchSize, processingTime) {
        this._stats.totalProcessed += batchSize;
        this._stats.avgProcessingTime = (
            this._stats.avgProcessingTime * (this._stats.totalProcessed - batchSize) +
            processingTime * batchSize
        ) / this._stats.totalProcessed;
        
        this._stats.avgBatchSize = (
            this._stats.avgBatchSize * (this._stats.totalProcessed - batchSize) +
            batchSize * batchSize
        ) / this._stats.totalProcessed;
    }
    
    /**
    * Handles processing errors
    * @private
    * @param {Error} error The error that occurred
    */
    _handleProcessingError(error) {
        this._stats.totalErrors++;
        this._emit('error', { error, context: 'processing' });
        
        // Implement circuit breaker logic here if needed
        if (this._stats.totalErrors > this.config.maxRetries) {
            this._emit('circuit-break', {
                totalErrors: this._stats.totalErrors,
                lastError: error
            });
        }
    }
    
    /**
    * Adds a new message to the buffer
    * @param {*} content Message content
    * @param {Object} [options={}] Message options
    * @param {number} [options.priority=0] Message priority
    * @param {Object} [options.metadata={}] Additional metadata
    * @returns {boolean} Whether the message was successfully added
    * @throws {Error} If the buffer is full and the message cannot be added
    */
    add(content, options = {}) {
        if (this._queue.size >= this.config.maxSize) {
            this._stats.totalDropped++;
            this._emit('drop', { reason: 'buffer-full', content });
            return false;
        }
        
        this._analyzeTrafficPattern();
        
        const entry = {
            id: crypto.randomUUID(),
            content,
            timestamp: Date.now(),
            priority: options.priority ?? 0,
            metadata: options.metadata ?? {},
            attempts: 0
        };
        
        this._queue.set(entry.id, entry);
        
        // If we're in low traffic mode and this is the only message,
        // schedule an immediate check
        if (this._trafficPattern.isLowTraffic && this._queue.size === 1) {
            setTimeout(() => this._checkState(), this.config.maxBatchDelay);
        } else {
            this._checkState();
        }
        
        return true;
    }
    
    /**
    * Returns current buffer statistics
    * @returns {BufferStats}
    */
    getStats() {
        return { ...this._stats };
    }
    
    /**
    * Returns current buffer metrics
    * @returns {BufferMetrics}
    */
    getMetrics() {
        return { ...this._metrics };
    }
    
    /**
    * Subscribes to buffer events
    * @param {'flush'|'drop'|'error'|'circuit-break'|'metrics'} event Event type
    * @param {function(Object): void} handler Event handler
    * @returns {function(): void} Unsubscribe function
    */
    on(event, handler) {
        if (!this._eventHandlers.has(event)) {
            this._eventHandlers.set(event, new Set());
        }
        
        this._eventHandlers.get(event).add(handler);
        
        return () => {
            const handlers = this._eventHandlers.get(event);
            if (handlers) {
                handlers.delete(handler);
            }
        };
    }
    
    /**
    * Emits an event to all registered handlers
    * @private
    * @param {string} event Event type
    * @param {Object} data Event data
    */
    _emit = (event, data) => {
        
        
        const handlers = this._eventHandlers.has(event) && this._eventHandlers.get(event);

        if (handlers) {
            handlers.forEach(handler => {
                try {
                    handler(data);
                } catch (error) {
                    console.error(`Error in ${event} handler:`, error);
                }
            });
        }
    }
}

// Export the MessageBuffer class
export default MessageBuffer;