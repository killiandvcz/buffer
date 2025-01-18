/**
 * @fileoverview Enhanced message buffer system using train station metaphor
 * @version 1.1.0
 */

import { Entry } from "./entry";

/**
 * @typedef {Object} BufferConfig
 * @property {number} [maxSize=1000] Maximum size of the buffer
 * @property {number} [targetBatchSize=50] Target number of messages per batch
 * @property {number} [minBatchSize=10] Minimum batch size to trigger processing
 * @property {number} [maxBatchDelay=1000] Maximum delay before processing an incomplete batch (ms)
 * @property {boolean} [preserveOrder=true] Whether to preserve message order
 * @property {number} [maxRetries=3] Maximum number of retries for failed batches
 * @property {number} [baseRetryDelay=1000] Base delay for exponential backoff (ms)
 * @property {number} [processingCheckInterval=1000] Interval to check if processing is possible when blocked (ms)
 * @property {function} [canProcess] Custom function to check if processing is possible
 */
export class MegaBuffer {
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
            processingCheckInterval: config.processingCheckInterval ?? 1000,
            canProcess: config.canProcess ?? (async () => true)
        };

        // Validate executor
        if (typeof executor !== 'function') {
            throw new Error('Executor must be a function');
        }
        this.executor = executor;

        // Internal state
        this._queue = new Map();
        this._flushTimeout = null;
        this._canProcessInterval = null;
        this._isProcessing = false;  // Flag to prevent concurrent processing
        this._retryMap = new Map(); // Track retry attempts per message
        
        // Statistics
        this._stats = {
            processed: 0,
            dropped: 0,
            errors: 0,
            lastProcessingTime: 0
        };
    }

    /**
     * Checks if processing is currently possible
     * @private
     * @returns {Promise<boolean>}
     */
    async _canProcess() {
        try {
            const canProcess = !!(await this.config.canProcess());
            
            // Clear or set up monitoring interval based on processing status
            if (canProcess) {
                this._clearProcessingCheck();
            } else {
                this._setupProcessingCheck();
            }
            
            return canProcess;
        } catch (error) {
            console.error('Error in canProcess function:', error);
            return false;
        }
    }

    /**
     * Sets up the processing check interval
     * @private
     */
    _setupProcessingCheck() {
        if (!this._canProcessInterval) {
            this._canProcessInterval = setInterval(() => {
                if (this._queue.size === 0 || this._canProcess()) {
                    this._clearProcessingCheck();
                    this._startFlushing();
                }
            }, this.config.processingCheckInterval);
        }
    }

    /**
     * Clears the processing check interval
     * @private
     */
    _clearProcessingCheck() {
        if (this._canProcessInterval) {
            clearInterval(this._canProcessInterval);
            this._canProcessInterval = null;
        }
    }

    /**
     * Adds a new message to the buffer
     * @param {*} content Message content
     * @param {Object} [options={}] Message options
     * @param {number} [options.priority=0] Message priority
     * @param {Object} [options.metadata={}] Additional metadata
     * @returns {Promise<boolean>} Whether the message was successfully added
     */
    async add(content, options = {}) {
        // Check buffer capacity
        if (this._queue.size >= this.config.maxSize) {
            this._stats.dropped++;
            return false;
        }

        const entry = new Entry(content, options);

        this._queue.set(entry.id, entry);

        // Start the departure countdown if we have messages
        if (this._queue.size > 0) {
            this._startFlushing();
        }

        // Immediate departure if train is full
        if (this._queue.size >= this.config.targetBatchSize) {
            await this._flush();
        }

        return true;
    }

    /**
     * Starts the flush countdown timer
     * @private
     */
    _startFlushing() {
        // Don't set a new timeout if one already exists
        if (this._flushTimeout) {
            return;
        }

        this._flushTimeout = setTimeout(async () => {
            this._flushTimeout = null;
            await this._flush();
        }, this.config.maxBatchDelay);
    }

    /**
     * Processes the current batch of messages
     * @private
     * @returns {Promise<void>}
     */
    async _flush() {
        // Guard conditions
        if (this._queue.size === 0 || this._isProcessing || !(await this._canProcess())) {
            return;
        }

        // Clear any pending flush timeout
        if (this._flushTimeout) {
            clearTimeout(this._flushTimeout);
            this._flushTimeout = null;
        }

        this._isProcessing = true;
        const processingStart = Date.now();

        try {
            // Prepare the batch (like passengers boarding the train)
            const batch = Array.from(this._queue.values())
                .sort((a, b) => b.priority - a.priority) // Higher priority first
                .slice(0, this.config.targetBatchSize)
                .map(entry => {
                    entry.attempts++;
                    this._retryMap.set(entry.id, entry.attempts);
                    return entry;
                });

            // Process the batch
            this.executor(batch.map(entry => entry.content));

            // Success handling
            this._stats.processed += batch.length;
            this._stats.lastProcessingTime = Date.now() - processingStart;
            
            // Remove processed messages and their retry counts
            batch.forEach(entry => {
                this._queue.delete(entry.id);
                this._retryMap.delete(entry.id);
            });

        } catch (error) {
            this._stats.errors++;
            console.error('Error processing batch:', error);

            // Handle retries for failed messages
            this._handleBatchError();
        } finally {
            this._isProcessing = false;

            // Check if we need to schedule the next departure
            if (this._queue.size > 0) {
                this._startFlushing();
            }
        }
    }

    /**
     * Handles batch processing errors
     * @private
     */
    _handleBatchError() {
        // Implement exponential backoff for retries
        for (const [id, attempts] of this._retryMap.entries()) {
            if (attempts >= this.config.maxRetries) {
                this._queue.delete(id);
                this._retryMap.delete(id);
                this._stats.dropped++;
            }
        }
    }

    /**
     * Returns current buffer statistics
     * @returns {Object} Current buffer statistics
     */
    getStats() {
        return {
            ...this._stats,
            currentSize: this._queue.size,
            isProcessing: this._isProcessing
        };
    }

    /**
     * Destroys the buffer and cleans up resources
     */
    destroy() {
        this._clearProcessingCheck();
        if (this._flushTimeout) {
            clearTimeout(this._flushTimeout);
            this._flushTimeout = null;
        }
        this._queue.clear();
        this._retryMap.clear();
    }
}

export default MegaBuffer;