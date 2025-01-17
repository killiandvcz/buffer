# @killiandvcz/buffer

An intelligent, self-managing message buffer system with advanced traffic pattern detection and smart batching capabilities.

![npm version](https://img.shields.io/npm/v/@killiandvcz/buffer)
![license](https://img.shields.io/npm/l/@killiandvcz/buffer)
![node version](https://img.shields.io/node/v/@killiandvcz/buffer)

## Features

🚄 **Smart Traffic Management**
- Automatic traffic pattern detection
- Adaptive batch sizing based on message flow
- Intelligent handling of traffic spikes and residual messages

🎯 **Self-Optimizing**
- Dynamic monitoring intervals
- Automatic batch size adjustment
- Priority-based message processing

🛡️ **Robust Error Handling**
- Circuit breaker pattern
- Exponential backoff retry
- Comprehensive error events

📊 **Real-time Metrics**
- Traffic pattern analysis
- Performance statistics
- Load monitoring

🔄 **Event-Driven Architecture**
- Rich event system
- Detailed monitoring capabilities
- Full observability

## Installation

```bash
npm install @killiandvcz/buffer
```

## Quick Start

```javascript
import MessageBuffer from '@killiandvcz/buffer';

// Create a new buffer with a custom executor
const buffer = new MessageBuffer(
    async (messages) => {
        // Your batch processing logic here
        await websocket.sendBatch(messages);
    },
    {
        targetBatchSize: 50,
        maxBatchDelay: 1000
    }
);

// Add messages to the buffer
buffer.add({ type: 'user-action', data: { ... } });

// Monitor buffer events
buffer.on('flush', ({ batchSize, processingTime, isResidual }) => {
    console.log(`Processed ${batchSize} messages in ${processingTime}ms`);
});

buffer.on('trafficPattern', ({ trend, messageCount }) => {
    console.log(`Current traffic trend: ${trend}`);
});
```

## Configuration

### Buffer Configuration Options

```javascript
const config = {
    maxSize: 1000,          // Maximum buffer size
    targetBatchSize: 50,    // Ideal batch size
    minBatchSize: 10,       // Minimum batch size for processing
    maxBatchDelay: 1000,    // Maximum delay before processing (ms)
    preserveOrder: true,    // Preserve message order
    maxRetries: 3,          // Maximum retry attempts
    baseRetryDelay: 1000,   // Base retry delay (ms)
    maxConcurrentFlush: 1   // Max concurrent flush operations
};
```

### Message Options

```javascript
buffer.add(message, {
    priority: 1,            // Higher priority messages processed first
    metadata: {             // Custom metadata
        source: 'user-action',
        timestamp: Date.now()
    }
});
```

## Advanced Features

### Traffic Pattern Detection

The buffer automatically analyzes message patterns:

```javascript
buffer.on('trafficPattern', ({ 
    isLowTraffic,          // Current traffic level
    averageGap,            // Average time between messages
    trend,                 // 'increasing', 'decreasing', 'stable'
    messageCount           // Messages in last minute
}) => {
    console.log(`Traffic Pattern: ${trend}`);
});
```

### Residual Message Handling

Intelligent processing of remaining messages after traffic spikes:

```javascript
buffer.on('flush', ({ isResidual }) => {
    if (isResidual) {
        console.log('Processing residual messages from traffic spike');
    }
});
```

### Statistics and Metrics

Real-time performance monitoring:

```javascript
// Get current statistics
const stats = buffer.getStats();
// {
//     size: 0,              // Current buffer size
//     totalProcessed: 0,    // Total processed messages
//     totalDropped: 0,      // Total dropped messages
//     totalErrors: 0,       // Total errors encountered
//     avgProcessingTime: 0, // Average processing time
//     avgBatchSize: 0,      // Average batch size
//     avgWaitTime: 0        // Average wait time
// }

// Get current metrics
const metrics = buffer.getMetrics();
// {
//     incomingRate: 0,      // Messages per second
//     processingRate: 0,    // Processing rate
//     errorRate: 0,         // Error rate
//     currentLoad: 0        // Current load (0-1)
// }
```

### Event System

Comprehensive event monitoring:

```javascript
// Available events
buffer.on('flush', (data) => {});      // Batch processed
buffer.on('drop', (data) => {});       // Message dropped
buffer.on('error', (data) => {});      // Error occurred
buffer.on('circuit-break', (data) => {});  // Circuit breaker triggered
buffer.on('metrics', (data) => {});    // Metrics updated
buffer.on('trafficPattern', (data) => {}); // Traffic pattern changed
```

## Best Practices

1. **Batch Size Configuration**
   - Set `targetBatchSize` based on your processing capacity
   - Use `minBatchSize` to control minimum processing threshold
   - Adjust `maxBatchDelay` to balance latency and throughput

2. **Error Handling**
   - Always listen to 'error' events
   - Implement proper error recovery in your executor
   - Consider circuit breaker events for system protection

3. **Monitoring**
   - Monitor traffic patterns for system optimization
   - Track metrics for performance tuning
   - Use statistics for capacity planning

## Real-World Example

Integration with WebSocket batch sending:

```javascript
import MessageBuffer from '@killiandvcz/buffer';
import WebSocket from 'ws';

const ws = new WebSocket('wss://api.example.com');

const buffer = new MessageBuffer(
    async (messages) => {
        if (ws.readyState !== WebSocket.OPEN) {
            throw new Error('WebSocket not connected');
        }
        
        const batch = JSON.stringify(messages);
        await new Promise((resolve, reject) => {
            ws.send(batch, (error) => {
                if (error) reject(error);
                else resolve();
            });
        });
    },
    {
        targetBatchSize: 50,
        maxBatchDelay: 1000,
        maxRetries: 3
    }
);

// Monitor connection health
buffer.on('error', ({ error, context }) => {
    console.error(`Buffer error in ${context}:`, error);
});

buffer.on('circuit-break', (data) => {
    console.error('Circuit breaker triggered:', data);
    // Implement recovery logic
});

// Monitor performance
buffer.on('metrics', (metrics) => {
    if (metrics.currentLoad > 0.8) {
        console.warn('High buffer load detected');
    }
});

// Usage
function sendUserAction(action) {
    return buffer.add(action, {
        priority: action.type === 'CRITICAL' ? 2 : 1,
        metadata: {
            userId: action.userId,
            timestamp: Date.now()
        }
    });
}
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT © [KillianDvCz]