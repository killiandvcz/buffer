/**
* @typedef {Object} EntryOptions
* @property {number} [priority=0] Message priority
* @property {Object} [metadata={}] Additional metadata
*/

/**
* Represents a single message entry
*/
export class Entry {
    /**
    * @param {*} content
    * @param {EntryOptions} [options={}] 
    */
    constructor(content, options = {}) {
        this.content = content;
        
        this.priority = options.priority ?? 0;
        this.metadata = options.metadata ?? {};
        
        this.id = crypto.randomUUID();
        this.timestamp = Date.now();
        this.attempts = 0;
    }
    
}